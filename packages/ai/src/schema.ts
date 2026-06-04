/* ============================================================================
 * @daggler/ai — schema
 *
 * Zod schema for AiResult. The edits array uses a discriminated union that
 * mirrors every EditorCommand variant in @daggler/workflow-ir/patches/patch.ts.
 * ========================================================================== */

import { z } from "zod";

// ---------------------------------------------------------------------------
// EditorCommand discriminated-union variants
// ---------------------------------------------------------------------------

const WorkflowRenameSchema = z.object({
  type: z.literal("workflow.rename"),
  name: z.string(),
});

const JobRenameSchema = z.object({
  type: z.literal("job.rename"),
  jobId: z.string(),
  name: z.string(),
});

const JobRunsOnSchema = z.object({
  type: z.literal("job.runsOn"),
  jobId: z.string(),
  runsOn: z.string(),
});

const JobAddNeedSchema = z.object({
  type: z.literal("job.addNeed"),
  jobId: z.string(),
  need: z.string(),
});

const JobRemoveNeedSchema = z.object({
  type: z.literal("job.removeNeed"),
  jobId: z.string(),
  need: z.string(),
});

const StepSetNameSchema = z.object({
  type: z.literal("step.setName"),
  jobId: z.string(),
  index: z.number().int().nonnegative(),
  name: z.string(),
});

const StepSetUsesSchema = z.object({
  type: z.literal("step.setUses"),
  jobId: z.string(),
  index: z.number().int().nonnegative(),
  uses: z.string(),
});

const StepSetRunSchema = z.object({
  type: z.literal("step.setRun"),
  jobId: z.string(),
  index: z.number().int().nonnegative(),
  run: z.string(),
});

const StepSetWithSchema = z.object({
  type: z.literal("step.setWith"),
  jobId: z.string(),
  index: z.number().int().nonnegative(),
  key: z.string(),
  value: z.string(),
});

const PermissionsSetSchema = z.object({
  type: z.literal("permissions.set"),
  scope: z.union([z.literal("workflow"), z.object({ jobId: z.string() })]),
  key: z.string(),
  level: z.enum(["read", "write", "none"]),
});

const StepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  name: z.string().optional(),
  with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const StepAddSchema = z.object({
  type: z.literal("step.add"),
  jobId: z.string(),
  index: z.number().int().nonnegative().optional(),
  step: StepSchema,
});

const StepRemoveSchema = z.object({
  type: z.literal("step.remove"),
  jobId: z.string(),
  index: z.number().int().nonnegative(),
});

/** Discriminated union matching all EditorCommand variants. */
export const ProposedEditSchema = z.discriminatedUnion("type", [
  WorkflowRenameSchema,
  JobRenameSchema,
  JobRunsOnSchema,
  JobAddNeedSchema,
  JobRemoveNeedSchema,
  StepSetNameSchema,
  StepSetUsesSchema,
  StepSetRunSchema,
  StepSetWithSchema,
  PermissionsSetSchema,
  StepAddSchema,
  StepRemoveSchema,
]);

// ---------------------------------------------------------------------------
// AiResult schema
// ---------------------------------------------------------------------------

export const AiResultSchema = z.object({
  intent: z.enum(["explain", "harden", "generate"]),
  explanation: z.string(),
  summary: z.string(),
  edits: z.array(ProposedEditSchema),
  proposedYaml: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]),
});

export type AiResultParsed = z.infer<typeof AiResultSchema>;
