/* ============================================================================
 * daggler bridge — apps/cli/src/bridge.ts
 *
 * Local capability probe: detects tools on the current machine that a
 * GitHub Actions runner would need and prints a formatted Capabilities card.
 *
 * Design note: pairing with the Daggler cloud app over WSS is not implemented
 * in this build. This command reports what a local runner on this machine could
 * do — nothing more and nothing less. No results are faked.
 * ============================================================================ */

import { execSync } from "node:child_process";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolSpec {
  /** Binary name passed to `which`. */
  bin: string;
  /** Display label shown in the card. */
  label: string;
  /** One-line hint shown when the tool is absent. */
  installHint: string;
  /** If set, run this after locating the binary to capture a version string. */
  versionFlag?: string;
}

interface ProbeResult {
  spec: ToolSpec;
  found: boolean;
  /** Resolved path from `which`, or undefined when not found. */
  binPath?: string;
  /** Version string captured via versionFlag, or undefined. */
  version?: string;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS: ToolSpec[] = [
  {
    bin: "git",
    label: "git",
    installHint: "https://git-scm.com/downloads",
    versionFlag: "--version",
  },
  {
    bin: "docker",
    label: "docker",
    installHint: "https://docs.docker.com/get-docker/",
    versionFlag: "--version",
  },
  {
    bin: "act",
    label: "act  (local Actions runner)",
    installHint: "brew install act  /  https://github.com/nektos/act",
    versionFlag: "--version",
  },
  {
    bin: "actionlint",
    label: "actionlint  (static linter)",
    installHint:
      "brew install actionlint  /  https://github.com/rhysd/actionlint",
    versionFlag: "-version",
  },
  {
    bin: "node",
    label: "node",
    installHint: "https://nodejs.org/en/download/",
    versionFlag: "--version",
  },
  {
    bin: "bash",
    label: "bash",
    installHint: "https://www.gnu.org/software/bash/",
    versionFlag: "--version",
  },
  {
    bin: "zsh",
    label: "zsh",
    installHint: "https://www.zsh.org/  (pre-installed on macOS)",
    versionFlag: "--version",
  },
  {
    bin: "pwsh",
    label: "pwsh  (PowerShell)",
    installHint:
      "https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell",
    versionFlag: "--version",
  },
];

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

/** Run a command synchronously; return stdout trimmed, or undefined on error. */
function tryExec(cmd: string): string | undefined {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], timeout: 4000 })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/** Probe a single tool: which → version. */
function probe(spec: ToolSpec): ProbeResult {
  const binPath = tryExec(`which ${spec.bin}`);
  if (binPath === undefined || binPath === "") {
    return { spec, found: false };
  }

  let version: string | undefined;
  if (spec.versionFlag !== undefined) {
    // Some tools (bash --version) write to stdout; actionlint -version too.
    // Capture the first non-empty line.
    const raw = tryExec(`${spec.bin} ${spec.versionFlag} 2>/dev/null`);
    if (raw !== undefined) {
      version = raw.split("\n")[0]?.trim();
    }
  }

  return { spec, found: true, binPath, version };
}

// ---------------------------------------------------------------------------
// Rendering helpers (intentionally local — bridge.ts has its own small palette)
// ---------------------------------------------------------------------------

const RULE_WIDTH = 72;

function rule(char = "─"): string {
  return pc.dim(char.repeat(RULE_WIDTH));
}

function check(): string {
  return pc.green("✓");
}

function cross(): string {
  return pc.dim("✗");
}

function labelWidth(results: ProbeResult[]): number {
  return Math.max(...results.map((r) => r.spec.label.length), 0);
}

function renderRow(result: ProbeResult, colWidth: number): string {
  const label = result.spec.label.padEnd(colWidth);

  if (result.found) {
    // path in dim; version (if captured) in dim italic-ish
    const pathStr = pc.dim(result.binPath ?? "");
    const verStr =
      result.version !== undefined ? pc.dim(`  (${result.version})`) : "";
    return `  ${check()}  ${pc.green(label)}  ${pathStr}${verStr}`;
  } else {
    const hint = pc.dim(`  hint: ${result.spec.installHint}`);
    return `  ${cross()}  ${pc.dim(label)}${hint}`;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runBridge(_args: string[]): Promise<number> {
  // Probe all tools.
  const results: ProbeResult[] = TOOLS.map(probe);

  const found = results.filter((r) => r.found).length;
  const total = results.length;
  const colWidth = labelWidth(results);

  // ── Header ────────────────────────────────────────────────────────────────
  process.stdout.write("\n");
  process.stdout.write(
    `  ${pc.bold(pc.green("DAG") + pc.white("gler"))}  ${pc.dim("bridge")}  ${pc.dim("·")}  ${pc.dim("local capability probe")}\n`,
  );
  process.stdout.write("\n");
  process.stdout.write(rule() + "\n");
  process.stdout.write("\n");
  process.stdout.write(
    `  ${pc.bold("Capabilities")}  ${pc.dim(`${found} of ${total} tools detected`)}\n`,
  );
  process.stdout.write("\n");

  // ── Tool rows ─────────────────────────────────────────────────────────────
  for (const result of results) {
    process.stdout.write(renderRow(result, colWidth) + "\n");
  }

  // ── Honest note ───────────────────────────────────────────────────────────
  process.stdout.write("\n");
  process.stdout.write(rule() + "\n");
  process.stdout.write("\n");
  process.stdout.write(
    `  ${pc.bold(pc.yellow("note"))}  ${pc.dim("Pairing with the Daggler cloud app over WSS is not implemented in")}\n` +
      `         ${pc.dim("this build. This command reports what a runner on this machine could")}\n` +
      `         ${pc.dim("do — connection to a live cloud session is a future capability.")}\n`,
  );
  process.stdout.write("\n");

  return 0;
}
