/**
 * Argument validation for anything that ends up in a `gh` argv or an API path.
 *
 * `gh api` takes an endpoint string, so an unchecked owner/repo/path such as
 * "a/b/../../orgs/x?foo=" would reach a different API route, and a value
 * starting with "-" can be read as a flag. Everything is checked against a
 * strict allowlist before any process is spawned.
 */

const SLUG_PART_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9_./-]{1,200}$/;
const PATH_RE = /^[A-Za-z0-9_./ -]{1,300}$/;

export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(`INVALID_ARGUMENT: ${message}`);
    this.name = "InvalidArgumentError";
  }
}

function isSlugPart(v: unknown): v is string {
  return (
    typeof v === "string" && SLUG_PART_RE.test(v) && v !== "." && v !== ".." && !v.startsWith("-")
  );
}

export function assertRepoRef(repo: { owner: unknown; repo: unknown }): void {
  if (!isSlugPart(repo.owner)) throw new InvalidArgumentError("invalid repository owner");
  if (!isSlugPart(repo.repo)) throw new InvalidArgumentError("invalid repository name");
}

export function assertRef(ref: unknown, what = "ref"): asserts ref is string {
  if (
    typeof ref !== "string" ||
    !REF_RE.test(ref) ||
    ref.includes("..") ||
    ref.startsWith("-") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".lock")
  ) {
    throw new InvalidArgumentError(`invalid ${what}`);
  }
}

export function assertRepoPath(path: unknown): asserts path is string {
  if (
    typeof path !== "string" ||
    !PATH_RE.test(path) ||
    path.startsWith("-") ||
    path.startsWith("/") ||
    path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")
  ) {
    throw new InvalidArgumentError("invalid path");
  }
}

export function assertSha(sha: unknown): asserts sha is string {
  if (typeof sha !== "string" || !/^[0-9a-f]{7,64}$/i.test(sha)) {
    throw new InvalidArgumentError("invalid sha");
  }
}

/** Workflow input names are passed as `-f key=value`; keep the key tame. */
export function assertInputKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(key)) {
    throw new InvalidArgumentError("invalid workflow input name");
  }
}
