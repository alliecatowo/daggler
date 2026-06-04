/* ============================================================================
 * A small, curated actions catalog: metadata for the famous actions plus a
 * trust model. Powers the actions-metadata layer (required/unknown inputs,
 * cache hints, deprecated versions), the trust scoring shown in the catalog UI,
 * and the "pin to SHA" quick-fix.
 *
 * The SHAs in KNOWN_SHAS are REAL, resolved from the GitHub API against the
 * stated tags — so the pin-to-SHA fix produces something you can actually ship.
 * ========================================================================== */

import type { ActionRef } from "@daggler/workflow-ir";

export interface ActionInput {
  name: string;
  required?: boolean;
  description?: string;
}

export interface ActionMeta {
  owner: string;
  repo: string;
  fullName: string;
  /** First-party GitHub action (actions/*, github/*). */
  official: boolean;
  /** Verified-creator org (still third-party for SHA-pinning purposes). */
  verified: boolean;
  description: string;
  runtime: "node" | "docker" | "composite";
  inputs: ActionInput[];
  outputs: string[];
  /** Action has a built-in dependency cache option (cache hint). */
  supportsCache?: boolean;
  /** Recognized cloud-auth / OIDC action (justifies id-token: write). */
  oidc?: boolean;
  /** Major versions considered deprecated → recommend upgrade. */
  deprecatedRefs?: string[];
  latestMajor?: string;
}

export const OFFICIAL_OWNERS = new Set(["actions", "github"]);
export const VERIFIED_OWNERS = new Set([
  "docker",
  "aws-actions",
  "google-github-actions",
  "azure",
  "hashicorp",
  "actions-rs",
]);

function meta(m: Omit<ActionMeta, "fullName" | "official" | "verified">): ActionMeta {
  return {
    ...m,
    fullName: `${m.owner}/${m.repo}`,
    official: OFFICIAL_OWNERS.has(m.owner),
    verified: VERIFIED_OWNERS.has(m.owner),
  };
}

const CATALOG_LIST: ActionMeta[] = [
  meta({
    owner: "actions",
    repo: "checkout",
    description: "Check out a repository under $GITHUB_WORKSPACE.",
    runtime: "node",
    inputs: [
      { name: "repository" },
      { name: "ref" },
      { name: "token" },
      { name: "ssh-key" },
      { name: "persist-credentials" },
      { name: "path" },
      { name: "clean" },
      { name: "fetch-depth" },
      { name: "fetch-tags" },
      { name: "lfs" },
      { name: "submodules" },
      { name: "set-safe-directory" },
    ],
    outputs: ["ref", "commit"],
    deprecatedRefs: ["v1", "v2", "v3"],
    latestMajor: "v4",
  }),
  meta({
    owner: "actions",
    repo: "setup-node",
    description: "Set up a Node.js environment and optionally cache npm/yarn/pnpm.",
    runtime: "node",
    inputs: [
      { name: "always-auth" },
      { name: "node-version" },
      { name: "node-version-file" },
      { name: "architecture" },
      { name: "check-latest" },
      { name: "registry-url" },
      { name: "scope" },
      { name: "token" },
      { name: "cache" },
      { name: "cache-dependency-path" },
    ],
    outputs: ["node-version", "cache-hit"],
    supportsCache: true,
    deprecatedRefs: ["v1", "v2", "v3"],
    latestMajor: "v4",
  }),
  meta({
    owner: "actions",
    repo: "setup-python",
    description: "Set up a Python environment and optionally cache pip/pipenv/poetry.",
    runtime: "node",
    inputs: [
      { name: "python-version" },
      { name: "python-version-file" },
      { name: "cache" },
      { name: "architecture" },
      { name: "check-latest" },
      { name: "token" },
      { name: "cache-dependency-path" },
      { name: "allow-prereleases" },
    ],
    outputs: ["python-version", "cache-hit", "python-path"],
    supportsCache: true,
    deprecatedRefs: ["v1", "v2", "v3", "v4"],
    latestMajor: "v5",
  }),
  meta({
    owner: "actions",
    repo: "upload-artifact",
    description: "Upload build artifacts from your workflow.",
    runtime: "node",
    inputs: [
      { name: "name" },
      { name: "path", required: true },
      { name: "if-no-files-found" },
      { name: "retention-days" },
      { name: "compression-level" },
      { name: "overwrite" },
      { name: "include-hidden-files" },
    ],
    outputs: ["artifact-id", "artifact-url"],
    deprecatedRefs: ["v1", "v2", "v3"],
    latestMajor: "v4",
  }),
  meta({
    owner: "actions",
    repo: "download-artifact",
    description: "Download build artifacts in your workflow.",
    runtime: "node",
    inputs: [
      { name: "name" },
      { name: "path" },
      { name: "pattern" },
      { name: "merge-multiple" },
      { name: "github-token" },
      { name: "repository" },
      { name: "run-id" },
    ],
    outputs: ["download-path"],
    deprecatedRefs: ["v1", "v2", "v3"],
    latestMajor: "v4",
  }),
  meta({
    owner: "actions",
    repo: "cache",
    description: "Cache dependencies and build outputs to speed up workflows.",
    runtime: "node",
    inputs: [
      { name: "path", required: true },
      { name: "key", required: true },
      { name: "restore-keys" },
      { name: "upload-chunk-size" },
      { name: "enableCrossOsArchive" },
      { name: "fail-on-cache-miss" },
      { name: "lookup-only" },
    ],
    outputs: ["cache-hit"],
    latestMajor: "v4",
  }),
  meta({
    owner: "docker",
    repo: "build-push-action",
    description: "Build and push Docker images with BuildKit.",
    runtime: "node",
    inputs: [
      { name: "context" },
      { name: "file" },
      { name: "push" },
      { name: "tags" },
      { name: "labels" },
      { name: "platforms" },
      { name: "build-args" },
      { name: "secrets" },
      { name: "cache-from" },
      { name: "cache-to" },
      { name: "load" },
      { name: "pull" },
      { name: "target" },
    ],
    // NB: there is no `tag` output — outputs are imageid/digest/metadata.
    outputs: ["imageid", "digest", "metadata"],
    latestMajor: "v6",
  }),
  meta({
    owner: "docker",
    repo: "login-action",
    description: "Log in to a Docker registry.",
    runtime: "node",
    inputs: [
      { name: "registry" },
      { name: "username" },
      { name: "password" },
      { name: "ecr" },
      { name: "logout" },
    ],
    outputs: [],
    latestMajor: "v3",
  }),
  meta({
    owner: "aws-actions",
    repo: "configure-aws-credentials",
    description: "Configure AWS credentials, including OIDC role assumption.",
    runtime: "node",
    inputs: [
      { name: "aws-region", required: true },
      { name: "role-to-assume" },
      { name: "aws-access-key-id" },
      { name: "aws-secret-access-key" },
      { name: "role-session-name" },
      { name: "web-identity-token-file" },
      { name: "audience" },
      { name: "role-duration-seconds" },
    ],
    outputs: ["aws-account-id"],
    oidc: true,
    latestMajor: "v4",
  }),
  meta({
    owner: "google-github-actions",
    repo: "auth",
    description: "Authenticate to Google Cloud, including Workload Identity OIDC.",
    runtime: "node",
    inputs: [
      { name: "workload_identity_provider" },
      { name: "service_account" },
      { name: "credentials_json" },
      { name: "token_format" },
    ],
    outputs: ["access_token", "id_token"],
    oidc: true,
    latestMajor: "v2",
  }),
  meta({
    owner: "azure",
    repo: "login",
    description: "Log in to Azure, including OIDC federated credentials.",
    runtime: "node",
    inputs: [
      { name: "client-id" },
      { name: "tenant-id" },
      { name: "subscription-id" },
      { name: "creds" },
    ],
    outputs: [],
    oidc: true,
    latestMajor: "v2",
  }),
];

