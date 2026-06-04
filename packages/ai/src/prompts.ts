/* ============================================================================
 * @daggler/ai — prompts
 *
 * buildSystemPrompt() — a STABLE, PURE system prompt (no timestamps, no
 *   randomness) suitable for Anthropic prompt caching.
 * buildUserPrompt()   — per-request user turn including workflow YAML and
 *   intent-specific instructions.
 * ========================================================================== */

import type { AiIntent } from "./types.js";

// ---------------------------------------------------------------------------
// System prompt (stable — never mutate at runtime so prompt cache hits land)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `\
You are a GitHub Actions security and authoring expert embedded in Daggler, a semantic IDE for GitHub Actions workflows.

## Role
You analyze, harden, and generate GitHub Actions workflow YAML. You return ONLY valid structured JSON matching the schema below — never prose, never markdown, never partial JSON.

## Response schema
Always respond with a single JSON object (no surrounding text or code fences):
{
  "intent":      "explain" | "harden" | "generate",
  "explanation": "<detailed explanation — plain English, no YAML fences>",
  "summary":     "<one sentence, ≤ 120 chars, suitable for a commit message>",
  "edits":       [ ...ProposedEdit ],
  "proposedYaml": "<full workflow YAML — only present for 'generate' intent>",
  "confidence":  "low" | "medium" | "high"
}

## ProposedEdit variants
Each edit is a JSON object with a "type" discriminant and type-specific fields:

| type               | required fields                                      |
|--------------------|------------------------------------------------------|
| workflow.rename    | name: string                                         |
| job.rename         | jobId, name                                          |
| job.runsOn         | jobId, runsOn                                        |
| job.addNeed        | jobId, need                                          |
| job.removeNeed     | jobId, need                                          |
| step.setName       | jobId, index (0-based int), name                     |
| step.setUses       | jobId, index, uses                                   |
| step.setRun        | jobId, index, run                                    |
| step.setWith       | jobId, index, key, value (all strings)               |
| permissions.set    | scope ("workflow" or {jobId}), key, level (read/write/none) |
| step.add           | jobId, step ({name?, uses?, run?, with?}), index?    |
| step.remove        | jobId, index                                         |

## Intent-specific rules

### explain
- Walk through what the workflow does: triggers, jobs, steps, permissions, environment.
- Flag any notable risks (missing permissions, mutable action refs, secret exposure).
- Return edits: [] (no edits for explanations).
- confidence: "high" unless the YAML is ambiguous.

### harden
- Apply least-privilege permissions (prefer read-only at workflow level; add write only where needed).
- Pin action refs to a full 40-char SHA and record the version in a trailing comment.
- Fix expression injection risks (wrap \${{ github.event.* }} in env vars before shell use).
- Return structured edits for every fix; also reflect them in the explanation.
- confidence: "high" if all issues were addressed, "medium" if some are uncertain.

### generate
- Create a complete, idiomatic, well-commented workflow YAML from the user description.
- Return proposedYaml with the full YAML string.
- Edits should be [] (the caller uses proposedYaml directly).
- Use explicit permissions blocks; pin third-party actions to SHAs.
- confidence: "medium" (generation is inherently uncertain without context).

## Non-negotiable rules
1. NEVER fabricate secrets, tokens, credentials, or SHA values you do not know.
2. NEVER return partial JSON or trailing text outside the JSON object.
3. NEVER invent action SHA pins — emit the ref as-is and note in explanation that pins require manual lookup.
4. If you are uncertain about a field, make your best effort and lower confidence to "low".
5. The explanation field must be plain text — no markdown, no YAML fences.
`;

/**
 * Returns the canonical system prompt for the Daggler AI assistant.
 * This function is PURE and STABLE — it always returns the identical string
 * so that Anthropic's prompt cache can be populated on the first request and
 * hit on every subsequent one.
 */
export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

// ---------------------------------------------------------------------------
// User prompt (per-request)
// ---------------------------------------------------------------------------

export interface UserPromptOptions {
  /** Daggler validation findings to include for "harden" intent. */
  validation?: string;
}

/**
 * Build the per-request user turn for the AI assistant.
 *
 * @param intent  - One of "explain" | "harden" | "generate".
 * @param yaml    - The workflow YAML source (or a plain-English description
 *                  for "generate" intent).
 * @param opts    - Optional extras (e.g. validation findings for "harden").
 */
export function buildUserPrompt(
  intent: AiIntent,
  yaml: string,
  opts: UserPromptOptions = {},
): string {
  switch (intent) {
    case "explain":
      return buildExplainPrompt(yaml);
    case "harden":
      return buildHardenPrompt(yaml, opts.validation);
    case "generate":
      return buildGeneratePrompt(yaml);
  }
}

// ---------------------------------------------------------------------------
// Intent-specific helpers
// ---------------------------------------------------------------------------

function buildExplainPrompt(yaml: string): string {
  return `\
Intent: explain

Workflow YAML:
\`\`\`yaml
${yaml}
\`\`\`

Provide a clear, plain-English walkthrough of this workflow:
- What triggers it (on: events).
- What each job does and in what order (needs graph).
- What each significant step does.
- What permissions are granted (explicit or implicit).
- Any notable security risks or anti-patterns.

Return edits: [] — do not propose changes for an explain request.
Respond with the JSON schema described in your system prompt.`;
}

function buildHardenPrompt(yaml: string, validation?: string): string {
  const findingsBlock =
    validation != null && validation.trim().length > 0
      ? `\nCurrent Daggler security findings:\n${validation}\n`
      : "";

  return `\
Intent: harden
${findingsBlock}
Workflow YAML:
\`\`\`yaml
${yaml}
\`\`\`

Harden this workflow by applying the following fixes as concrete structured edits:
1. Least-privilege permissions — add an explicit permissions block at the workflow or job level granting only what is actually needed; use read-only for everything else.
2. SHA-pin mutable action refs — for any "uses: owner/repo@branch-or-tag" step, note in the explanation that manual SHA lookup is required (do NOT fabricate SHAs).
3. Expression injection — move \${{ github.event.* }} or other user-controlled expressions into env vars before they reach shell scripts.

For each fix, emit a ProposedEdit in the edits array matching the schema.
Explain every change you make in the explanation field.
Respond with the JSON schema described in your system prompt.`;
}

function buildGeneratePrompt(description: string): string {
  return `\
Intent: generate

Workflow description:
${description}

Generate a complete, idiomatic GitHub Actions workflow YAML that fulfills this description:
- Include an explicit permissions block with least-privilege grants.
- Pin any well-known actions to a representative ref (note that real SHA pins require manual lookup).
- Add concise inline comments explaining non-obvious configuration.
- Use a sensible workflow name and job/step names.

Return the full YAML in the proposedYaml field and set edits: [].
Respond with the JSON schema described in your system prompt.`;
}
