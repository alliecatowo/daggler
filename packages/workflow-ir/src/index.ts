/* ============================================================================
 * @daggler/workflow-ir — the semantic core.
 * Parse native GitHub Actions YAML into a WorkflowIR, project it into a graph,
 * serialize it back to YAML, and apply source-preserving structured edits.
 * ========================================================================== */

export * from "./ir/types.js";
export * from "./ir/paths.js";
export { SourceMap, makePositioner } from "./ir/source-map.js";

export { parseWorkflow, type ParseOptions } from "./parse/parse.js";
export {
  parseActionRef,
  parseReusableCall,
  parsePermissions,
  parseTriggers,
  parseStrategy,
  parseMatrix,
  parseExpression,
  classifyRef,
} from "./parse/normalize.js";

export { buildGraph } from "./graph/build.js";
export * from "./graph/types.js";

export { serialize, denormalize } from "./serialize/serialize.js";
export {
  applyCommand,
  pinActionToSha,
  type EditorCommand,
  type PatchResult,
} from "./patches/patch.js";

export {
  SAMPLE_WORKFLOWS,
  SAMPLE_BY_ID,
  type SampleWorkflow,
} from "./samples.js";
