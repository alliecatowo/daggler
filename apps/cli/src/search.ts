/* ============================================================================
 * daggler search — find GitHub Actions in the marketplace/ecosystem.
 *
 *   daggler search <query> [--limit N]
 *
 * Searches GitHub repositories over the gh CLI, computes Daggler's trust score
 * for each candidate, and renders an insertion-friendly list. Honest when gh is
 * unavailable — never fabricates results.
 * ============================================================================ */

import { parseActionRef } from "@daggler/workflow-ir";
import { trustOf } from "@daggler/validators";
import pc from "picocolors";
import { execFileSync } from "node:child_process";

let color = true;
const P = (fn: (s: string) => string, s: string) => (color ? fn(s) : s);
const dim = (s: string) => P(pc.dim as (s: string) => string, s);
const bold = (s: string) => P(pc.bold as (s: string) => string, s);

interface GhRepo {
  fullName: string;
  stargazersCount?: number;
  description?: string;
  url?: string;
}

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore", timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function ghSearch(query: string, limit: number): GhRepo[] {
  const out = execFileSync(
    "gh",
    [
      "search",
      "repos",
      query,
      "--json",
      "fullName,stargazersCount,description,url",
      "--limit",
      String(limit),
      "--sort",
      "stars",
    ],
    { encoding: "utf-8", timeout: 20000 },
  );
  const parsed = JSON.parse(out) as unknown;
  return Array.isArray(parsed) ? (parsed as GhRepo[]) : [];
}

function trustBadge(full: string): string {
  const ref = parseActionRef(`${full}@v1`);
  const t = trustOf(ref);
  const label =
    t.official ? "✓ official" : t.level === "high" ? "✓ trusted org" : t.level === "medium" ? "○ community" : "○ low trust";
  if (t.level === "high") return P(pc.green, label);
  if (t.level === "medium") return P(pc.cyan, label);
  return P(pc.dim as (s: string) => string, label);
}

function stars(n: number | undefined): string {
  if (!n) return dim("★ 0");
  const s = n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  return P(pc.yellow, "★ " + s);
}

export async function runSearch(args: string[]): Promise<number> {
  if (args.includes("--no-color")) color = false;
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Math.max(1, Math.min(30, Number(args[limIdx + 1]) || 8)) : 8;
  const query = args
    .filter((a, i) => !a.startsWith("--") && i !== limIdx + 1)
    .join(" ")
    .trim();

  if (!query) {
    process.stderr.write(
      `  ${P(pc.red, "error")}  ${dim("Usage:")} ${P(pc.cyan, "daggler")} ${P(pc.green, "search")} <query> [--limit N]\n`,
    );
    return 1;
  }

  if (!ghAvailable()) {
    process.stderr.write(
      `  ${P(pc.yellow, "note")}  ${dim("gh is not installed or not authenticated — action search needs the GitHub CLI.")}\n` +
        `  ${dim("Install it and run")} ${P(pc.cyan, "gh auth login")}.\n`,
    );
    return 1;
  }

  let results: GhRepo[];
  try {
    results = ghSearch(query, limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  ${P(pc.red, "error")}  search failed: ${dim(msg)}\n`);
    return 1;
  }

  process.stdout.write("\n");
  process.stdout.write(
    `  ${bold(P(pc.green, "DAG") + P(pc.white as (s: string) => string, "gler"))}  ${dim("action search ·")} ${bold(query)}  ${dim(`(${results.length} results)`)}\n\n`,
  );

  if (results.length === 0) {
    process.stdout.write(`  ${dim("No matching repositories found.")}\n\n`);
    return 0;
  }

  for (const r of results) {
    process.stdout.write(
      `  ${P(pc.cyan, r.fullName)}  ${stars(r.stargazersCount)}  ${trustBadge(r.fullName)}\n`,
    );
    if (r.description) {
      const d = r.description.length > 92 ? r.description.slice(0, 89) + "…" : r.description;
      process.stdout.write(`    ${dim(d)}\n`);
    }
    process.stdout.write(
      `    ${dim("insert:")} ${P(pc.green, "uses: " + r.fullName + "@<sha>")}\n\n`,
    );
  }

  process.stdout.write(
    `  ${dim("Tip: pin to a full commit SHA —")} ${P(pc.cyan, "daggler lint")} ${dim("flags mutable tags (POL002).")}\n\n`,
  );
  return 0;
}
