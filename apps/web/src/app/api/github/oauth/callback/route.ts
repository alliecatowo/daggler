/* ============================================================================
 * /api/github/oauth/callback — GitHub App OAuth authorization callback.
 *
 * NODE-ONLY: @daggler/github must NEVER be imported from a client component.
 *
 * Design: honest — if the required OAuth credentials are absent, return a
 * clear HTML explanation. Never log or expose tokens in responses.
 * ============================================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  loadGitHubAppConfigFromEnv,
  exchangeOAuthCode,
  NotConfiguredError,
} from "@daggler/github";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const config = loadGitHubAppConfigFromEnv(process.env);

  // Honest "not configured" response when the app credentials are absent.
  if (config == null || !config.clientId || !config.clientSecret) {
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>OAuth not configured — Daggler</title></head>
<body>
<h1>GitHub OAuth is not configured</h1>
<p>
  The Daggler server is missing the credentials required to complete the
  GitHub OAuth flow. Please set the following environment variables on the
  server and restart:
</p>
<ul>
  <li><code>GITHUB_APP_ID</code></li>
  <li><code>GITHUB_APP_PRIVATE_KEY</code></li>
  <li><code>GITHUB_OAUTH_CLIENT_ID</code></li>
  <li><code>GITHUB_OAUTH_CLIENT_SECRET</code></li>
</ul>
<p>See the Daggler self-hosting docs for details.</p>
</body>
</html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return new NextResponse(
      "Missing ?code= parameter in the OAuth callback URL.",
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  try {
    // Exchange the code for a token. We do NOT log or expose the token in the
    // response body — only a success acknowledgment is returned.
    await exchangeOAuthCode(config, code);

    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Connected — Daggler</title></head>
<body>
<h1>GitHub account connected</h1>
<p>Authorization was successful. You can close this tab and return to Daggler.</p>
</body>
</html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  } catch (err: unknown) {
    if (err instanceof NotConfiguredError) {
      return new NextResponse(
        "GitHub OAuth is not configured on this server. " + err.message,
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }

    // Surface the error message (safe — no credentials included in the
    // exchangeOAuthCode error path) without leaking token values.
    const message = err instanceof Error ? err.message : String(err);
    return new NextResponse(`OAuth failed: ${message}`, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
