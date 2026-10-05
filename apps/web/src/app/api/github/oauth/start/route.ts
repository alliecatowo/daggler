/* /api/github/oauth/start — begin the GitHub OAuth web flow.
 * Sets a short-lived httpOnly state cookie and redirects to GitHub with the
 * same value as `state`; the callback refuses to continue unless they match. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, generateOAuthState } from "@daggler/github";

const STATE_COOKIE = "daggler_oauth_state";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = process.env["GITHUB_OAUTH_CLIENT_ID"];
  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub OAuth is not configured on this server" },
      { status: 503 },
    );
  }
  const state = generateOAuthState();
  const res = NextResponse.redirect(
    buildAuthorizeUrl({
      clientId,
      state,
      redirectUri: process.env["GITHUB_OAUTH_REDIRECT_URI"] || undefined,
    }),
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from github.com
    secure: req.nextUrl.protocol === "https:",
    path: "/api/github/oauth",
    maxAge: 600,
  });
  return res;
}
