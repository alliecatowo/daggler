/* ============================================================================
 * @daggler/validators — orchestrator.
 *
 * validateWorkflow runs every layer over a parsed workflow, enriches raw
 * findings with source spans + stable ids, then computes the diagnostic counts
 * and posture scores the editor surfaces.
 * ========================================================================== */

import {
  buildGraph,
  jobIdOfPath,
  jobPath,
  SourceMap,
  type ParseResult,
} from "@daggler/workflow-ir";
import type {
  Diagnostic,
  PostureScore,
  RawFinding,
  ValidationContext,
  ValidationResult,
} from "./types.js";
import { checkSchema } from "./layers/schema.js";
import { checkExpressions } from "./layers/expressions.js";
import { checkGraphSemantics } from "./layers/graph-semantics.js";
import { checkActions } from "./layers/actions.js";
import { POLICY_RULES } from "./policies/rules.js";

export * from "./types.js";
export { POLICY_RULES } from "./policies/rules.js";
export { POLICY_PACKS } from "./policies/packs.js";
export {
  ACTION_CATALOG,
  KNOWN_SHAS,
  lookupActionMeta,
  trustOf,
  type ActionMeta,
  type TrustReport,
} from "./policies/catalog.js";

function buildContext(parse: ParseResult): ValidationContext {
  return {
    ir: parse.ir,
    graph: buildGraph(parse.ir),
    sourceMap: new SourceMap(parse.sourceMap),
    parse,
    source: parse.sourceMap.source,
  };
}

function runPolicies(ctx: ValidationContext): RawFinding[] {
  const out: RawFinding[] = [];
  for (const rule of POLICY_RULES) {
    try {
      out.push(...rule.evaluate(ctx));
    } catch {
      // a misbehaving rule must never take down validation
    }
  }
  return out;
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

function resolveSpan(ctx: ValidationContext, path: string) {
  const direct = ctx.sourceMap.spanForPath(path);
  if (direct) return direct;
  const owner = jobIdOfPath(path);
  if (owner) return ctx.sourceMap.spanForPath(jobPath(owner));
  return undefined;
}

function securityPosture(diags: Diagnostic[]): PostureScore {
  let score = 100;
  const factors: string[] = [];
  for (const d of diags) {
    if (d.source === "security") {
      score -= d.severity === "error" ? 18 : d.severity === "warning" ? 8 : 2;
    } else if (d.source === "policy") {
      score -= d.severity === "error" ? 12 : d.severity === "warning" ? 6 : 1;
    }
  }
  score = Math.max(0, Math.min(100, score));
  const sec = diags.filter((d) => d.source === "security");
  if (sec.some((d) => d.code === "POL002" || d.code === "POL007")) {
    factors.push("Unpinned third-party actions");
  }
  if (sec.some((d) => d.code === "POL003" || d.code === "POL004")) {
    factors.push("Untrusted input reaches privileged context");
  }
  if (sec.some((d) => d.code === "POL008")) factors.push("Shell injection risk");
  if (sec.some((d) => d.code.startsWith("AGENT"))) {
    factors.push("Agentic workflow injection");
  }
  const grade: PostureScore["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade, factors };
}

export interface ValidateOptions {
  /** Limit findings to a single canonical node path subtree. */
  onlyPath?: string;
}

export function validateWorkflow(
  parse: ParseResult,
  _opts: ValidateOptions = {},
): ValidationResult {
  const ctx = buildContext(parse);

  const raw: RawFinding[] = [];
  // Layer 0: syntax/parse problems surfaced by the parser itself.
  for (const d of parse.diagnostics) {
    raw.push({
      code: d.code,
      severity: d.severity,
      source: "parser",
      title: d.severity === "error" ? "Syntax error" : "Parser warning",
      message: d.message,
      path: d.span?.path ?? "workflow",
    });
  }
  raw.push(...checkSchema(ctx));
  raw.push(...checkExpressions(ctx));
  raw.push(...checkGraphSemantics(ctx));
  raw.push(...checkActions(ctx));
  raw.push(...runPolicies(ctx));

  // Enrich: spans, ids, dedupe identical findings.
  const seen = new Set<string>();
  const ordinals = new Map<string, number>();
  const diagnostics: Diagnostic[] = [];
  for (const f of raw) {
    const dedupeKey = `${f.code}|${f.path}|${f.message}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const ord = ordinals.get(`${f.code}|${f.path}`) ?? 0;
    ordinals.set(`${f.code}|${f.path}`, ord + 1);
    diagnostics.push({
      id: `${f.code}:${f.path}:${ord}`,
      code: f.code,
      severity: f.severity,
      source: f.source,
      title: f.title,
      message: f.message,
      path: f.path,
      span: resolveSpan(ctx, f.path),
      fix: f.fix,
      docsUrl: f.docsUrl,
    });
  }

  // Sort: severity, then source weight (security first), then by line.
  const SRC_W: Record<string, number> = {
    security: 0, policy: 1, semantic: 2, actionlint: 3, parser: 4,
  };
  diagnostics.sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    if ((SRC_W[a.source] ?? 9) !== (SRC_W[b.source] ?? 9)) {
      return (SRC_W[a.source] ?? 9) - (SRC_W[b.source] ?? 9);
    }
    return (a.span?.start.line ?? 0) - (b.span?.start.line ?? 0);
  });

  const counts = {
    error: diagnostics.filter((d) => d.severity === "error").length,
    warning: diagnostics.filter((d) => d.severity === "warning").length,
    info: diagnostics.filter((d) => d.severity === "info").length,
    total: diagnostics.length,
  };

  const steps = ctx.ir.jobs.reduce((s, j) => s + j.steps.length, 0);
  const maxMatrix = ctx.ir.jobs.reduce(
    (m, j) => Math.max(m, j.strategy?.matrix?.size ?? 0),
    0,
  );
  const complexity = {
    jobs: ctx.ir.jobs.length,
    steps,
    maxMatrix,
    score:
      ctx.ir.jobs.length * 3 +
      steps +
      maxMatrix * 2 +
      ctx.graph.edges.filter((e) => e.kind === "needs").length,
  };

  return {
    diagnostics,
    counts,
    security: securityPosture(diagnostics),
    complexity,
  };
}
