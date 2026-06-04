/* ============================================================================
 * parseWorkflow — native GitHub Actions YAML → WorkflowIR + source map.
 *
 * Two passes over one parse:
 *   1. doc.toJS() gives a robust plain-JS value we normalize into the IR.
 *   2. the YAML AST (with node ranges) gives byte-accurate source spans, keyed
 *      by canonical node path, for cross-highlighting. Span lookup is
 *      best-effort and never blocks IR construction.
 *
 * Note on the `on` gotcha: the `yaml` library defaults to YAML 1.2 core schema,
 * where the bare key `on` stays the string "on" (it is NOT coerced to boolean
 * true as it would be under YAML 1.1). So `js.on` is reliable here.
 * ========================================================================== */

import { isMap, isSeq, parseDocument } from "yaml";
import type {
  DefaultsIR,
  ConcurrencyIR,
  EnvironmentIR,
  JobIR,
  ParseDiagnostic,
  ParseResult,
  Position,
  SourceSpan,
  StepIR,
  WorkflowIR,
} from "../ir/types.js";
import { jobField, jobPath, stepPath, triggerPath, workflowField } from "../ir/paths.js";
import { makePositioner } from "../ir/source-map.js";
import {
  parseActionRef,
  parsePermissions,
  parseReusableCall,
  parseStrategy,
  parseTriggers,
} from "./normalize.js";

type Seg = string | number;
// Minimal structural view of yaml AST nodes we touch.
interface RangedNode {
  range?: [number, number, number];
  value?: unknown;
  items?: unknown[];
}
interface PairNode {
  key?: RangedNode;
  value?: RangedNode;
}

function locate(
  root: unknown,
  segs: Seg[],
): { keyNode?: RangedNode; valueNode?: RangedNode } {
  let current: unknown = root;
  let keyNode: RangedNode | undefined;
  for (const seg of segs) {
    if (current == null) return {};
    if (isMap(current)) {
      const pair = (current.items as unknown as PairNode[]).find(
        (p) => p.key != null && String(p.key.value) === String(seg),
      );
      if (!pair) return {};
      keyNode = pair.key;
      current = pair.value;
    } else if (isSeq(current)) {
      const idx = Number(seg);
      const items = current.items as unknown as RangedNode[];
      current = items[idx];
      keyNode = undefined;
    } else {
      return {};
    }
  }
  return { keyNode, valueNode: current as RangedNode | undefined };
}

function makeSpan(
  path: string,
  keyNode: RangedNode | undefined,
  valueNode: RangedNode | undefined,
  source: string,
  posOf: (offset: number) => Position,
): SourceSpan | undefined {
  const startOffset = keyNode?.range?.[0] ?? valueNode?.range?.[0];
  const endNode = valueNode ?? keyNode;
  // Prefer nodeEnd (range[2]) for collections; trim trailing whitespace so a
  // block doesn't visually bleed into following blank lines.
  let endOffset = endNode?.range?.[2] ?? endNode?.range?.[1];
  if (startOffset == null || endOffset == null) return undefined;
  while (endOffset > startOffset && /\s/.test(source.charAt(endOffset - 1))) {
    endOffset--;
  }
  return { path, start: posOf(startOffset), end: posOf(endOffset) };
}

function toStringRecord(raw: unknown): Record<string, string> | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = v == null ? "" : String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function toScalarRecord(
  raw: unknown,
): Record<string, string | number | boolean> | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = typeof v === "number" || typeof v === "boolean" ? v : String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function parseConcurrency(raw: unknown): ConcurrencyIR | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return { group: raw };
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      group: r.group != null ? String(r.group) : "",
      cancelInProgress: r["cancel-in-progress"] === true,
    };
  }
  return undefined;
}

function parseDefaults(raw: unknown): DefaultsIR | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const run = (raw as Record<string, unknown>).run as
    | Record<string, unknown>
    | undefined;
  if (!run) return undefined;
  return {
    shell: run.shell != null ? String(run.shell) : undefined,
    workingDirectory:
      run["working-directory"] != null
        ? String(run["working-directory"])
        : undefined,
  };
}

function parseEnvironment(raw: unknown): EnvironmentIR | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return { name: raw };
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      name: r.name != null ? String(r.name) : "",
      url: r.url != null ? String(r.url) : undefined,
    };
  }
  return undefined;
}

function buildStep(jobId: string, index: number, raw: unknown): StepIR {
  const s = (raw ?? {}) as Record<string, unknown>;
  const path = stepPath(jobId, index);
  const base = {
    path,
    index,
    id: s.id != null ? String(s.id) : undefined,
    name: s.name != null ? String(s.name) : undefined,
    if: s.if != null ? String(s.if) : undefined,
    env: toStringRecord(s.env),
    continueOnError: s["continue-on-error"] === true ? true : undefined,
    timeoutMinutes:
      typeof s["timeout-minutes"] === "number"
        ? (s["timeout-minutes"] as number)
        : undefined,
  };
  if (s.uses != null) {
    const uses = String(s.uses);
    return {
      ...base,
      kind: "uses",
      uses,
      ref: parseActionRef(uses),
      with: toScalarRecord(s.with),
    };
  }
  if (s.run != null) {
    return {
      ...base,
      kind: "run",
      run: String(s.run),
      shell: s.shell != null ? String(s.shell) : undefined,
      workingDirectory:
        s["working-directory"] != null
          ? String(s["working-directory"])
          : undefined,
    };
  }
  return { ...base, kind: "raw", raw: s };
}

