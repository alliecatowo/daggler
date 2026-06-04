/* ============================================================================
 * The browser-side engine. Daggler's parser + validators are pure, isomorphic
 * TypeScript, so the *entire* semantic pipeline runs client-side with zero
 * backend: parse → IR → graph → validate. This is what makes the editor work
 * with no server, no DB, and no GitHub connection — the self-hostable thesis.
 * ============================================================================ */

import {
  buildGraph,
  parseWorkflow,
  SourceMap,
  type ParseResult,
  type WorkflowGraph,
  type WorkflowIR,
} from "@daggler/workflow-ir";
import { validateWorkflow, type Diagnostic, type ValidationResult } from "@daggler/validators";

export interface Analysis {
  source: string;
  path: string;
  parse: ParseResult;
  ir: WorkflowIR;
  graph: WorkflowGraph;
  sourceMap: SourceMap;
  validation: ValidationResult;
  /** path → diagnostics, with step diagnostics also bubbled to "__job__<id>". */
  diagByPath: Record<string, Diagnostic[]>;
  /** Worst severity per job id (for graph badges). */
  jobSeverity: Record<string, "error" | "warning" | "info" | null>;
}

const SEV_RANK = { info: 1, warning: 2, error: 3 } as const;

function indexDiagnostics(diags: Diagnostic[]): {
  byPath: Record<string, Diagnostic[]>;
  jobSeverity: Record<string, "error" | "warning" | "info" | null>;
} {
  const byPath: Record<string, Diagnostic[]> = {};
  const jobSeverity: Record<string, "error" | "warning" | "info" | null> = {};
  const bump = (jobId: string, sev: Diagnostic["severity"]) => {
    const cur = jobSeverity[jobId] ?? null;
    if (!cur || SEV_RANK[sev] > SEV_RANK[cur]) jobSeverity[jobId] = sev;
  };
  for (const d of diags) {
    (byPath[d.path] ??= []).push(d);
    if (d.path.startsWith("step:")) {
      const jobId = d.path.slice(5).split("#")[0]!;
      (byPath[`__job__${jobId}`] ??= []).push(d);
      bump(jobId, d.severity);
    } else if (d.path.startsWith("job:")) {
      const jobId = d.path.slice(4).split(":")[0]!;
      bump(jobId, d.severity);
    }
  }
  return { byPath, jobSeverity };
}

/** Run the full pipeline over a YAML string. Cheap enough to call on keystroke. */
export function analyze(source: string, path = ".github/workflows/ci.yml"): Analysis {
  const parse = parseWorkflow(source, { path });
  const graph = buildGraph(parse.ir);
  const sourceMap = new SourceMap(parse.sourceMap);
  const validation = validateWorkflow(parse);
  const { byPath, jobSeverity } = indexDiagnostics(validation.diagnostics);
  return {
    source,
    path,
    parse,
    ir: parse.ir,
    graph,
    sourceMap,
    validation,
    diagByPath: byPath,
    jobSeverity,
  };
}
