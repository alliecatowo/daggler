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

import { NextRequest, NextResponse } from "next/server";
import { buildRepoAutomationMap } from "@daggler/inventory";
import { SAMPLE_WORKFLOWS } from "@daggler/workflow-ir";
import { GhCliAdapter } from "@daggler/github";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
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
    const slash = repoStr.indexOf("/");
    if (slash === -1) {
      return NextResponse.json(
        { error: "invalid_repo", message: "repo must be in owner/repo format" },
        { status: 200 },
      );
    }

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

    const paths = await adapter.listWorkflowFiles(repoRef);
    if (paths.length === 0) {
      const map = buildRepoAutomationMap([]);
      return NextResponse.json(map);
    }

    // Fetch each file in parallel (bounded by Node's native concurrency)
    const fileResults = await Promise.all(
      paths.map(async (path) => {
        const blob = await adapter.getFile(repoRef, path);
        return { path: blob.path, yaml: blob.content };
      }),
    );

    const map = buildRepoAutomationMap(fileResults);
    return NextResponse.json(map);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "unexpected", message }, { status: 200 });
  }
}