function buildJob(jobId: string, raw: unknown): JobIR {
  const j = (raw ?? {}) as Record<string, unknown>;
  const needs =
    j.needs == null
      ? []
      : Array.isArray(j.needs)
        ? j.needs.map(String)
        : [String(j.needs)];
  const steps = Array.isArray(j.steps)
    ? j.steps.map((s, i) => buildStep(jobId, i, s))
    : [];
  const isReusable = j.uses != null;
  const secretsRaw = j.secrets;
  return {
    id: jobId,
    path: jobPath(jobId),
    name: j.name != null ? String(j.name) : undefined,
    runsOn: Array.isArray(j["runs-on"])
      ? (j["runs-on"] as unknown[]).map(String)
      : j["runs-on"] != null
        ? String(j["runs-on"])
        : undefined,
    needs,
    if: j.if != null ? String(j.if) : undefined,
    permissions: parsePermissions(j.permissions),
    env: toStringRecord(j.env),
    defaults: parseDefaults(j.defaults),
    strategy: parseStrategy(j.strategy),
    concurrency: parseConcurrency(j.concurrency),
    environment: parseEnvironment(j.environment),
    timeoutMinutes:
      typeof j["timeout-minutes"] === "number"
        ? (j["timeout-minutes"] as number)
        : undefined,
    continueOnError: j["continue-on-error"] === true ? true : undefined,
    outputs: toStringRecord(j.outputs),
    steps,
    uses: isReusable ? parseReusableCall(String(j.uses)) : undefined,
    with: toScalarRecord(j.with),
    secrets:
      secretsRaw === "inherit"
        ? "inherit"
        : toStringRecord(secretsRaw) ?? undefined,
    kind: isReusable ? "reusable" : "normal",
    raw: isReusable ? undefined : undefined,
  };
}

export interface ParseOptions {
  /** File path recorded on the IR, e.g. `.github/workflows/ci.yml`. */
  path?: string;
}

export function parseWorkflow(
  source: string,
  options: ParseOptions = {},
): ParseResult {
  const path = options.path ?? ".github/workflows/workflow.yml";
  const posOf = makePositioner(source);
  const doc = parseDocument(source, { prettyErrors: true, version: "1.2" });

  const diagnostics: ParseDiagnostic[] = [];
  for (const err of doc.errors) {
    const startOffset = err.pos?.[0] ?? 0;
    const endOffset = err.pos?.[1] ?? startOffset;
    diagnostics.push({
      code: `parser/${err.code ?? "YAML_ERROR"}`,
      message: err.message,
      severity: "error",
      span: {
        path: "workflow",
        start: posOf(startOffset),
        end: posOf(endOffset),
      },
    });
  }
  for (const warn of doc.warnings) {
    const startOffset = warn.pos?.[0] ?? 0;
    diagnostics.push({
      code: `parser/${warn.code ?? "YAML_WARNING"}`,
      message: warn.message,
      severity: "warning",
      span: { path: "workflow", start: posOf(startOffset), end: posOf(startOffset) },
    });
  }

  const js = (() => {
    try {
      return (doc.toJS({ maxAliasCount: -1 }) ?? {}) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();

  const jobsRaw = (js.jobs ?? {}) as Record<string, unknown>;
  const jobs: JobIR[] = Object.keys(jobsRaw).map((id) =>
    buildJob(id, jobsRaw[id]),
  );

  const ir: WorkflowIR = {
    name: js.name != null ? String(js.name) : undefined,
    runName: js["run-name"] != null ? String(js["run-name"]) : undefined,
    path,
    on: parseTriggers(js.on),
    permissions: parsePermissions(js.permissions),
    env: toStringRecord(js.env),
    defaults: parseDefaults(js.defaults),
    concurrency: parseConcurrency(js.concurrency),
    jobs,
    raw: js,
  };

  // ---- source spans (best-effort) ----
  const root = doc.contents as unknown;
  const spans: Record<string, SourceSpan> = {};
  const record = (pathKey: string, segs: Seg[]) => {
    const { keyNode, valueNode } = locate(root, segs);
    const span = makeSpan(pathKey, keyNode, valueNode, source, posOf);
    if (span) spans[pathKey] = span;
  };

  record(workflowField("name"), ["name"]);
  record(workflowField("run-name"), ["run-name"]);
  record(workflowField("on"), ["on"]);
  record(workflowField("permissions"), ["permissions"]);
  record(workflowField("concurrency"), ["concurrency"]);
  record(workflowField("env"), ["env"]);
  record(workflowField("defaults"), ["defaults"]);
  record(workflowField("jobs"), ["jobs"]);

  // trigger spans only when `on` is a map; otherwise fall back to workflow:on.
  const onNode = locate(root, ["on"]).valueNode;
  if (onNode && isMap(onNode)) {
    for (const t of ir.on) record(triggerPath(t.event), ["on", t.event]);
  } else {
    for (const t of ir.on) {
      const span = spans[workflowField("on")];
      if (span) spans[triggerPath(t.event)] = { ...span, path: triggerPath(t.event) };
    }
  }

  for (const job of ir.jobs) {
    record(job.path, ["jobs", job.id]);
    record(jobField(job.id, "needs"), ["jobs", job.id, "needs"]);
    record(jobField(job.id, "permissions"), ["jobs", job.id, "permissions"]);
    record(jobField(job.id, "runs-on"), ["jobs", job.id, "runs-on"]);
    record(jobField(job.id, "environment"), ["jobs", job.id, "environment"]);
    record(jobField(job.id, "strategy"), ["jobs", job.id, "strategy"]);
    for (const step of job.steps) {
      record(step.path, ["jobs", job.id, "steps", step.index]);
    }
  }

  return {
    ir,
    sourceMap: { spans, source },
    diagnostics,
    ok: doc.errors.length === 0,
  };
}
