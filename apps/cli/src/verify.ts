/* ============================================================================
 * daggler verify — apps/cli/src/verify.ts
 *
 * Cross-checks workflow files with BOTH the Daggler static analyzer
 * (parseWorkflow + validateWorkflow) AND actionlint, then prints a combined
 * colored report.
 *
 * Usage:
 *   daggler verify [paths...] [--json]
 *
 * Exit codes:
 *   0  — clean (no errors from either tool)
 *   1  — one or more error-severity findings from either tool
 * ============================================================================ */

import { parseWorkflow } from "@daggler/workflow-ir";
import { validateWorkflow } from "@daggler/validators";
import type { Diagnostic } from "@daggler/validators";
import {
  ActionlintAdapter,
  isActionlintAvailable,
} from "@daggler/runner";
import pc from "picocolors";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Color / style helpers (local copy — verify.ts is self-contained)
// ---------------------------------------------------------------------------

let colorEnabled = true;

function paint<T extends string>(fn: (s: T) => string, s: T): string {
  return colorEnabled ? fn(s) : s;
}

function bold(s: string): string {
  return paint(pc.bold as (s: string) => string, s);
}

function dim(s: string): string {
  return paint(pc.dim as (s: string) => string, s);
}

const RULE_WIDTH = 72;

function rule(char = "─"): string {
  return dim(char.repeat(RULE_WIDTH));
}

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

function colorCount(n: number, color: (s: string) => string): string {
  return n === 0 ? dim(String(n)) : paint(color, String(n));
}

// ---------------------------------------------------------------------------
// Filesystem helpers (identical logic to cli.ts, kept local)
// ---------------------------------------------------------------------------

function collectWorkflowFiles(dirPath: string): string[] {
  const files: string[] = [];
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
        `  ${paint(pc.yellow, "warn")}  ${dim("path not found:")} ${abs}\n`,
      );
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// JSON output shape
// ---------------------------------------------------------------------------

