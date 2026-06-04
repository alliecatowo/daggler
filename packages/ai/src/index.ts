/* ============================================================================
 * @daggler/ai — public API
 * ========================================================================== */

export type { AiIntent, AiResult, ProposedEdit } from "./types.js";
export { AI_MODEL } from "./types.js";

export { AiResultSchema, ProposedEditSchema } from "./schema.js";
export type { AiResultParsed } from "./schema.js";

export { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
export type { UserPromptOptions } from "./prompts.js";

export { applyAiEdits } from "./apply.js";
export type { ApplyResult } from "./apply.js";
