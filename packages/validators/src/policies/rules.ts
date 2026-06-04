/* ============================================================================
 * @daggler/validators — POLICY_RULES catalog
 *
 * Declarative policy and security rules evaluated against a WorkflowIR. Each
 * rule is a pure function: ValidationContext → RawFinding[]. The orchestrator
 * (index.ts) assigns stable ids and resolves source spans; rules only specify
 * *which canonical node path* is affected and *why*.
 *
 * Rule codes:
 *   POL001 – No top-level permissions block
 *   POL002 – Third-party action not SHA-pinned
 *   POL003 – Privileged token on an untrusted event
 *   POL004 – Secret reachable from untrusted event
 *   POL005 – Broad contents:write on PR workflow
 *   POL006 – Deploy without environment gate
 *   POL007 – Action ref uses a branch
 *   POL008 – Shell injection from untrusted input
 *   POL009 – OIDC permission without a cloud step
 *   POL010 – Workflow modifies workflow files
 *   AGENT001 – Untrusted input flows into an AI agent
 *   AGENT002 – Over-permitted AI agent
 *   AGENT003 – Agent output executed
 * ========================================================================== */

import { jobPath, workflowField } from "@daggler/workflow-ir";
import type { PolicyRule, RawFinding } from "../types.js";
import {
  collectExpressions,
  eachStep,
  eachUsesStep,
  effectivePermissions,
  hasTrigger,
  PRIVILEGED_UNTRUSTED_EVENTS,
  UNTRUSTED_EVENT_FIELDS,
} from "../walk.js";
import { lookupActionMeta } from "./catalog.js";

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/** True if a PermissionIR grants write at the top level or for a specific scope. */
function grantsWrite(
  perms: import("@daggler/workflow-ir").PermissionIR | undefined,
): boolean {
  if (!perms) return false;
  if (perms.all === "write") return true;
  if (perms.scopes) {
    for (const level of Object.values(perms.scopes)) {
      if (level === "write") return true;
    }
  }
  return false;
}

/** Returns the first write scope name found, or undefined. */
function firstWriteScope(
  perms: import("@daggler/workflow-ir").PermissionIR | undefined,
): string | undefined {
  if (!perms) return undefined;
  if (perms.all === "write") return "write-all";
  if (perms.scopes) {
    for (const [scope, level] of Object.entries(perms.scopes)) {
      if (level === "write") return scope;
    }
  }
  return undefined;
}

/** True if a PermissionIR grants id-token:write. */
function grantsIdTokenWrite(
  perms: import("@daggler/workflow-ir").PermissionIR | undefined,
): boolean {
  if (!perms) return false;
  if (perms.all === "write") return true;
  return perms.scopes?.["id-token"] === "write";
}

/**
 * Return the list of UNTRUSTED_EVENT_FIELDS present in an expression body.
 * The body is trimmed when comparing.
 */
function untrustedFieldsInBody(body: string): string[] {
  return UNTRUSTED_EVENT_FIELDS.filter((f) => body.includes(f));
}

/**
 * True if the uses-string / owner+repo / display-name looks like an AI agent.
 */
function looksLikeAiAgent(
  uses: string,
  withKeys: string[],
): boolean {
  const aiPattern = /ai|agent|llm|gpt|claude|copilot|anthropic|openai|gemini/i;
  if (aiPattern.test(uses)) return true;
  const agentInputKeys = new Set([
    "prompt",
    "instructions",
    "system-prompt",
    "query",
    "input",
    "message",
  ]);
  return withKeys.some((k) => agentInputKeys.has(k));
}

/* ---------------------------------------------------------------------------
 * Rule definitions
 * ------------------------------------------------------------------------- */