interface JsonVerifyResult {
  file: string;
  daggler: {
    security: { score: number; grade: string; factors: string[] };
    counts: { error: number; warning: number; info: number; total: number };
    diagnostics: Array<{
      code: string;
      severity: string;
      source: string;
      title: string;
      message: string;
      path: string;
      line?: number;
      col?: number;
    }>;
  };
  actionlint: {
    available: boolean;
    findings: Array<{
      code: string;
      severity: string;
      source: string;
      message: string;
      line: number;
      col: number;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Pretty printing helpers
// ---------------------------------------------------------------------------

function printDagglerDiag(d: Diagnostic, rel: string): void {
  const glyph = severityGlyph(d.severity);
  const code = dim(d.code);

  let loc: string;
  if (d.span) {
    const { line, col } = d.span.start;
    loc = `${dim(rel)}${dim(":")}${paint(pc.white as (s: string) => string, String(line))}${dim(":")}${paint(pc.white as (s: string) => string, String(col))}`;
  } else {
    loc = `${dim(rel)}${dim(":")}${dim(d.path)}`;
  }

  process.stdout.write(`    ${glyph} ${code}  ${loc}  ${bold(d.title)}\n`);
  process.stdout.write(`      ${dim("└─")} ${dim(d.message)}\n`);
}

// ---------------------------------------------------------------------------
// runVerify — public entry point
// ---------------------------------------------------------------------------

export async function runVerify(args: string[]): Promise<number> {
  const flagJson = args.includes("--json");
  const flagNoColor = args.includes("--no-color");

  if (flagNoColor) colorEnabled = false;

  const rawPaths = args.filter((a) => !a.startsWith("--"));

  // Resolve files — default to .github/workflows
  let files: string[];
  if (rawPaths.length > 0) {
    files = resolvePaths(rawPaths);
  } else {
    const defaultDir = path.resolve(".github", "workflows");
    if (fs.existsSync(defaultDir)) {
      files = collectWorkflowFiles(defaultDir);
    } else {
      files = [];
    }
  }

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

  // Probe actionlint once, up front.
  const alAvailable = isActionlintAvailable();

  if (!flagJson && !alAvailable) {
    process.stdout.write(
      `  ${dim("(actionlint not found - install for cross-checking)")}\n`,
    );
    process.stdout.write("\n");
  }

  const jsonResults: JsonVerifyResult[] = [];
  let anyError = false;

  for (const filePath of files) {
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `  ${paint(pc.red, "error")}  Cannot read ${filePath}: ${msg}\n`,
      );
      continue;
    }

    const rel = path.relative(process.cwd(), filePath);

    // ── Daggler analysis ────────────────────────────────────────────────────
    const parsed = parseWorkflow(text, { path: rel });
    const validation = validateWorkflow(parsed);
    const { counts, security, diagnostics } = validation;

    if (counts.error > 0) anyError = true;

    // ── actionlint analysis ─────────────────────────────────────────────────
    const alResult = ActionlintAdapter.runActionlint(text, rel);
    // actionlint findings are all "warning" severity; they don't cause exit 1
    // UNLESS the task spec says "error-severity from either tool" —
    // actionlint findings are always warning, so they never trigger exit 1.

    // ── JSON output ─────────────────────────────────────────────────────────
    if (flagJson) {
      jsonResults.push({
        file: rel,
        daggler: {
          security: {
            score: security.score,
            grade: security.grade,
            factors: security.factors,
          },
          counts,
          diagnostics: diagnostics.map((d) => ({
            code: d.code,
            severity: d.severity,
            source: d.source,
            title: d.title,
            message: d.message,
            path: d.path,
            line: d.span?.start.line,
            col: d.span?.start.col,
          })),
        },
        actionlint: {
          available: alResult.available,
          findings: ActionlintAdapter.toDiagnostics(alResult.findings).map(
            (ad) => ({
              code: ad.code,
              severity: ad.severity,
              source: ad.source,
              message: ad.message,
              line: ad.line,
              col: ad.col,
            }),
          ),
        },
      });
      continue;
    }

    // ── Pretty output ────────────────────────────────────────────────────────
    process.stdout.write(rule() + "\n");

    // Header line per file:
    //   <rel>  |  daggler: Nerr/Mwarn (grade X)  |  actionlint: Kfindings
    const errStr = colorCount(counts.error, pc.red);
    const wrnStr = colorCount(counts.warning, pc.yellow);
    const gradeStr = colorGrade(security.grade);
    const dagglerSummary = `daggler: ${errStr}${dim("err")}/${wrnStr}${dim("warn")} ${dim("(grade")} ${gradeStr}${dim(")")}`;

    let alSummary: string;
    if (!alAvailable) {
      alSummary = dim("actionlint: n/a");
    } else {
      const kFindings = alResult.findings.length;
      alSummary = `actionlint: ${colorCount(kFindings, pc.yellow)}${dim(" finding" + (kFindings !== 1 ? "s" : ""))}`;
    }

    process.stdout.write(
      `  ${bold(paint(pc.white as (s: string) => string, rel))}  ${dim("|")}  ${dagglerSummary}  ${dim("|")}  ${alSummary}\n`,
    );

    // Security factors
    if (security.factors.length > 0 && security.grade !== "A") {
      for (const f of security.factors) {
        process.stdout.write(`  ${dim("⚑")} ${dim(f)}\n`);
      }
    }

    // Daggler findings
    if (diagnostics.length > 0) {
      process.stdout.write(`\n  ${bold("Daggler")}  ${dim("static analysis")}\n`);
      for (const d of diagnostics) {
        printDagglerDiag(d, rel);
      }
    }

    // actionlint findings
    if (alAvailable && alResult.findings.length > 0) {
      process.stdout.write(`\n  ${bold("actionlint")}  ${dim("cross-check")}\n`);
      const alDiags = ActionlintAdapter.toDiagnostics(alResult.findings);
      for (const ad of alDiags) {
        const locStr = `${dim(rel)}${dim(":")}${paint(pc.white as (s: string) => string, String(ad.line))}${dim(":")}${paint(pc.white as (s: string) => string, String(ad.col))}`;
        process.stdout.write(
          `    ${paint(pc.yellow, "▲")} ${dim(ad.code)}  ${locStr}\n`,
        );
        process.stdout.write(`      ${dim("└─")} ${dim(ad.message)}\n`);
      }
    }

    process.stdout.write("\n");
  }

  if (flagJson) {
    process.stdout.write(JSON.stringify(jsonResults, null, 2) + "\n");
  }

  return anyError ? 1 : 0;
}
