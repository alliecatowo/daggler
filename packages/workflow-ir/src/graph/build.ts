/* ============================================================================
 * buildGraph — project a WorkflowIR into a renderable/analyzable graph.
 *
 * Layout is longest-path layering by `needs` depth (the same shape the editor
 * canvas draws). We also detect cycles, find jobs that can never run (trapped
 * behind a cycle or a missing dependency), and assign per-column rows.
 * ========================================================================== */

import type { WorkflowIR } from "../ir/types.js";
import { jobPath, triggerPath } from "../ir/paths.js";
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