export const POLICY_RULES: PolicyRule[] = [
  // -------------------------------------------------------------------------
  // POL001 — No top-level permissions block
  // -------------------------------------------------------------------------
  {
    code: "POL001",
    title: "No top-level permissions",
    severity: "warning",
    source: "policy",
    appliesTo: "workflow",
    description:
      "Workflows without an explicit top-level permissions: block inherit the repository's default token scopes, which are usually read-write. Declaring a minimal block reduces the blast radius of a compromised step.",
    packs: ["oss-maintainer", "enterprise-least-privilege"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token",
    exampleBad: `# no permissions: block — inherits default broad scopes
jobs:
  build:
    steps:
      - run: echo hi`,
    exampleGood: `permissions:
  contents: read
jobs:
  build:
    steps:
      - run: echo hi`,
    evaluate(ctx): RawFinding[] {
      if (ctx.ir.permissions !== undefined) return [];
      return [
        {
          code: "POL001",
          severity: "warning",
          source: "policy",
          title: "No top-level permissions",
          message:
            "No top-level 'permissions:' block — the workflow inherits broad default token scopes; add an explicit least-privilege block.",
          path: workflowField("permissions"),
        },
      ];
    },
  },

  // -------------------------------------------------------------------------
  // POL002 — Third-party action not SHA-pinned
  // -------------------------------------------------------------------------
  {
    code: "POL002",
    title: "Third-party action not SHA-pinned",
    severity: "error",
    source: "security",
    appliesTo: "step",
    description:
      "Third-party actions pinned to a mutable tag (e.g. @v5) can be silently replaced by the action's author. Pin to a full 40-character commit SHA to guarantee reproducibility and supply-chain integrity.",
    packs: ["oss-maintainer", "release-hardening", "enterprise-least-privilege"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions",
    exampleBad: `- uses: some-org/deploy-action@v2   # mutable tag`,
    exampleGood: `- uses: some-org/deploy-action@a1b2c3d4e5f6...  # full SHA`,
    evaluate(ctx): RawFinding[] {
      const findings: RawFinding[] = [];
      for (const { job, step } of eachUsesStep(ctx.ir)) {
        if (step.ref.kind !== "remote") continue;
        if (step.ref.refKind !== "tag") continue;
        const meta = lookupActionMeta(step.ref.owner, step.ref.repo);
        // Official actions (actions/*, github/*) are exempt.
        if (meta && meta.official) continue;
        const action = step.uses;
        findings.push({
          code: "POL002",
          severity: "error",
          source: "security",
          title: "Third-party action not SHA-pinned",
          message: `'${action}' is pinned to a mutable tag — an upstream push can silently change what runs. Pin to a full commit SHA instead.`,
          path: step.path,
          fix: {
            label: "Pin to SHA",
            pinSha: { jobId: job.id, stepIndex: step.index },
          },
          docsUrl:
            "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions",
        });
      }
      return findings;
    },
  },

  // -------------------------------------------------------------------------
  // POL003 — Privileged token on an untrusted event
  // -------------------------------------------------------------------------
  {
    code: "POL003",
    title: "Privileged token on an untrusted event",
    severity: "error",
    source: "security",
    appliesTo: "workflow",
    description:
      "Workflows triggered by events like pull_request_target or issue_comment run with the base repository's privileges while handling attacker-controlled content. Granting write permissions in this configuration is a critical security risk.",
    packs: ["oss-maintainer", "enterprise-least-privilege"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
    exampleBad: `on:
  pull_request_target:
permissions:
  contents: write`,
    exampleGood: `on:
  pull_request_target:
permissions:
  contents: read`,
    evaluate(ctx): RawFinding[] {
      const { ir } = ctx;
      if (!hasTrigger(ir, PRIVILEGED_UNTRUSTED_EVENTS)) return [];
      const perms = ir.permissions;
      if (!grantsWrite(perms)) return [];

      // Identify which dangerous events are present.
      const dangerEvents = ir.on
        .filter((t) => PRIVILEGED_UNTRUSTED_EVENTS.includes(t.event))
        .map((t) => t.event);

      const writeScopeName = firstWriteScope(perms) ?? "write";
      return [
        {
          code: "POL003",
          severity: "error",
          source: "security",
          title: "Privileged token on an untrusted event",
          message: `Workflow runs on ${dangerEvents.join(", ")} (an untrusted event) and grants ${writeScopeName} permission — attacker-controlled code can exfiltrate secrets or modify the repository.`,
          path: workflowField("permissions"),
          docsUrl:
            "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
        },
      ];
    },
  },

  // -------------------------------------------------------------------------
  // POL004 — Secret reachable from untrusted event
  // -------------------------------------------------------------------------
  {
    code: "POL004",
    title: "Secret reachable from untrusted event",
    severity: "error",
    source: "security",
    appliesTo: "step",
    description:
      "When a workflow is triggered by an untrusted event (e.g. pull_request_target) and references secrets other than GITHUB_TOKEN, attacker-controlled code can exfiltrate those secrets.",
    packs: ["oss-maintainer"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
    evaluate(ctx): RawFinding[] {
      const { ir } = ctx;
      if (!hasTrigger(ir, PRIVILEGED_UNTRUSTED_EVENTS)) return [];

      const findings: RawFinding[] = [];
      const secretPattern = /\bsecrets\.([A-Za-z0-9_]+)/g;

      for (const expr of collectExpressions(ir)) {
        // Only care about step-level expressions (path starts with "step:").
        if (!expr.path.startsWith("step:")) continue;

        const matches = [...expr.body.matchAll(secretPattern)];
        for (const match of matches) {
          const secretName = match[1];
          if (!secretName || secretName === "GITHUB_TOKEN") continue;
          findings.push({
            code: "POL004",
            severity: "error",
            source: "security",
            title: "Secret reachable from untrusted event",
            message: `Secret '${secretName}' is exposed to a workflow that runs on an untrusted event and may execute attacker-controlled code.`,
            path: expr.path,
            docsUrl:
              "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
          });
        }
      }

      // Deduplicate by path+secret combination.
      const seen = new Set<string>();
      return findings.filter((f) => {
        const key = `${f.path}::${f.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  },

  // -------------------------------------------------------------------------
  // POL005 — Broad contents:write on PR workflow
  // -------------------------------------------------------------------------
  {
    code: "POL005",
    title: "Broad contents:write on PR workflow",
    severity: "warning",
    source: "policy",
    appliesTo: "workflow",
    description:
      "A workflow triggered only by pull_request with contents:write is unnecessarily broad. PR workflows can be triggered by external contributors; prefer contents:read and use a separate push/release workflow for writes.",
    packs: ["oss-maintainer"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token",
    evaluate(ctx): RawFinding[] {
      const { ir } = ctx;
      const perms = ir.permissions;
      // Check for contents:write or write-all.
      const hasContentsWrite =
        perms?.all === "write" || perms?.scopes?.["contents"] === "write";
      if (!hasContentsWrite) return [];

      const triggerEvents = new Set(ir.on.map((t) => t.event));

      // Only fire when pull_request is present (NOT pull_request_target — POL003).
      if (!triggerEvents.has("pull_request")) return [];

      // Must NOT have pull_request_target (that's POL003's domain).
      if (triggerEvents.has("pull_request_target")) return [];

      // Must NOT have a push or release trigger (those legitimately need writes).
      if (triggerEvents.has("push") || triggerEvents.has("release")) return [];

      return [
        {
          code: "POL005",
          severity: "warning",
          source: "policy",
          title: "Broad contents:write on PR workflow",
          message:
            "Workflow is triggered by pull_request and grants contents:write — PR workflows may be run by external contributors. Prefer contents:read and move write operations to a push or release workflow.",
          path: workflowField("permissions"),
          docsUrl:
            "https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token",
        },
      ];
    },
  },

  // -------------------------------------------------------------------------
  // POL006 — Deploy without environment gate
  // -------------------------------------------------------------------------
  {
    code: "POL006",
    title: "Deploy without environment gate",
    severity: "warning",
    source: "policy",
    appliesTo: "job",
    description:
      "Deploy-like jobs (matching deploy/release/publish/promote in name or id, using an OIDC cloud-auth action, or granting id-token:write) without an environment: block lack required-reviewer protection gates.",
    packs: ["release-hardening", "cloud-deploy"],
    docsUrl:
      "https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment",
    evaluate(ctx): RawFinding[] {
      const { ir } = ctx;
      const findings: RawFinding[] = [];

      const deployPattern = /deploy|release|publish|promote/i;

      // Known OIDC cloud-auth action fullNames.
      const oidcActions = new Set([
        "aws-actions/configure-aws-credentials",
        "google-github-actions/auth",
        "azure/login",
      ]);

      for (const job of ir.jobs) {
        if (job.environment !== undefined) continue; // Already gated — skip.

        const nameOrId = `${job.id} ${job.name ?? ""}`;
        const isDeployByName = deployPattern.test(nameOrId);

        // Check for OIDC actions in steps.
        const hasOidcStep = job.steps.some((step) => {
          if (step.kind !== "uses") return false;
          if (step.ref.kind !== "remote") return false;
          const fullName = `${step.ref.owner ?? ""}/${step.ref.repo ?? ""}`;
          return oidcActions.has(fullName);
        });

        // Check effectivePermissions for id-token:write.
        const effPerms = effectivePermissions(ir, job);
        const hasIdTokenWrite = grantsIdTokenWrite(effPerms);

        if (!isDeployByName && !hasOidcStep && !hasIdTokenWrite) continue;

        findings.push({
          code: "POL006",
          severity: "warning",
          source: "policy",
          title: "Deploy without environment gate",
          message: `Deploy-like job '${job.id}' has no \`environment:\` protection gate — add one to require reviewer approval before deploying.`,
          path: jobPath(job.id),
          docsUrl:
            "https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment",
        });
      }
      return findings;
    },
  },

  // -------------------------------------------------------------------------
  // POL007 — Action ref uses a branch
  // -------------------------------------------------------------------------
  {
    code: "POL007",
    title: "Action ref uses a branch",
    severity: "error",
    source: "security",
    appliesTo: "step",
    description:
      "Referencing an action by a branch name (e.g. @main) means each run may execute different code. Pin to a release tag or, better, a full commit SHA.",
    packs: ["release-hardening", "enterprise-least-privilege"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions",
    exampleBad: `- uses: aws-actions/configure-aws-credentials@main`,
    exampleGood: `- uses: aws-actions/configure-aws-credentials@v4  # or a SHA`,
    evaluate(ctx): RawFinding[] {
      const findings: RawFinding[] = [];
      for (const { job, step } of eachUsesStep(ctx.ir)) {
        if (step.ref.kind !== "remote") continue;
        if (step.ref.refKind !== "branch") continue;
        findings.push({
          code: "POL007",
          severity: "error",
          source: "security",
          title: "Action ref uses a branch",
          message: `'${step.uses}' tracks a moving branch — each run may execute different code. Pin to a release tag or a full commit SHA.`,
          path: step.path,
          fix: {
            label: "Pin to SHA",
            pinSha: { jobId: job.id, stepIndex: step.index },
          },
          docsUrl:
            "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions",
        });
      }
      return findings;
    },
  },

  // -------------------------------------------------------------------------
  // POL008 — Shell injection from untrusted input
  // -------------------------------------------------------------------------
  {
    code: "POL008",
    title: "Shell injection from untrusted input",
    severity: "error",
    source: "security",
    appliesTo: "step",
    description:
      "Interpolating attacker-controlled GitHub event fields directly into a run: script allows code injection. Pass the value via an environment variable and quote it in the script instead.",
    packs: ["oss-maintainer", "enterprise-least-privilege"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
    exampleBad: `- run: echo "\${{ github.event.pull_request.title }}"`,
    exampleGood: `- env:\n    PR_TITLE: \${{ github.event.pull_request.title }}\n  run: echo "$PR_TITLE"`,
    evaluate(ctx): RawFinding[] {
      const findings: RawFinding[] = [];

      for (const expr of collectExpressions(ctx.ir)) {
        if (expr.field !== "run") continue;
        // Check if this expression body references an untrusted event field.
        const matched = untrustedFieldsInBody(expr.body);
        if (matched.length === 0) continue;

        for (const field of matched) {
          findings.push({
            code: "POL008",
            severity: "error",
            source: "security",
            title: "Shell injection from untrusted input",
            message: `Untrusted '${field}' is interpolated into a shell script — an attacker can inject commands. Pass it via an env var and quote it instead.`,
            path: expr.path,
            docsUrl:
              "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
          });
        }
      }

      // Deduplicate: one finding per (path, field) combination.
      const seen = new Set<string>();
      return findings.filter((f) => {
        const key = `${f.path}::${f.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  },

  // -------------------------------------------------------------------------
  // POL009 — OIDC permission without a cloud step
  // -------------------------------------------------------------------------
  {
    code: "POL009",
    title: "OIDC permission without a cloud step",
    severity: "warning",
    source: "policy",
    appliesTo: "job",
    description:
      "A job granting id-token:write that does not include a recognized cloud-auth (OIDC) action likely has unnecessary permissions. Remove id-token:write or add the appropriate cloud-auth action.",
    packs: ["cloud-deploy", "enterprise-least-privilege"],
    docsUrl:
      "https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect",
    evaluate(ctx): RawFinding[] {
      const { ir } = ctx;
      const findings: RawFinding[] = [];

      for (const job of ir.jobs) {
        const effPerms = effectivePermissions(ir, job);
        if (!grantsIdTokenWrite(effPerms)) continue;

        // Check whether any uses-step in this job resolves to an OIDC action.
        const hasOidcStep = job.steps.some((step) => {
          if (step.kind !== "uses") return false;
          if (step.ref.kind !== "remote") return false;
          const meta = lookupActionMeta(step.ref.owner, step.ref.repo);
          return meta?.oidc === true;
        });

        if (hasOidcStep) continue;

        findings.push({
          code: "POL009",
          severity: "warning",
          source: "policy",
          title: "OIDC permission without a cloud step",
          message: `Job '${job.id}' grants id-token:write but none of its steps use a recognized cloud-auth (OIDC) action — remove the permission or add the appropriate cloud-auth action.`,
          path: jobPath(job.id),
          docsUrl:
            "https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect",
        });
      }
      return findings;
    },
  },

  // -------------------------------------------------------------------------
  // POL010 — Workflow modifies workflow files
  // -------------------------------------------------------------------------
  {
    code: "POL010",
    title: "Workflow modifies workflow files",
    severity: "warning",
    source: "policy",
    appliesTo: "step",
    description:
      "A workflow step that writes to .github/workflows/ can alter other workflows, potentially bypassing code-review gates or escalating privileges.",
    packs: ["enterprise-least-privilege"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions",
    evaluate(ctx): RawFinding[] {
      const findings: RawFinding[] = [];
      for (const { step } of eachStep(ctx.ir)) {
        if (step.kind !== "run") continue;
        if (!step.run.includes(".github/workflows")) continue;
        findings.push({
          code: "POL010",
          severity: "warning",
          source: "policy",
          title: "Workflow modifies workflow files",
          message:
            "This run step references '.github/workflows' — writing to workflow files from within a workflow can bypass code-review gates and escalate privileges.",
          path: step.path,
          docsUrl:
            "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions",
        });
      }
      return findings;
    },
  },

  // -------------------------------------------------------------------------
  // AGENT001 — Untrusted input flows into an AI agent
  // -------------------------------------------------------------------------
  {
    code: "AGENT001",
    title: "Untrusted input flows into an AI agent",
    severity: "error",
    source: "security",
    appliesTo: "step",
    description:
      "Passing attacker-controlled issue or PR content directly into an AI agent's prompt on a privileged trigger enables prompt injection attacks. The agent may be manipulated into executing malicious instructions.",
    packs: ["ai-agent-safety"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
    exampleBad: `- uses: example/ai-agent-action@v2\n  with:\n    prompt: "\${{ github.event.issue.body }}"`,
    exampleGood: `- uses: example/ai-agent-action@v2
  with:
    # Use a sanitized, static prompt — never interpolate user content
    prompt: "Triage the linked issue according to our SLA policy."`,
    evaluate(ctx): RawFinding[] {
      const { ir } = ctx;
      if (!hasTrigger(ir, PRIVILEGED_UNTRUSTED_EVENTS)) return [];

      const findings: RawFinding[] = [];

      for (const { step } of eachUsesStep(ir)) {
        const withObj = step.with ?? {};
        const withKeys = Object.keys(withObj);

        if (!looksLikeAiAgent(step.uses, withKeys)) continue;

        // Check if any `with` value references an untrusted event field.
        for (const [key, value] of Object.entries(withObj)) {
          if (typeof value !== "string") continue;
          // Collect expressions from the raw value string.
          // We look for ${{ ... }} patterns containing untrusted fields.
          const exprPattern = /\$\{\{\s*([^}]+?)\s*\}\}/g;
          const matches = [...value.matchAll(exprPattern)];
          for (const match of matches) {
            const body = match[1]?.trim() ?? "";
            const untrusted = untrustedFieldsInBody(body);
            if (untrusted.length === 0) continue;
            for (const field of untrusted) {
              findings.push({
                code: "AGENT001",
                severity: "error",
                source: "security",
                title: "Untrusted input flows into an AI agent",
                message: `Untrusted '${field}' flows into the AI agent's '${key}' input on an untrusted trigger — classic agentic prompt injection.`,
                path: step.path,
                docsUrl:
                  "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections",
              });
            }
          }
        }
      }

      // Deduplicate.
      const seen = new Set<string>();
      return findings.filter((f) => {
        const key = `${f.path}::${f.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  },

  // -------------------------------------------------------------------------
  // AGENT002 — Over-permitted AI agent
  // -------------------------------------------------------------------------
  {
    code: "AGENT002",
    title: "Over-permitted AI agent",
    severity: "warning",
    source: "security",
    appliesTo: "step",
    description:
      "An AI agent step that is granted shell/write/exec tools together with a repo token or write permissions creates a large attack surface for prompt injection — a compromised model response can execute arbitrary actions.",
    packs: ["ai-agent-safety"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions",
    evaluate(ctx): RawFinding[] {
      const { ir } = ctx;
      const findings: RawFinding[] = [];

      const toolGrantingKeys = new Set([
        "allow-tools",
        "tools",
        "permissions",
        "allowed-tools",
      ]);
      const dangerousToolPattern = /shell|write|exec|bash|run/i;
      const tokenKeys = new Set(["github-token", "token"]);

      for (const { job, step } of eachUsesStep(ir)) {
        const withObj = step.with ?? {};
        const withKeys = Object.keys(withObj);

        if (!looksLikeAiAgent(step.uses, withKeys)) continue;

        // Find a tool-granting `with` key whose value mentions dangerous tools.
        const hasDangerousTools = withKeys.some((k) => {
          if (!toolGrantingKeys.has(k)) return false;
          const v = withObj[k];
          if (typeof v !== "string") return false;
          return dangerousToolPattern.test(v);
        });
        if (!hasDangerousTools) continue;

        // Check for token or write perms on workflow/job.
        const effPerms = effectivePermissions(ir, job);
        const hasWritePerms = grantsWrite(effPerms);
        const hasToken = withKeys.some((k) => tokenKeys.has(k));

        if (!hasWritePerms && !hasToken) continue;

        findings.push({
          code: "AGENT002",
          severity: "warning",
          source: "security",
          title: "Over-permitted AI agent",
          message: `The agent at step '${step.uses}' is granted shell/write tools together with a token/write scope — a prompt-injection attack here can execute arbitrary actions.`,
          path: step.path,
          docsUrl:
            "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions",
        });
      }
      return findings;
    },
  },

  // -------------------------------------------------------------------------
  // AGENT003 — Agent output executed
  // -------------------------------------------------------------------------
  {
    code: "AGENT003",
    title: "Agent output executed",
    severity: "error",
    source: "security",
    appliesTo: "step",
    description:
      "A run step that reads output from an earlier (agent) step and pipes it into a shell execution primitive (git apply, | sh, eval, etc.) turns untrusted model output into executable code.",
    packs: ["ai-agent-safety"],
    docsUrl:
      "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions",
    evaluate(ctx): RawFinding[] {
      const findings: RawFinding[] = [];

      // Pattern matching step output references.
      const stepOutputPattern = /steps\.[a-zA-Z0-9_-]+\.outputs\./;
      // Dangerous shell-exec patterns.
      const shellExecPattern =
        /git\s+apply|\|\s*sh\b|\|\s*bash\b|\beval\b|chmod\s+\+x\b|\bsource\s+/;

      for (const { step } of eachStep(ctx.ir)) {
        if (step.kind !== "run") continue;
        const script = step.run;
        if (!stepOutputPattern.test(script)) continue;
        if (!shellExecPattern.test(script)) continue;

        findings.push({
          code: "AGENT003",
          severity: "error",
          source: "security",
          title: "Agent output executed",
          message:
            "Output from an earlier (agent) step is piped into shell execution — untrusted model output becomes code. Validate or sandbox the output before executing it.",
          path: step.path,
          docsUrl:
            "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions",
        });
      }
      return findings;
    },
  },
];
