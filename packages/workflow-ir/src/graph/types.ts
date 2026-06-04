/* ============================================================================
 * Daggler — semantic graph types
 *
 * The graph is a *projection* of the IR for rendering and analysis. It is not
 * proprietary storage and never the source of truth. The editor canvas lays
 * jobs out by `needs` depth (longest-path layering) and draws execution edges;
 * triggers feed the root jobs.
 * ========================================================================== */

import type { JobIR, Severity, TriggerIR } from "../ir/types.js";

export interface JobGraphNode {
  /** Job id. */
  id: string;
  /** Canonical path, `job:<id>`. */
  path: string;
  job: JobIR;
  /** Longest-path layer index (0 = root, runs first). */
  depth: number;
  /** Vertical order within the depth column (assigned by layout). */
  row: number;
  /** Worst diagnostic severity attached to this job or its steps. */
  worstSeverity: Severity | null;
  /** Number of diagnostics on this job (and its steps). */
  diagnosticCount: number;
}

export interface TriggerGraphNode {
  /** Canonical path, `trigger:<event>`. */
  path: string;
  event: string;
  trigger: TriggerIR;
}

export type GraphEdgeKind = "needs" | "trigger";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface WorkflowGraph {
  jobs: JobGraphNode[];
  triggers: TriggerGraphNode[];
  edges: GraphEdge[];
  /** True if the `needs` graph contains a cycle. */
  hasCycle: boolean;
  /** Job ids participating in a detected cycle (empty if none). */
  cycleNodes: string[];
  /** Job ids that are unreachable from any trigger root. */
  unreachable: string[];
  /** Max depth across all jobs (number of columns - 1). */
  maxDepth: number;
}
