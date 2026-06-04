/* ============================================================================
 * buildGraph — project a WorkflowIR into a renderable/analyzable graph.
 *
 * Layout is longest-path layering by `needs` depth (the same shape the editor
 * canvas draws). We also detect cycles, find jobs that can never run (trapped
 * behind a cycle or a missing dependency), and assign per-column rows.
 * ========================================================================== */

import type { JobIR, WorkflowIR } from "../ir/types.js";
import { jobPath, triggerPath } from "../ir/paths.js";
import { parseExpression } from "../parse/normalize.js";
import type {
  GraphEdge,
  JobGraphNode,
  TriggerGraphNode,
  WorkflowGraph,
} from "./types.js";

/** Tarjan-free cycle detection via DFS coloring; returns nodes on any cycle. */
function findCycleNodes(
  ids: string[],
  needsOf: Map<string, string[]>,
): string[] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(ids.map((id) => [id, WHITE]));
  const onCycle = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string) => {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of needsOf.get(id) ?? []) {
      if (!color.has(dep)) continue; // missing dep handled elsewhere
      const c = color.get(dep);
      if (c === GRAY) {
        // back edge: everything from dep up the stack is on a cycle
        const from = stack.lastIndexOf(dep);
        for (let i = from; i < stack.length; i++) onCycle.add(stack[i]!);
        onCycle.add(dep);
      } else if (c === WHITE) {
        visit(dep);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of ids) if (color.get(id) === WHITE) visit(id);
  return [...onCycle];
}

/** Longest-path depth with a cycle/missing guard so it always terminates. */
function computeDepths(
  ids: string[],
  needsOf: Map<string, string[]>,
  idSet: Set<string>,
): Map<string, number> {
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const deps = (needsOf.get(id) ?? []).filter((d) => idSet.has(d));
    const d = deps.length
      ? Math.max(...deps.map((dep) => 1 + visit(dep, seen)))
      : 0;
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) visit(id, new Set());
  return depth;
}

/** Regex to find `needs.<jobId>.outputs.<outputName>` references. */
const NEEDS_OUTPUT_RE = /needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g;

/** Collect all raw string values from a job that may carry expressions. */
function collectJobExpressionTexts(job: JobIR): string[] {
  const texts: string[] = [];
  if (job.if) texts.push(job.if);
  if (job.outputs) {
    for (const val of Object.values(job.outputs)) {
      texts.push(val);
    }
  }
  for (const step of job.steps) {
    if (step.if) texts.push(step.if);
    if (step.env) {
      for (const val of Object.values(step.env)) texts.push(val);
    }
    if (step.kind === "uses" && step.with) {
      for (const val of Object.values(step.with)) texts.push(String(val));
    }
    if (step.kind === "run") {
      texts.push(step.run);
    }
  }
  return texts;
}

/**
 * Scan a job's expressions for `needs.<A>.outputs.<x>` references and return
 * unique {from, label} pairs (deduplicated by from+label).
 */
