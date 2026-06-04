/* ============================================================================
 * @daggler/ai — types
 *
 * AiIntent, AI_MODEL constant, ProposedEdit (re-export of EditorCommand),
 * and the AiResult response shape.
 * ========================================================================== */

import type { EditorCommand } from "@daggler/workflow-ir";

export type AiIntent = "explain" | "harden" | "generate";

/** The Anthropic model used for AI-assisted workflow authoring. */
export const AI_MODEL = "claude-opus-4-8" as const;

/**
 * A proposed structured edit to a workflow YAML document.
 * Exactly the EditorCommand union from @daggler/workflow-ir — re-exported
 * here so callers only need to import from @daggler/ai.
 */
export type ProposedEdit = EditorCommand;

export type AiResult = {
  intent: AiIntent;
  /** A human-readable explanation of the AI's analysis or generation. */
  explanation: string;
  /** A short one-sentence summary suitable for a toast / commit message. */
  summary: string;
  /** Structured edits to apply to the workflow source. */
  edits: ProposedEdit[];
  /**
   * For "generate" intent: the full proposed workflow YAML as a string.
   * Absent for "explain" and "harden".
   */
  proposedYaml?: string;
  confidence: "low" | "medium" | "high";
};
