/* ============================================================================
 * @daggler/simulate — trigger matching
 *
 * matchesTrigger compares a TriggerIR against an EventFixture and returns
 * whether the trigger fires, plus a human-readable reason.
 * ========================================================================== */

import type { TriggerIR } from "@daggler/workflow-ir";
import type { EventFixture } from "./types.js";

/* -------------------------------------------------------------------------- */
/* Glob matching                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A small, safe glob matcher that supports:
 *   *   — any sequence of characters that does not include "/"
 *   **  — any sequence of characters including "/"
 *   **\/  — recursive directory prefix
 *
 * This deliberately does NOT use any external library so that the package
 * stays isomorphic and dependency-free at runtime.
 */
export function matchGlob(pattern: string, value: string): boolean {
  return matchGlobSegments(pattern, value, 0, 0);
}

function matchGlobSegments(
  pattern: string,
  value: string,
  pi: number,
  vi: number,
): boolean {
  while (pi < pattern.length) {
    const pc = pattern[pi];

    if (pc === "*") {
      // Check for "**"
      const isDouble = pattern[pi + 1] === "*";

      if (isDouble) {
        // Advance past "**" and any immediately following "/"
        let nextPi = pi + 2;
        if (pattern[nextPi] === "/") nextPi++;

        // "**" at the very end matches everything remaining
        if (nextPi >= pattern.length) return true;

        // Try matching the rest of the pattern against every suffix of value
        for (let vi2 = vi; vi2 <= value.length; vi2++) {
          // Only try at "/" boundaries (or at the very start / end)
          if (
            vi2 === vi ||
            vi2 === value.length ||
            value[vi2 - 1] === "/"
          ) {
            if (matchGlobSegments(pattern, value, nextPi, vi2)) return true;
          }
        }
        return false;
      } else {
        // Single "*": matches any sequence that does not cross a "/"
        const nextPi = pi + 1;

        // Try matching zero or more characters (not "/") then continue
        for (let vi2 = vi; vi2 <= value.length; vi2++) {
          if (vi2 > vi && value[vi2 - 1] === "/") break;
          if (matchGlobSegments(pattern, value, nextPi, vi2)) return true;
        }
        return false;
      }
    }

    // Literal character match
    if (vi >= value.length || value[vi] !== pc) return false;
    pi++;
    vi++;
  }

  // Pattern exhausted; value must also be exhausted
  return vi === value.length;
}

/* -------------------------------------------------------------------------- */
/* Ref helpers                                                                  */
/* -------------------------------------------------------------------------- */

/** Extract the short ref name from a fully-qualified ref. */
function refName(ref: string): string {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  return ref;
}

function isTag(ref: string): boolean {
  return ref.startsWith("refs/tags/");
}

/* -------------------------------------------------------------------------- */
/* List filter helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Returns true when the value matches at least one pattern in the list.
 * An empty/absent list means "no filter" — everything passes.
 */
function matchesAny(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((p) => matchGlob(p, value));
}

/**
 * Returns true when the value does NOT match any pattern in the ignore list.
 * An empty/absent ignore list means "nothing is ignored" — everything passes.
 */
function notIgnored(ignorePatterns: string[] | undefined, value: string): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) return true;
  return !ignorePatterns.some((p) => matchGlob(p, value));
}

/**
 * Returns true when at least one path in changedPaths satisfies the paths filter.
 * If changedPaths is absent we cannot verify, so we conservatively return true.
 */
