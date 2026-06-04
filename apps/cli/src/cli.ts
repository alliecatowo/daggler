/* ============================================================================
 * daggler CLI — apps/cli/src/cli.ts
 *
 * The daggler command-line interface. Runs Daggler's full semantic pipeline
 * (parse → IR → graph → validate) over GitHub Actions workflow YAML files and
 * reports diagnostics, security posture scores, and summary totals — with
 * genuinely beautiful terminal output.
 *
 * Commands
 *   daggler lint [paths...] [--json] [--quiet] [--no-color]
 *   daggler verify [paths...] [--json]
 *   daggler run <file> [--static|--local|--github] [--full] [--repo R] [--ref REF]
 *   daggler help | --help
 *   daggler --version
 *
 * No shebang here — tsup injects "#!/usr/bin/env node" via banner config.
 * Nothing is exported; the module runs on import via the main() call at the
 * bottom.
 * ============================================================================ */

import { parseWorkflow, SAMPLE_WORKFLOWS } from "@daggler/workflow-ir";
import { validateWorkflow, type ValidationResult } from "@daggler/validators";
import type { Diagnostic } from "@daggler/validators";
import pc from "picocolors";
import * as fs from "node:fs";
import * as path from "node:path";
import { runBridge } from "./bridge.js";
import { runVerify } from "./verify.js";
import { runRun } from "./run.js";
import { runMap } from "./map.js";
import { runSearch } from "./search.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSION = "0.1.0";

// Width of the terminal rule drawn above each file section.
const RULE_WIDTH = 72;

// ---------------------------------------------------------------------------
// ANSI / color helpers
// ---------------------------------------------------------------------------

/** Whether color output is enabled (overridden by --no-color). */
let colorEnabled = true;

function paint<T extends string>(fn: (s: T) => string, s: T): string {
  return colorEnabled ? fn(s) : s;
}

// ---------------------------------------------------------------------------
// Severity glyph + coloring
// ---------------------------------------------------------------------------

function severityGlyph(sev: Diagnostic["severity"]): string {
  switch (sev) {
    case "error":
      return paint(pc.red, "●");
    case "warning":
      return paint(pc.yellow, "▲");
    case "info":
      return paint(pc.cyan, "○");
  }
}

function colorGrade(grade: string): string {
  if (grade === "A" || grade === "B") return paint(pc.green, grade);
  if (grade === "C") return paint(pc.yellow, grade);
  return paint(pc.red, grade);
}

function colorSeverityCount(n: number, sev: Diagnostic["severity"]): string {
  if (n === 0) return paint(pc.dim as (s: string) => string, String(n));
  switch (sev) {
    case "error":
      return paint(pc.red, String(n));
    case "warning":
      return paint(pc.yellow, String(n));
    case "info":
      return paint(pc.cyan, String(n));
  }
}

// ---------------------------------------------------------------------------
// Terminal layout helpers
// ---------------------------------------------------------------------------

function rule(char = "─"): string {
  return paint(pc.dim as (s: string) => string, char.repeat(RULE_WIDTH));
}

function bold(s: string): string {
  return paint(pc.bold as (s: string) => string, s);
}

