/* ============================================================================
 * /api/github/webhook — GitHub App webhook receiver.
 *
 * NODE-ONLY: @daggler/github (node:crypto) must NEVER be imported from a
 * client component.
 * ============================================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { dispatchWebhook } from "@daggler/github";
import { JOB_REGISTRY } from "@daggler/worker/registry";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body text for HMAC verification (must happen before any parsing).
  const rawBody = await req.text();

  // Collect headers into a plain Record for dispatchWebhook.
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const secret = process.env["GITHUB_WEBHOOK_SECRET"] ?? "";
  const result = dispatchWebhook(headers, rawBody, secret);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: result.status },
    );
  }

  // Fire-and-forget: invoke real JOB_REGISTRY handlers for known jobs.
  // We only run jobs that are genuine implementations (validate.workflow,
  // parse.workflow) — stubs that need GitHub/Postgres are intentionally skipped.
  const REAL_JOBS = new Set(["validate.workflow", "parse.workflow"]);
  const jobs = result.jobs ?? [];

  for (const jobName of jobs) {
    if (REAL_JOBS.has(jobName)) {
      const handler = JOB_REGISTRY[jobName];
      if (handler) {
        // Best-effort — do not await; errors are swallowed intentionally so
        // the webhook response is never blocked.
        handler({ rawBody, headers }).catch(() => {
          /* fire-and-forget */
        });
      }
    }
  }

  return NextResponse.json(
    { ok: true, event: result.event, jobs },
    { status: result.status },
  );
}
