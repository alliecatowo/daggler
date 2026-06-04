/**
 * packages/validators/src/policies/packs.ts
 *
 * Catalogue of built-in policy packs shipped with @daggler/validators.
 * Each pack groups a set of PolicyRule codes that are meaningful to a
 * particular workflow author persona or deployment context.
 *
 * Packs are referenced by PolicyRule.packs[] and surfaced in the Daggler
 * IDE so users can enable/disable entire rule groups in one click.
 */

import type { PolicyPack } from "../types.js";

export const POLICY_PACKS: PolicyPack[] = [
  {
    id: "oss-maintainer",
    name: "Open Source Maintainer",
    description:
      "Essential security rules for open-source repositories that accept pull requests from untrusted contributors.",
  },
  {
    id: "enterprise-least-privilege",
    name: "Enterprise Least Privilege",
    description:
      "Enforces minimal GITHUB_TOKEN permissions and job-level permission scoping for regulated enterprise environments.",
  },
  {
    id: "release-hardening",
    name: "Release Hardening",
    description:
      "Locks down release and publish workflows by requiring pinned actions, provenance attestation, and environment approvals.",
  },
  {
    id: "ai-agent-safety",
    name: "AI Agent Workflow Safety",
    description:
      "Guards automated AI-driven workflows against prompt-injection via untrusted inputs and unconstrained write permissions.",
  },
  {
    id: "docker-publishing",
    name: "Docker Publishing",
    description:
      "Validates best practices for workflows that build and push container images, including image signing and registry hygiene.",
  },
  {
    id: "cloud-deploy",
    name: "Cloud Deploy",
    description:
      "Checks cloud deployment workflows for secure credential handling, environment gates, and least-privilege IAM usage.",
  },
];
