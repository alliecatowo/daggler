/* ============================================================================
 * /api/run — confidence-ladder execution endpoint.
 *
 * NODE-ONLY: @daggler/runner is imported here (server route) and must NEVER
 * be imported from a client component.
 * ========================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { AnalyzerAdapter } from "@daggler/runner-protocol";
import { ActAdapter, GitHubDispatchAdapter } from "@daggler/runner";
import type { RunnerRunResult } from "@daggler/runner-protocol";
import {
  guardJson,
  isValidRef,
  isValidRepoSlug,
  isValidWorkflowPath,
} from "../../../lib/guard";

// Powerful rungs are opt-in: they execute code / use the host's gh credentials.
const MAX_YAML_CHARS = 512 * 1024;
const localFullEnabled = () => process.env["DAGGLER_ALLOW_LOCAL_RUN"] === "1";
const githubDispatchEnabled = () =>
  process.env["DAGGLER_ALLOW_GITHUB_DISPATCH"] === "1";

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

interface RunRequestBody {
  yaml: string;
  mode: "static" | "local" | "github";
  full?: boolean;
  path?: string;
  repo?: string;
  ref?: string;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function unavailable(summary: string): NextResponse {
  return NextResponse.json(
    { status: "unavailable", summary, logs: [] },
    { status: 200 },
  );
}

function toResponse(result: RunnerRunResult): NextResponse {
  return NextResponse.json({
    status: result.status,
    summary: result.summary,
    logs: result.logs.map((l) => ({ level: l.level, message: l.message })),
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  const guarded = await guardJson(req);
  if (!guarded.ok) return guarded.response;
  const body = (guarded.body ?? {}) as RunRequestBody;

  const { yaml, mode, full, path, repo, ref } = body;

  if (!yaml || typeof yaml !== "string") {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }
  if (yaml.length > MAX_YAML_CHARS) {
    return NextResponse.json({ error: "yaml too large" }, { status: 413 });
  }
  if (path !== undefined && !isValidWorkflowPath(path)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  if (mode === "static") {
    const adapter = new AnalyzerAdapter();
    const result = await adapter.startRun({ workflowYaml: yaml, path });
    return toResponse(result);
  }

  if (mode === "local") {
    if (full === true && !localFullEnabled()) {
      return unavailable(
        "Full local runs execute workflow steps via act/Docker and are disabled. " +
          "Start the server with DAGGLER_ALLOW_LOCAL_RUN=1 to enable them.",
      );
    }
    try {
      const adapter = new ActAdapter();
      let result: RunnerRunResult;
      if (full === true) {
        result = await adapter.run({ workflowYaml: yaml, path }, { full: true });
      } else {
        result = await adapter.plan({ workflowYaml: yaml, path });
      }
      // If act/docker is unavailable, ActAdapter returns status:"error" with a
      // clear message. Surface that as "unavailable" so the UI can pick the
      // next rung.
      if (result.status === "error" && result.summary.includes("not available")) {
        return unavailable(result.summary);
      }
      return toResponse(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return unavailable(`act/docker unavailable: ${msg}`);
    }
  }

  if (mode === "github") {
    if (!githubDispatchEnabled()) {
      return unavailable(
        "GitHub dispatch uses the host's gh credentials and is disabled. " +
          "Start the server with DAGGLER_ALLOW_GITHUB_DISPATCH=1 to enable it.",
      );
    }
    if (!repo || !ref) {
      return NextResponse.json(
        { error: "repo and ref are required for github mode" },
        { status: 400 },
      );
    }
    if (!isValidRepoSlug(repo) || !isValidRef(ref)) {
      return NextResponse.json(
        { error: "invalid repo or ref" },
        { status: 400 },
      );
    }
    try {
      const adapter = new GitHubDispatchAdapter();
      if (!adapter.isAvailable()) {
        return unavailable(
          "gh not found or not authenticated — install gh and run: gh auth login",
        );
      }
      // startRun on GitHubDispatchAdapter requires repo+ref context that
      // RunnerRunRequest doesn't carry; use dispatch() + latestRun() directly.
      const workflowFile = path ?? ".github/workflows/workflow.yml";
      const dispatch = adapter.dispatch({ repo, workflowFile, ref });
      if (!dispatch.ok) {
        return unavailable(`dispatch failed: ${dispatch.message}`);
      }
      // Give GitHub a moment to register the run, then fetch its state.
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
      const run = adapter.latestRun(repo, workflowFile);
      if (!run) {
        return NextResponse.json({
          status: "queued",
          summary: `Workflow dispatched to ${repo}@${ref} — run not yet visible`,
          logs: [{ level: "info", message: dispatch.message }],
        });
      }
      const result = adapter.toRunResult(run, [
        { seq: 0, level: "info", message: dispatch.message },
      ]);
      return toResponse(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return unavailable(`gh unavailable: ${msg}`);
    }
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