export const ACTION_CATALOG: Record<string, ActionMeta> = Object.fromEntries(
  CATALOG_LIST.map((m) => [m.fullName, m]),
);

/** Real, API-resolved commit SHAs for the tags used in samples. */
export const KNOWN_SHAS: Record<string, Record<string, string>> = {
  "actions/checkout": {
    v4: "34e114876b0b11c390a56381ad16ebd13914f8d5",
    "v4.2.2": "11bd71901bbe5b1630ceea73d27597364c9af683",
  },
  "actions/setup-node": {
    v4: "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "v4.1.0": "39370e3970a6d050c480ffad4ff0ed4d3fdee5af",
  },
  "actions/upload-artifact": {
    v4: "ea165f8d65b6e75b540449e92b4886f43607fa02",
    "v4.4.3": "b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882",
  },
  "docker/build-push-action": {
    v5: "ca052bb54ab0790a636c9b5f226502c73d547a25",
    "v6.10.0": "48aba3b46d1b1fec4febb7c5d0c644b249a11355",
  },
  "aws-actions/configure-aws-credentials": {
    v4: "e3dd6a429d7300a6a4c196c26e071d42e0343502",
    "v4.0.2": "e3dd6a429d7300a6a4c196c26e071d42e0343502",
  },
};

export function lookupActionMeta(
  owner?: string,
  repo?: string,
): ActionMeta | undefined {
  if (!owner || !repo) return undefined;
  return ACTION_CATALOG[`${owner}/${repo}`];
}

/** Resolve a tag/branch to a real pinned SHA, if we know one. */
export function resolveSha(
  fullName: string,
  ref?: string,
): { sha: string; note: string } | undefined {
  if (!ref) return undefined;
  const table = KNOWN_SHAS[fullName];
  if (!table) return undefined;
  const sha = table[ref];
  if (!sha) return undefined;
  return { sha, note: ref };
}

export interface TrustReport {
  score: number;
  level: "high" | "medium" | "low";
  official: boolean;
  pinned: "sha" | "tag" | "branch" | "unknown";
  reasons: string[];
}

export function trustOf(ref: ActionRef): TrustReport {
  const reasons: string[] = [];
  let score = 50;
  const official = ref.owner ? OFFICIAL_OWNERS.has(ref.owner) : false;
  const verified = ref.owner ? VERIFIED_OWNERS.has(ref.owner) : false;

  if (official) {
    score += 40;
    reasons.push("First-party GitHub action");
  } else if (verified) {
    score += 20;
    reasons.push("Verified-creator organization");
  } else if (ref.kind === "local") {
    score += 30;
    reasons.push("Local action in this repository");
  } else {
    reasons.push("Third-party action");
  }

  const pinned = (ref.refKind ?? "unknown") as TrustReport["pinned"];
  if (pinned === "sha") {
    score += 20;
    reasons.push("Pinned to a full commit SHA");
  } else if (pinned === "tag") {
    reasons.push("Pinned to a mutable tag");
  } else if (pinned === "branch") {
    score -= 25;
    reasons.push("Tracks a moving branch");
  }

  score = Math.max(0, Math.min(100, score));
  const level: TrustReport["level"] =
    score >= 75 ? "high" : score >= 50 ? "medium" : "low";
  return { score, level, official, pinned, reasons };
}
