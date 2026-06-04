/* ============================================================================
 * actionlint.ts — ActionlintAdapter
 *
 * Shells out to the `actionlint` binary to produce structured findings for a
 * given workflow YAML string.  Honest when actionlint is absent: returns
 * { available: false, findings: [] } rather than throwing.
 * ========================================================================== */

import { spawnSync } from "node:child_process";
import { isActionlintAvailable, which, writeTempWorkflow } from "./tools.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActionlintFinding {
  line: number;
  col: number;
  message: string;
  kind: string;
}

export interface ActionlintResult {
  available: boolean;
  findings: ActionlintFinding[];
}

/** Lightweight diagnostic shape used when integrating with the validator layer. */
export interface ActionlintDiagnostic {
  code: string;          // "actionlint:<kind>"
  severity: "warning";   // actionlint findings are always warnings
  source: "actionlint";
  message: string;
  line: number;
  col: number;
}

// ---------------------------------------------------------------------------
// Raw JSON shape emitted by `actionlint -format '{{json .}}'`
// ---------------------------------------------------------------------------

interface RawActionlintItem {
  message?: string;
  filepath?: string;
  line?: number;
  column?: number;
  type?: string;
  // actionlint nests the "kind" under `kind` or `type`
  kind?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Run actionlint on `yaml` and return structured findings.
 *
 * @param yaml   Raw YAML string of the workflow.
 * @param path   Optional path hint shown in messages (does NOT affect the
 *               actual file written to disk — we always write a real temp file
 *               so actionlint can resolve relative includes if needed).
 */
export function runActionlint(
  yaml: string,
  path?: string,
): ActionlintResult {
  if (!isActionlintAvailable()) {
    return { available: false, findings: [] };
  }

  const name = path
    ? path.replace(/.*[\\/]/, "")   // basename only
    : "workflow.yml";

  const tmp = writeTempWorkflow(yaml, name);

  try {
    const bin = which("actionlint")!; // guarded by isActionlintAvailable()

    const result = spawnSync(
      bin,
      ["-no-color", "-format", "{{json .}}", tmp.file],
      {
        encoding: "utf8",
        timeout: 30_000,
        // actionlint exits with 1 when findings are present — that is expected.
        // We capture both streams and parse stdout.
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // Parse JSON output — actionlint emits a JSON array on stdout.
    let raw: RawActionlintItem[] = [];
    if (result.stdout && result.stdout.trim().length > 0) {
      try {
        const parsed: unknown = JSON.parse(result.stdout.trim());
        if (Array.isArray(parsed)) {
          raw = parsed as RawActionlintItem[];
        }
      } catch {
        // malformed JSON — treat as no findings
      }
    }

    const findings: ActionlintFinding[] = raw.map((item) => ({
      line: item.line ?? 0,
      col: item.column ?? 0,
      message: item.message ?? "(no message)",
      kind: item.kind ?? item.type ?? "unknown",
    }));

    return { available: true, findings };
  } finally {
    tmp.cleanup();
  }
}

/**
 * Map actionlint findings to the lightweight diagnostic shape.
 */
export function toDiagnostics(
  findings: ActionlintFinding[],
): ActionlintDiagnostic[] {
  return findings.map((f) => ({
    code: `actionlint:${f.kind}`,
    severity: "warning",
    source: "actionlint",
    message: f.message,
    line: f.line,
    col: f.col,
  }));
}

/** Named export object for callers that prefer an object API. */
export const ActionlintAdapter = {
  runActionlint,
  toDiagnostics,
} as const;