function findNeedsOutputRefs(
  job: JobIR,
): Array<{ from: string; label: string }> {
  const seen = new Set<string>();
  const results: Array<{ from: string; label: string }> = [];

  const texts = collectJobExpressionTexts(job);
  for (const text of texts) {
    // Also gather expression bodies via parseExpression for well-formed ${{}}
    const parsed = parseExpression(text);
    const toSearch = [text, ...parsed.expressions];
    for (const s of toSearch) {
      NEEDS_OUTPUT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NEEDS_OUTPUT_RE.exec(s)) !== null) {
        const from = m[1]!;
        const label = m[2]!;
        const key = `${from}\0${label}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ from, label });
        }
      }
    }
  }
  return results;
}

const SECRET_RE = /secrets\.([A-Za-z0-9_]+)/g;
const GITHUB_TOKEN = "GITHUB_TOKEN";

/**
 * Collect non-GITHUB_TOKEN secret names referenced in a job's expressions.
 */
function findSecretRefs(job: JobIR): string[] {
  const seen = new Set<string>();
  const texts = collectJobExpressionTexts(job);
  for (const text of texts) {
    SECRET_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SECRET_RE.exec(text)) !== null) {
      const name = m[1]!;
      if (name !== GITHUB_TOKEN) seen.add(name);
    }
  }
  return [...seen];
}

/**
 * Return all write-level permission scopes granted to a job, consulting both
 * the job-level permissions and the workflow-level permissions (when the job
 * has no job-level override).
 */
function findWriteScopes(job: JobIR, ir: WorkflowIR): string[] {
  const perms = job.permissions ?? ir.permissions;
  if (!perms) return [];

  const scopes: string[] = [];
  if (perms.all === "write") {
    scopes.push("write-all");
  }
  if (perms.scopes) {
    for (const [scope, level] of Object.entries(perms.scopes)) {
      if (level === "write") scopes.push(scope);
    }
  }
  return scopes;
}

export function buildGraph(ir: WorkflowIR): WorkflowGraph {
  const ids = ir.jobs.map((j) => j.id);
  const idSet = new Set(ids);
  const needsOf = new Map<string, string[]>(ir.jobs.map((j) => [j.id, j.needs]));

  const cycleNodes = findCycleNodes(ids, needsOf);
  const cycleSet = new Set(cycleNodes);
  const depth = computeDepths(ids, needsOf, idSet);

  // A job can run iff every job in its transitive `needs` closure exists and
  // none of them sit on a cycle. Jobs needing a missing job, or trapped behind
  // a cycle, can never run → unreachable. True roots have no declared needs.
  const canRunMemo = new Map<string, boolean>();
  const canRun = (id: string, stack: Set<string>): boolean => {
    if (canRunMemo.has(id)) return canRunMemo.get(id)!;
    if (cycleSet.has(id) || stack.has(id)) return false;
    stack.add(id);
    let ok = true;
    for (const dep of needsOf.get(id) ?? []) {
      if (!idSet.has(dep) || !canRun(dep, stack)) {
        ok = false;
        break;
      }
    }
    stack.delete(id);
    canRunMemo.set(id, ok);
    return ok;
  };
  const roots = ir.jobs
    .filter((j) => j.needs.length === 0 && !cycleSet.has(j.id))
    .map((j) => j.id);
  const unreachable = ids.filter((id) => !canRun(id, new Set()));

  // Per-column rows, in declared job order.
  const rowCounters = new Map<number, number>();
  const jobNodes: JobGraphNode[] = ir.jobs.map((job) => {
    const d = depth.get(job.id) ?? 0;
    const row = rowCounters.get(d) ?? 0;
    rowCounters.set(d, row + 1);
    return {
      id: job.id,
      path: jobPath(job.id),
      job,
      depth: d,
      row,
      worstSeverity: null,
      diagnosticCount: 0,
    };
  });

  const edges: GraphEdge[] = [];
  for (const job of ir.jobs) {
    for (const dep of job.needs) {
      edges.push({
        id: `needs:${dep}->${job.id}`,
        from: dep,
        to: job.id,
        kind: "needs",
      });
    }
  }

  const triggers: TriggerGraphNode[] = ir.on.map((t) => ({
    path: triggerPath(t.event),
    event: t.event,
    trigger: t,
  }));
  // Triggers feed the root jobs.
  for (const t of triggers) {
    for (const rootId of roots) {
      edges.push({
        id: `trigger:${t.event}->${rootId}`,
        from: t.path,
        to: rootId,
        kind: "trigger",
      });
    }
  }

  // DATA edges: needs.<A>.outputs.<x> references.
  // Deduplication key: from->to->label (one edge per unique triple).
  const dataEdgeSeen = new Set<string>();
  for (const job of ir.jobs) {
    const refs = findNeedsOutputRefs(job);
    for (const { from, label } of refs) {
      const dedupeKey = `${from}\0${job.id}\0${label}`;
      if (dataEdgeSeen.has(dedupeKey)) continue;
      dataEdgeSeen.add(dedupeKey);
      edges.push({
        id: `data:${from}->${job.id}:${label}`,
        from,
        to: job.id,
        kind: "data",
        label,
      });
    }
  }

  // AUTHORITY edges: secrets and write permissions.
  for (const job of ir.jobs) {
    // Secret references (excluding GITHUB_TOKEN).
    const secrets = findSecretRefs(job);
    for (const name of secrets) {
      const from = `secret:${name}`;
      edges.push({
        id: `authority:secret:${name}->${job.id}`,
        from,
        to: job.id,
        kind: "authority",
        label: name,
      });
    }
    // Write-level permission scopes.
    const writeScopes = findWriteScopes(job, ir);
    for (const scope of writeScopes) {
      const from = `perm:${scope}`;
      edges.push({
        id: `authority:perm:${scope}->${job.id}`,
        from,
        to: job.id,
        kind: "authority",
        label: scope,
      });
    }
  }

  const maxDepth = jobNodes.reduce((m, n) => Math.max(m, n.depth), 0);

  return {
    jobs: jobNodes,
    triggers,
    edges,
    hasCycle: cycleNodes.length > 0,
    cycleNodes,
    unreachable,
    maxDepth,
  };
}
