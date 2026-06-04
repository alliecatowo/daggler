/* ============================================================================
 * @daggler/ai — apply
 *
 * applyAiEdits — apply a sequence of ProposedEdits to a YAML source string
 * using @daggler/workflow-ir's applyCommand. Each edit is attempted in order;
 * failures are recorded but do not abort the remaining edits.
 * ========================================================================== */

import { applyCommand } from "@daggler/workflow-ir";
import type { ProposedEdit } from "./types.js";

export interface ApplyResult {
  /** The final YAML source after all successful edits. */
  source: string;
  /** Number of edits that were applied successfully. */
  applied: number;
  /** Human-readable error descriptions for edits that failed. */
  errors: string[];
}

/**
 * Apply a sequence of {@link ProposedEdit}s to a workflow YAML source string.
 *
 * Edits are applied in order. If an edit fails (e.g. the target job/step does
 * not exist), the failure is recorded in `errors` and the next edit is
 * attempted against the most recent successful source. The final `source`
 * always reflects only the edits that succeeded.
 *
 * @pure — no I/O, no side effects.
 */
export function applyAiEdits(
  source: string,
  edits: ProposedEdit[],
): ApplyResult {
  let current = source;
  let applied = 0;
  const errors: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    if (edit === undefined) continue;

    const result = applyCommand(current, edit);
    if (result.ok) {
      current = result.source;
      applied++;
    } else {
      errors.push(
        `Edit ${i} (${edit.type}): ${result.error ?? "unknown error"}`,
      );
    }
  }

  return { source: current, applied, errors };
}
