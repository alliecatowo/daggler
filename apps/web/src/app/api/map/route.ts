/**
 * POST /api/map
 *
 * Body: { repo?: string; demo?: boolean }
 *   - demo (or no repo): build from SAMPLE_WORKFLOWS
 *   - repo "owner/repo": use GhCliAdapter to fetch real workflow files
 *
 * Always returns 200. On gh unavailability or errors: { error, message }.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { buildRepoAutomationMap } from "@daggler/inventory";
import { SAMPLE_WORKFLOWS } from "@daggler/workflow-ir";
import { GhCliAdapter } from "@daggler/github";
import { guardJson, isValidRepoSlug } from "../../../lib/guard";

const MAX_WORKFLOW_FILES = 50;
const FETCH_CONCURRENCY = 5;

export async function POST(req: NextRequest): Promise<Response> {
  const guarded = await guardJson(req, { maxBodyBytes: 16 * 1024 });
  if (!guarded.ok) return guarded.response;
  try {
    const body = (guarded.body ?? {}) as {
      repo?: string;
      demo?: boolean;
    };

    const useDemo = body.demo === true || !body.repo;

    if (useDemo) {
      const files = SAMPLE_WORKFLOWS.map((sw) => ({
        path: sw.path,
        yaml: sw.yaml,
      }));
      const map = buildRepoAutomationMap(files);
      return NextResponse.json(map);
    }

    // Real repo path
    const repoStr = (body.repo ?? "").trim();
    if (!isValidRepoSlug(repoStr)) {
      return NextResponse.json(
        { error: "invalid_repo", message: "repo must be in owner/repo format" },
        { status: 200 },
      );
    }
    const slash = repoStr.indexOf("/");

    const owner = repoStr.slice(0, slash);
    const repo = repoStr.slice(slash + 1);

    // Check gh availability
    const available = await GhCliAdapter.isAvailable();
    if (!available) {
      return NextResponse.json(
        {
          error: "gh unavailable",
          message:
            "gh CLI is not installed or not authenticated. " +
            "Install gh (https://cli.github.com) and run `gh auth login`, then try again.",
        },
        { status: 200 },
      );
    }

    const adapter = new GhCliAdapter();
    const repoRef = { owner, repo };

    const paths = (await adapter.listWorkflowFiles(repoRef)).slice(
      0,
      MAX_WORKFLOW_FILES,
    );
    if (paths.length === 0) {
      const map = buildRepoAutomationMap([]);
      return NextResponse.json(map);
    }

    // Fetch files with bounded concurrency.
    const fileResults: { path: string; yaml: string }[] = [];
    for (let i = 0; i < paths.length; i += FETCH_CONCURRENCY) {
      const batch = await Promise.all(
        paths.slice(i, i + FETCH_CONCURRENCY).map(async (path) => {
          const blob = await adapter.getFile(repoRef, path);
          return { path: blob.path, yaml: blob.content };
        }),
      );
      fileResults.push(...batch);
    }

    const map = buildRepoAutomationMap(fileResults);
    return NextResponse.json(map);
  } catch (err: unknown) {
    console.error("[api/map]", err);
    return NextResponse.json(
      { error: "unexpected", message: "Could not build the repo map." },
      { status: 200 },
    );
  }
}
