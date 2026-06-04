/* ============================================================================
 * applyCommand — source-preserving structured edits.
 *
 * Visual/inspector edits are commands, not blind object mutation. Each command
 * is applied to the YAML CST via the `yaml` Document API (setIn/deleteIn), so
 * comments, key order, and formatting *elsewhere* in the file survive. After a
 * patch the caller re-parses the returned source to rebuild the IR and graph.
 * ========================================================================== */

import { isSeq, parseDocument, type Document } from "yaml";

export type EditorCommand =
  | { type: "workflow.rename"; name: string }
  | { type: "job.rename"; jobId: string; name: string }
  | { type: "job.runsOn"; jobId: string; runsOn: string }
  | { type: "job.addNeed"; jobId: string; need: string }
  | { type: "job.removeNeed"; jobId: string; need: string }
  | { type: "step.setName"; jobId: string; index: number; name: string }
  | { type: "step.setUses"; jobId: string; index: number; uses: string }
  | { type: "step.setRun"; jobId: string; index: number; run: string }
  | { type: "step.setWith"; jobId: string; index: number; key: string; value: string }
  | {
      type: "permissions.set";
      scope: "workflow" | { jobId: string };
      key: string;
      level: "read" | "write" | "none";
    }
  | {
      type: "step.add";
      jobId: string;
      /** Insert position within the steps sequence. Appends when omitted. */
      index?: number;
      step: {
        uses?: string;
        run?: string;
        name?: string;
        with?: Record<string, string | number | boolean>;
      };
    }
  | { type: "step.remove"; jobId: string; index: number };

export interface PatchResult {
  source: string;
  ok: boolean;
  error?: string;
}

function jobBase(jobId: string): (string | number)[] {
  return ["jobs", jobId];
}
function stepBase(jobId: string, index: number): (string | number)[] {
  return ["jobs", jobId, "steps", index];
}

function currentNeeds(doc: Document, jobId: string): string[] {
  const raw = doc.getIn([...jobBase(jobId), "needs"]) as unknown;
  const js = raw == null ? null : (doc.createNode(raw).toJSON() as unknown);
  if (js == null) return [];
  return Array.isArray(js) ? js.map(String) : [String(js)];
}

export function applyCommand(source: string, command: EditorCommand): PatchResult {
  const doc = parseDocument(source, { version: "1.2" });
  if (doc.errors.length) {
    return { source, ok: false, error: "Cannot patch a document with parse errors" };
  }

  try {
    switch (command.type) {
      case "workflow.rename":
        doc.set("name", command.name);
        break;

      case "job.rename":
        doc.setIn([...jobBase(command.jobId), "name"], command.name);
        break;

      case "job.runsOn":
        doc.setIn([...jobBase(command.jobId), "runs-on"], command.runsOn);
        break;

      case "job.addNeed": {
        const needs = new Set(currentNeeds(doc, command.jobId));
        needs.add(command.need);
        doc.setIn([...jobBase(command.jobId), "needs"], [...needs]);
        break;
      }

      case "job.removeNeed": {
        const needs = currentNeeds(doc, command.jobId).filter(
          (n) => n !== command.need,
        );
        if (needs.length) {
          doc.setIn([...jobBase(command.jobId), "needs"], needs);
        } else {
          doc.deleteIn([...jobBase(command.jobId), "needs"]);
        }
        break;
      }

      case "step.setName":
        doc.setIn([...stepBase(command.jobId, command.index), "name"], command.name);
        break;

      case "step.setUses":
        doc.setIn([...stepBase(command.jobId, command.index), "uses"], command.uses);
        break;

      case "step.setRun":
        doc.setIn([...stepBase(command.jobId, command.index), "run"], command.run);
        break;

      case "step.setWith":
        doc.setIn(
          [...stepBase(command.jobId, command.index), "with", command.key],
          command.value,
        );
        break;

      case "permissions.set": {
        const base =
          command.scope === "workflow"
            ? ["permissions"]
            : [...jobBase(command.scope.jobId), "permissions"];
        doc.setIn([...base, command.key], command.level);
        break;
      }

      case "step.add": {
        // Build a plain JS object for the new step in canonical key order
        // (name first, then uses/run, then with) so createNode produces a tidy map.
        const stepObj: Record<string, unknown> = {};
        if (command.step.name !== undefined) stepObj["name"] = command.step.name;
        if (command.step.uses !== undefined) {
          stepObj["uses"] = command.step.uses;
          if (command.step.with !== undefined) stepObj["with"] = command.step.with;
        } else if (command.step.run !== undefined) {
          stepObj["run"] = command.step.run;
        }
        const stepNode = doc.createNode(stepObj);

        const stepsPath = [...jobBase(command.jobId), "steps"];
        const existing = doc.getIn(stepsPath, true);
        if (isSeq(existing)) {
          // Insert at the requested index or append.
          if (command.index !== undefined) {
            existing.items.splice(command.index, 0, stepNode);
          } else {
            existing.items.push(stepNode);
          }
        } else {
          // Job has no steps key yet — create the sequence.
          doc.setIn(stepsPath, doc.createNode([stepObj]));
        }
        break;
      }

      case "step.remove": {
        const stepsPath = [...jobBase(command.jobId), "steps"];
        const seq = doc.getIn(stepsPath, true);
        if (isSeq(seq)) {
          seq.items.splice(command.index, 1);
        }
        break;
      }
    }
    return { source: String(doc), ok: true };
  } catch (err) {
    return { source, ok: false, error: (err as Error).message };
  }
}

/**
 * Replace an action ref's `@tag`/`@branch` with a pinned SHA (with the original
 * version trailing in a comment), preserving everything else in the file. Used
 * by the "Pin to SHA" quick-fix.
 */
export function pinActionToSha(
  source: string,
  jobId: string,
  stepIndex: number,
  sha: string,
  versionComment?: string,
): PatchResult {
  const doc = parseDocument(source, { version: "1.2" });
  if (doc.errors.length) return { source, ok: false, error: "parse errors" };
  try {
    const path = [...stepBase(jobId, stepIndex), "uses"];
    const current = doc.getIn(path);
    if (typeof current !== "string") {
      return { source, ok: false, error: "step has no `uses`" };
    }
    const at = current.lastIndexOf("@");
    const namePart = at >= 0 ? current.slice(0, at) : current;
    const oldRef = at >= 0 ? current.slice(at + 1) : "";
    doc.setIn(path, `${namePart}@${sha}`);
    // attach a trailing comment with the human-readable version
    const node = doc.getIn(path, true) as { comment?: string } | undefined;
    if (node) node.comment = ` ${versionComment ?? oldRef}`;
    return { source: String(doc), ok: true };
  } catch (err) {
    return { source, ok: false, error: (err as Error).message };
  }
}