function dim(s: string): string {
  return paint(pc.dim as (s: string) => string, s);
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/** Collect all *.yml / *.yaml files under a directory (non-recursive beyond
 *  one level of .github/workflows if it exists). */
function collectWorkflowFiles(dirPath: string): string[] {
  const files: string[] = [];

  // If a .github/workflows subdir exists inside dirPath, prefer it.
  const ghWorkflows = path.join(dirPath, ".github", "workflows");
  const scanDir = fs.existsSync(ghWorkflows) ? ghWorkflows : dirPath;

  try {
    const entries = fs.readdirSync(scanDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (name.endsWith(".yml") || name.endsWith(".yaml")) {
        files.push(path.join(scanDir, name));
      }
    }
  } catch {
    // Not readable — silently skip.
  }

  return files.sort();
}

/** Resolve a list of user-supplied paths into concrete file paths. */
function resolvePaths(rawPaths: string[]): string[] {
  const files: string[] = [];
  for (const p of rawPaths) {
    const abs = path.resolve(p);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        files.push(...collectWorkflowFiles(abs));
      } else {
        files.push(abs);
      }
    } catch {
      process.stderr.write(
        `${paint(pc.yellow, "warn")} ${dim("path not found:")} ${abs}\n`,
      );
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// JSON output shape
// ---------------------------------------------------------------------------

interface JsonFileResult {
  file: string;
  security: { score: number; grade: string; factors: string[] };
  counts: { error: number; warning: number; info: number; total: number };
  diagnostics: Array<{
    id: string;
    code: string;
    severity: string;
    source: string;
    title: string;
    message: string;
    path: string;
    line?: number;
    col?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Pretty-print a single diagnostic line
// ---------------------------------------------------------------------------

function formatDiagLine(d: Diagnostic, filePath: string): string {
  const glyph = severityGlyph(d.severity);
  const code = dim(d.code);

  // Location: prefer span, fall back to node path.
  let loc: string;
  if (d.span) {
    const { line, col } = d.span.start;
    loc = `${dim(filePath)}${dim(":")}${paint(pc.white as (s: string) => string, String(line))}${dim(":")}${paint(pc.white as (s: string) => string, String(col))}`;
  } else {
    loc = `${dim(filePath)}${dim(":")}${dim(d.path)}`;
  }

  const title = bold(d.title);
  // indent: glyph(1) + space(1) + code(variable) + space(1) = align message
  const msg = `  ${dim("└─")} ${dim(d.message)}`;

  return `  ${glyph} ${code}  ${loc}  ${title}\n${msg}`;
}

// ---------------------------------------------------------------------------
// Print a per-file section
// ---------------------------------------------------------------------------

function printFileSection(
  filePath: string,
  validation: ValidationResult,
  quiet: boolean,
): void {
  const { security, counts, diagnostics } = validation;
  const grade = colorGrade(security.grade);
  const scoreStr = dim(`${security.score}/100`);
  const rel = path.relative(process.cwd(), filePath);

  // Header rule
  process.stdout.write(rule() + "\n");

  // File path + grade
  const gradeLabel = `Security ${grade} ${scoreStr}`;
  const header = `  ${bold(paint(pc.white as (s: string) => string, rel))}  ${gradeLabel}`;
  process.stdout.write(header + "\n");

  // Counts mini-line
  const countsLine = [
    `${colorSeverityCount(counts.error, "error")} ${dim("error" + (counts.error !== 1 ? "s" : ""))}`,
    `${colorSeverityCount(counts.warning, "warning")} ${dim("warning" + (counts.warning !== 1 ? "s" : ""))}`,
    `${colorSeverityCount(counts.info, "info")} ${dim("info")}`,
  ].join(dim("  ·  "));
  process.stdout.write(`  ${countsLine}\n`);

  // Security factors (if any and grade is not A)
  if (security.factors.length > 0 && security.grade !== "A") {
    for (const f of security.factors) {
      process.stdout.write(`  ${dim("⚑")} ${dim(f)}\n`);
    }
  }

  if (quiet) {
    // In quiet mode, only print errors.
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      process.stdout.write("\n");
      for (const d of errors) {
        process.stdout.write(formatDiagLine(d, rel) + "\n");
      }
    }
  } else if (diagnostics.length > 0) {
    process.stdout.write("\n");
    for (const d of diagnostics) {
      process.stdout.write(formatDiagLine(d, rel) + "\n");
    }
  }

  process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// Summary footer
// ---------------------------------------------------------------------------

function printSummary(
  totalErrors: number,
  totalWarnings: number,
  totalInfos: number,
  fileCount: number,
  worstGrade: string,
): void {
  process.stdout.write(rule("═") + "\n");
  const errPart = `${colorSeverityCount(totalErrors, "error")} ${dim("error" + (totalErrors !== 1 ? "s" : ""))}`;
  const wrnPart = `${colorSeverityCount(totalWarnings, "warning")} ${dim("warning" + (totalWarnings !== 1 ? "s" : ""))}`;
  const infPart = `${colorSeverityCount(totalInfos, "info")} ${dim("info")}`;
  const filesPart = dim(`in ${fileCount} file${fileCount !== 1 ? "s" : ""}`);
  const gradePart = `worst security grade ${colorGrade(worstGrade)}`;

  process.stdout.write(
    `  ${bold("Summary")}  ${errPart}  ${dim("·")}  ${wrnPart}  ${dim("·")}  ${infPart}  ${filesPart}  ${dim("·")}  ${gradePart}\n`,
  );
  process.stdout.write(rule("═") + "\n");
}

// ---------------------------------------------------------------------------
// Help banner
// ---------------------------------------------------------------------------

function printHelp(): void {
  const wordmark = colorEnabled
    ? pc.bold(pc.green("DAG") + pc.white("gler"))
    : "DAGgler";
  const tagline = dim("the semantic linter for GitHub Actions");

  process.stdout.write("\n");
  process.stdout.write(`  ${wordmark}  ${tagline}\n`);
  process.stdout.write(`  ${dim("v" + VERSION)}\n`);
  process.stdout.write("\n");
  process.stdout.write(rule() + "\n");
  process.stdout.write("\n");
  process.stdout.write(
    `  ${bold("Usage")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "lint")}   ${dim("[paths...] [flags]")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "verify")} ${dim("[paths...] [--json]")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "run")}    ${dim("<file> [--static|--local|--github] [--full] [--repo R] [--ref REF]")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "map")}    ${dim("[dir | owner/repo] [--json]")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "search")} ${dim("<query> [--limit N]")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "bridge")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "help")}\n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "--version")}\n`,
  );
  process.stdout.write("\n");
  process.stdout.write(
    `  ${bold("Commands")}\n` +
      `    ${paint(pc.green as (s: string) => string, "lint")}    Static analysis + security scoring\n` +
      `    ${paint(pc.green as (s: string) => string, "verify")}  Daggler + actionlint cross-check\n` +
      `    ${paint(pc.green as (s: string) => string, "run")}     Execute via the confidence ladder (static → local → github)\n` +
      `    ${paint(pc.green as (s: string) => string, "map")}     Repository automation map (local or owner/repo via gh)\n` +
      `    ${paint(pc.green as (s: string) => string, "search")}  Find actions in the GitHub ecosystem\n` +
      `    ${paint(pc.green as (s: string) => string, "bridge")}  Local capability probe\n`,
  );
  process.stdout.write("\n");
  process.stdout.write(
    `  ${bold("Flags")}\n` +
      `    ${paint(pc.yellow, "--json")}         Output results as JSON array\n` +
      `    ${paint(pc.yellow, "--quiet")}        Only report errors (suppress warnings + infos)\n` +
      `    ${paint(pc.yellow, "--no-color")}     Disable ANSI color output\n` +
      `    ${paint(pc.yellow, "--static")}       run: use Daggler static analyzer (default)\n` +
      `    ${paint(pc.yellow, "--local")}        run: use local act runner\n` +
      `    ${paint(pc.yellow, "--github")}       run: dispatch via gh to GitHub Actions\n` +
      `    ${paint(pc.yellow, "--full")}         run --local: full run instead of plan\n` +
      `    ${paint(pc.yellow, "--repo")}  ${dim("R")}    run --github: override repo (owner/repo)\n` +
      `    ${paint(pc.yellow, "--ref")}   ${dim("REF")}  run --github: override git ref\n`,
  );
  process.stdout.write("\n");
  process.stdout.write(
    `  ${bold("Examples")}\n` +
      `    ${dim("# Lint the default workflows directory")}  \n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "lint")}\n` +
      `\n` +
      `    ${dim("# Cross-check with actionlint")}  \n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "verify")}\n` +
      `\n` +
      `    ${dim("# Static analysis run")}  \n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "run")} ${dim(".github/workflows/ci.yml")}\n` +
      `\n` +
      `    ${dim("# Local act plan (no Docker pull)")}  \n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "run")} ${dim(".github/workflows/ci.yml --local")}\n` +
      `\n` +
      `    ${dim("# Dispatch to GitHub Actions")}  \n` +
      `    ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "run")} ${dim(".github/workflows/ci.yml --github")}\n`,
  );
  process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// Grade ordering for "worst grade" comparison
// ---------------------------------------------------------------------------

const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

function worseGrade(a: string, b: string): string {
  const ra = GRADE_ORDER[a] ?? 4;
  const rb = GRADE_ORDER[b] ?? 4;
  return ra >= rb ? a : b;
}

// ---------------------------------------------------------------------------
// Lint command
// ---------------------------------------------------------------------------

async function runLint(args: string[]): Promise<number> {
  // Parse flags.
  const flagJson = args.includes("--json");
  const flagQuiet = args.includes("--quiet");
  const flagNoColor = args.includes("--no-color");

  if (flagNoColor) colorEnabled = false;

  // Remaining args are paths.
  const rawPaths = args.filter((a) => !a.startsWith("--"));

  // Resolve files.
  let files: string[];
  let usingSamples = false;

  if (rawPaths.length > 0) {
    files = resolvePaths(rawPaths);
  } else {
    // Default: scan ./.github/workflows
    const defaultDir = path.resolve(".github", "workflows");
    if (fs.existsSync(defaultDir)) {
      files = collectWorkflowFiles(defaultDir);
    } else {
      // Fallback: use the bundled sample workflows as a demo.
      usingSamples = true;
      files = [];
    }
  }

  // Handle the demo-samples path.
  if (usingSamples) {
    if (!flagJson) {
      process.stdout.write("\n");
      process.stdout.write(
        `  ${paint(pc.yellow, "note")}  ${dim("No .github/workflows directory found.")}  Running on bundled sample workflows as a demo.\n`,
      );
      process.stdout.write("\n");
    }

    const jsonResults: JsonFileResult[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;
    let totalInfos = 0;
    let worstGrade = "A";

    for (const sample of SAMPLE_WORKFLOWS) {
      const parsed = parseWorkflow(sample.yaml, { path: sample.path });
      const validation = validateWorkflow(parsed);
      const { counts, security, diagnostics } = validation;

      totalErrors += counts.error;
      totalWarnings += counts.warning;
      totalInfos += counts.info;
      worstGrade = worseGrade(worstGrade, security.grade);

      if (flagJson) {
        jsonResults.push({
          file: sample.path,
          security: { score: security.score, grade: security.grade, factors: security.factors },
          counts,
          diagnostics: diagnostics.map((d) => ({
            id: d.id,
            code: d.code,
            severity: d.severity,
            source: d.source,
            title: d.title,
            message: d.message,
            path: d.path,
            line: d.span?.start.line,
            col: d.span?.start.col,
          })),
        });
      } else {
        printFileSection(sample.path, validation, flagQuiet);
      }
    }

    if (flagJson) {
      process.stdout.write(JSON.stringify(jsonResults, null, 2) + "\n");
    } else {
      printSummary(
        totalErrors,
        totalWarnings,
        totalInfos,
        SAMPLE_WORKFLOWS.length,
        worstGrade,
      );
    }

    return totalErrors > 0 ? 1 : 0;
  }

  // No files found.
  if (files.length === 0) {
    if (!flagJson) {
      process.stderr.write(
        `  ${paint(pc.yellow, "warn")}  No workflow files found.\n`,
      );
    } else {
      process.stdout.write("[]\n");
    }
    return 0;
  }

  // Process each file.
  const jsonResults: JsonFileResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;
  let worstGrade = "A";

  for (const filePath of files) {
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `  ${paint(pc.red, "error")}  ${dim("Cannot read")} ${filePath}: ${msg}\n`,
      );
      continue;
    }

    // Use the path relative to cwd as the logical workflow path so spans are
    // meaningful to the user.
    const logicalPath = path.relative(process.cwd(), filePath);

    const parsed = parseWorkflow(text, { path: logicalPath });
    const validation = validateWorkflow(parsed);
    const { counts, security, diagnostics } = validation;

    totalErrors += counts.error;
    totalWarnings += counts.warning;
    totalInfos += counts.info;
    worstGrade = worseGrade(worstGrade, security.grade);

    if (flagJson) {
      jsonResults.push({
        file: logicalPath,
        security: { score: security.score, grade: security.grade, factors: security.factors },
        counts,
        diagnostics: diagnostics.map((d) => ({
          id: d.id,
          code: d.code,
          severity: d.severity,
          source: d.source,
          title: d.title,
          message: d.message,
          path: d.path,
          line: d.span?.start.line,
          col: d.span?.start.col,
        })),
      });
    } else {
      printFileSection(filePath, validation, flagQuiet);
    }
  }

  if (flagJson) {
    process.stdout.write(JSON.stringify(jsonResults, null, 2) + "\n");
  } else {
    printSummary(totalErrors, totalWarnings, totalInfos, files.length, worstGrade);
  }

  return totalErrors > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "";

  // --version / -v
  if (command === "--version" || command === "-v") {
    process.stdout.write(`daggler v${VERSION}\n`);
    process.exit(0);
  }

  // help / --help / -h / (no command)
  if (
    command === "" ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    process.exit(0);
  }

  // lint
  if (command === "lint") {
    const exitCode = await runLint(argv.slice(1));
    process.exit(exitCode);
  }

  // verify — cross-check with Daggler + actionlint
  if (command === "verify") {
    const exitCode = await runVerify(argv.slice(1));
    process.exit(exitCode);
  }

  // run — execute via confidence ladder
  if (command === "run") {
    const exitCode = await runRun(argv.slice(1));
    process.exit(exitCode);
  }

  // bridge — local capability probe
  if (command === "bridge") {
    const exitCode = await runBridge(argv.slice(1));
    process.exit(exitCode);
  }

  // map — repository automation map (local dir or owner/repo via gh)
  if (command === "map") {
    const exitCode = await runMap(argv.slice(1));
    process.exit(exitCode);
  }

  // search — find actions in the GitHub ecosystem
  if (command === "search") {
    const exitCode = await runSearch(argv.slice(1));
    process.exit(exitCode);
  }

  // Unknown command
  process.stderr.write(
    `  ${paint(pc.red, "error")}  Unknown command: ${bold(command)}\n` +
      `  Run ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "--help")} for usage.\n`,
  );
  process.exit(1);
}

// Run on import (tsup bundles this as the CLI entry, shebang added by banner).
main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`  ${paint(pc.red, "fatal")}  ${msg}\n`);
  process.exit(1);
});
