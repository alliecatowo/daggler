/* ============================================================================
 * tools.ts — shared helpers for shelling out to the local toolchain.
 *
 * All helpers are honest: they detect what is actually present and report
 * truthfully. No binary is assumed; every call is guarded.
 * ========================================================================== */

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// PATH resolution
// ---------------------------------------------------------------------------

/**
 * Extra directories to search for binaries beyond what PATH provides.
 * We always include ~/.local/bin so that act / actionlint installed there
 * are found without requiring the user to modify their shell profile.
 */
function extraDirs(): string[] {
  const home = os.homedir();
  return [path.join(home, ".local", "bin")];
}

/**
 * Resolve the absolute path of `bin`, honouring both PATH and ~/.local/bin.
 * Returns null when the binary cannot be found.
 */
export function which(bin: string): string | null {
  // Build an augmented PATH that includes our extra dirs.
  const pathEnv = process.env["PATH"] ?? "";
  const dirs = [...extraDirs(), ...pathEnv.split(path.delimiter)];

  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not found / not executable — try next dir
    }
  }
  return null;
}

/**
 * Return the version string emitted by `bin --version`, or null if the binary
 * is absent or the invocation fails.
 */
export function toolVersion(bin: string): string | null {
  const resolved = which(bin);
  if (!resolved) return null;
  try {
    const result = spawnSync(resolved, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim().split("\n")[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when `act` binary is present AND `docker info` exits cleanly.
 * Both are required for any local act-based run to succeed.
 */
export function isActAvailable(): boolean {
  if (!which("act")) return false;

  // Detect docker: prefer "docker" but also accept "podman" (act supports it).
  const dockerBin = which("docker") ?? which("podman");
  if (!dockerBin) return false;

  try {
    const result = spawnSync(dockerBin, ["info"], {
      encoding: "utf8",
      timeout: 8_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * True when `actionlint` binary is present and reports a version.
 */
export function isActionlintAvailable(): boolean {
  return toolVersion("actionlint") !== null;
}

// ---------------------------------------------------------------------------
// Temp-workflow file helpers
// ---------------------------------------------------------------------------

/** Monotonic counter used to produce unique temp-dir names without Date/random. */
let _tempCounter = 0;

export interface TempWorkflow {
  /** The temp directory root (contains .github/workflows/). */
  dir: string;
  /** Full path to the written .yml file. */
  file: string;
  /** Remove the temp dir and all its contents. */
  cleanup(): void;
}

/**
 * Write `yaml` to a temp directory at `.github/workflows/<name>.yml`.
 *
 * The directory name is derived from the process PID and a monotonically
 * increasing counter — no Date, no Math.random — so the function is
 * deterministic within a single process lifetime (useful for debugging).
 */
export function writeTempWorkflow(yaml: string, name: string): TempWorkflow {
  const id = `${process.pid}-${++_tempCounter}`;
  const dir = path.join(os.tmpdir(), `daggler-runner-${id}`);
  const workflowsDir = path.join(dir, ".github", "workflows");

  fs.mkdirSync(workflowsDir, { recursive: true });

  const fileName = name.endsWith(".yml") || name.endsWith(".yaml") ? name : `${name}.yml`;
  const file = path.join(workflowsDir, fileName);
  fs.writeFileSync(file, yaml, "utf8");

  return {
    dir,
    file,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup — never throw
      }
    },
  };
}
