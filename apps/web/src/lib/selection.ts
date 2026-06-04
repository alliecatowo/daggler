/* Selection ↔ node-path mapping shared by every editor surface. */
import { parsePath } from "@daggler/workflow-ir";
import type { Selection } from "./store";

/** The primary node path a selection should highlight in the YAML. */
export function selectionToPath(sel: Selection): string | null {
  if (!sel) return null;
  if (sel.type === "workflow") return "workflow:name";
  if (sel.type === "job") return `job:${sel.id}`;
  return `step:${sel.id}#${sel.stepIndex}`;
}

/** Convert a canonical node path (from a cursor/click) into a Selection. */
export function pathToSelection(path: string | undefined): Selection {
  if (!path) return null;
  const p = parsePath(path);
  switch (p.kind) {
    case "workflow":
    case "workflow-field":
    case "trigger":
      return { type: "workflow" };
    case "job":
    case "job-field":
      return p.jobId ? { type: "job", id: p.jobId } : null;
    case "step":
      return p.jobId != null && p.stepIndex != null
        ? { type: "step", id: p.jobId, stepIndex: p.stepIndex }
        : null;
  }
}

/** A stable string key for a Selection, for cheap equality checks. */
export function selectionKey(sel: Selection): string {
  if (!sel) return "none";
  if (sel.type === "workflow") return "workflow";
  if (sel.type === "job") return `job:${sel.id}`;
  return `step:${sel.id}#${sel.stepIndex}`;
}
