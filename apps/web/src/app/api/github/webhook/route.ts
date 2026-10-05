/* ============================================================================
 * /api/github/webhook — GitHub App webhook receiver.
 *
 * NODE-ONLY: @daggler/github (node:crypto) must NEVER be imported from a
 * client component.
 *
 * Deliberately not behind the local-server guard: it is reachable from
 * GitHub, and authenticated by the HMAC signature instead.
 * ============================================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { dispatchWebhook, GhCliAdapter } from "@daggler/github";
import { JOB_REGISTRY } from "@daggler/worker/registry";
import { planWebhookJobs } from "../../../../lib/webhook-jobs";

/** GitHub caps deliveries at 25 MB. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, reason: "payload too large" },
      { status: 413 },
    );
  }

  // Raw body text for HMAC verification (must happen before any parsing).
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, reason: "payload too large" },
      { status: 413 },
    );
  }

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

  const jobs = result.jobs ?? [];
  const event = result.event ?? "";

  // Background: fetch the changed workflow files, then run the in-process
  // handlers with the { yaml, path } payload they expect. Never blocks the
  // response; failures are logged without payload contents.
  void (async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return;
    }
    const plan = await planWebhookJobs(event, jobs, payload, new GhCliAdapter());
    for (const { job, payload: jobPayload } of plan) {
      const handler = JOB_REGISTRY[job];
      if (!handler) continue;
      try {
        await handler(jobPayload);
      } catch (err) {
        console.error(
          `[daggler] webhook job ${job} failed for ${jobPayload.path}:`,
          err instanceof Error ? err.message : "unknown error",
        );
      }
    }
  })();

  return NextResponse.json({ ok: true, event, jobs }, { status: result.status });
}