function pathsMatch(
  patterns: string[] | undefined,
  ignorePatterns: string[] | undefined,
  changedPaths: string[] | undefined,
): boolean {
  // No path filters at all — always pass
  if ((!patterns || patterns.length === 0) && (!ignorePatterns || ignorePatterns.length === 0)) {
    return true;
  }

  // If we have no information about changed paths, we cannot filter
  if (!changedPaths || changedPaths.length === 0) return true;

  for (const p of changedPaths) {
    const allowed = matchesAny(patterns, p);
    const notIgnoredResult = notIgnored(ignorePatterns, p);
    if (allowed && notIgnoredResult) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Main export                                                                  */
/* -------------------------------------------------------------------------- */

export interface TriggerMatchResult {
  matched: boolean;
  reason: string;
}

/**
 * Determine whether a single TriggerIR fires for the given EventFixture.
 */
export function matchesTrigger(
  trigger: TriggerIR,
  fx: EventFixture,
): TriggerMatchResult {
  // Event name must match exactly
  if (trigger.event !== fx.event) {
    return {
      matched: false,
      reason: `Event "${fx.event}" does not match trigger "${trigger.event}"`,
    };
  }

  const ref = fx.ref ?? "refs/heads/main";
  const name = refName(ref);
  const tag = isTag(ref);

  // Activity type filter (e.g. pull_request types: [opened, synchronize])
  if (trigger.types && trigger.types.length > 0) {
    if (!fx.action) {
      return {
        matched: false,
        reason: `Trigger "${trigger.event}" requires an activity type but none was provided`,
      };
    }
    if (!trigger.types.includes(fx.action)) {
      return {
        matched: false,
        reason: `Activity type "${fx.action}" is not in [${trigger.types.join(", ")}]`,
      };
    }
  }

  // For push-like events, apply branch / tag / path filters
  const hasBranchFilter =
    (trigger.branches && trigger.branches.length > 0) ||
    (trigger.branchesIgnore && trigger.branchesIgnore.length > 0);
  const hasTagFilter =
    (trigger.tags && trigger.tags.length > 0) ||
    (trigger.tagsIgnore && trigger.tagsIgnore.length > 0);

  if (hasBranchFilter || hasTagFilter) {
    if (tag) {
      // Tag ref: apply tag filters if present, otherwise fail branch filters
      if (hasTagFilter) {
        const allowed = matchesAny(trigger.tags, name);
        const notIgnoredResult = notIgnored(trigger.tagsIgnore, name);
        if (!allowed) {
          return {
            matched: false,
            reason: `Tag "${name}" does not match tags filter [${(trigger.tags ?? []).join(", ")}]`,
          };
        }
        if (!notIgnoredResult) {
          return {
            matched: false,
            reason: `Tag "${name}" is excluded by tags-ignore filter`,
          };
        }
      } else {
        // Only branch filters exist; a tag ref does not match branch filters
        return {
          matched: false,
          reason: `Ref "${ref}" is a tag but trigger only has branch filters`,
        };
      }
    } else {
      // Branch ref
      if (hasTagFilter && !hasBranchFilter) {
        // Trigger only has tag filters; a branch ref cannot match
        return {
          matched: false,
          reason: `Ref "${ref}" is a branch but trigger only has tag filters`,
        };
      }
      if (hasBranchFilter) {
        const allowed = matchesAny(trigger.branches, name);
        const notIgnoredResult = notIgnored(trigger.branchesIgnore, name);
        if (!allowed) {
          return {
            matched: false,
            reason: `Branch "${name}" does not match branches filter [${(trigger.branches ?? []).join(", ")}]`,
          };
        }
        if (!notIgnoredResult) {
          return {
            matched: false,
            reason: `Branch "${name}" is excluded by branches-ignore filter`,
          };
        }
      }
    }
  }

  // Path filter
  const hasPathFilter =
    (trigger.paths && trigger.paths.length > 0) ||
    (trigger.pathsIgnore && trigger.pathsIgnore.length > 0);

  if (hasPathFilter) {
    if (!pathsMatch(trigger.paths, trigger.pathsIgnore, fx.changedPaths)) {
      return {
        matched: false,
        reason: "No changed path matches the paths filter",
      };
    }
  }

  // All filters passed
  return {
    matched: true,
    reason: `Trigger "${trigger.event}" matched`,
  };
}
