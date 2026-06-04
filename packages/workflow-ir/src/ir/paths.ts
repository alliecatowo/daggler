/* ============================================================================
 * Canonical node-path helpers. These strings are the lingua franca between the
 * IR, the graph, YAML cross-highlighting, and diagnostics. Keep them stable.
 * ========================================================================== */

export const WORKFLOW = "workflow";

export const workflowField = (field: string): string => `workflow:${field}`;

export const jobPath = (jobId: string): string => `job:${jobId}`;

export const jobField = (jobId: string, field: string): string =>
  `job:${jobId}:${field}`;

export const stepPath = (jobId: string, index: number): string =>
  `step:${jobId}#${index}`;

export const triggerPath = (event: string): string => `trigger:${event}`;

export interface ParsedPath {
  kind: "workflow" | "workflow-field" | "job" | "job-field" | "step" | "trigger";
  jobId?: string;
  field?: string;
  stepIndex?: number;
  event?: string;
}

/** Parse a canonical node path back into its parts. */
export function parsePath(path: string): ParsedPath {
  if (path === WORKFLOW) return { kind: "workflow" };
  if (path.startsWith("workflow:")) {
    return { kind: "workflow-field", field: path.slice("workflow:".length) };
  }
  if (path.startsWith("trigger:")) {
    return { kind: "trigger", event: path.slice("trigger:".length) };
  }
  if (path.startsWith("step:")) {
    const rest = path.slice("step:".length);
    const hash = rest.lastIndexOf("#");
    if (hash >= 0) {
      return {
        kind: "step",
        jobId: rest.slice(0, hash),
        stepIndex: Number(rest.slice(hash + 1)),
      };
    }
    return { kind: "step", jobId: rest };
  }
  if (path.startsWith("job:")) {
    const rest = path.slice("job:".length);
    const colon = rest.indexOf(":");
    if (colon >= 0) {
      return {
        kind: "job-field",
        jobId: rest.slice(0, colon),
        field: rest.slice(colon + 1),
      };
    }
    return { kind: "job", jobId: rest };
  }
  return { kind: "workflow" };
}

/** The owning job id for any path, if it has one (job or step paths). */
export function jobIdOfPath(path: string): string | undefined {
  const p = parsePath(path);
  return p.jobId;
}

/** A short, human-friendly label for a path (used in diagnostics rows). */
export function prettyPath(path: string): string {
  const p = parsePath(path);
  switch (p.kind) {
    case "workflow":
      return "workflow";
    case "workflow-field":
      return p.field ?? "workflow";
    case "trigger":
      return `on · ${p.event}`;
    case "job":
      return p.jobId ?? "job";
    case "job-field":
      return `${p.jobId} · ${p.field}`;
    case "step":
      return p.stepIndex != null
        ? `${p.jobId} · step ${p.stepIndex + 1}`
        : `${p.jobId} · step`;
  }
}
