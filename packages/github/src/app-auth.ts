/**
 * GitHub App authentication helpers for Daggler.
 *
 * Node-only. Must only be imported in server route handlers (runtime nodejs).
 *
 * Design: honest stubs — if required credentials are absent, functions return
 * null or throw a clear NotConfigured error rather than faking results.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load GitHub App configuration from environment variables.
 *
 * Required: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY
 * Optional: GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET
 *
 * Returns null when appId or privateKey are missing — callers must handle this
 * and return an honest "not configured" response rather than proceeding.
 */
export function loadGitHubAppConfigFromEnv(
  env: Record<string, string | undefined>,
): GitHubAppConfig | null {
  const appId = env["GITHUB_APP_ID"];
  const privateKey = env["GITHUB_APP_PRIVATE_KEY"];

  if (!appId || !privateKey) {
    return null;
  }

  return {
    appId,
    privateKey,
    clientId: env["GITHUB_OAUTH_CLIENT_ID"],
    clientSecret: env["GITHUB_OAUTH_CLIENT_SECRET"],
    webhookSecret: env["GITHUB_WEBHOOK_SECRET"],
  };
}

// ---------------------------------------------------------------------------
// OAuth code exchange
// ---------------------------------------------------------------------------

/**
 * Thrown when an OAuth operation is attempted but the required credentials
 * (clientId + clientSecret) are not present in the config.
 */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/**
 * Exchange a GitHub OAuth authorization code for an access token.
 *
 * Uses the GitHub OAuth token endpoint directly via fetch (no octokit).
 * Throws NotConfiguredError when clientId or clientSecret are absent.
 * Throws an Error if the GitHub API returns a non-OK response.
 */
export async function exchangeOAuthCode(
  config: GitHubAppConfig,
  code: string,
): Promise<OAuthTokenResponse> {
  if (!config.clientId || !config.clientSecret) {
    throw new NotConfiguredError(
      "GitHub OAuth is not configured: GITHUB_OAUTH_CLIENT_ID and " +
        "GITHUB_OAUTH_CLIENT_SECRET must both be set.",
    );
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
  });

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GitHub OAuth token exchange failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  // GitHub returns errors as a JSON object with an "error" key even on 200.
  if (typeof data["error"] === "string") {
    throw new Error(
      `GitHub OAuth error: ${data["error"]}${typeof data["error_description"] === "string" ? ` — ${data["error_description"]}` : ""}`,
    );
  }

  return {
    access_token: String(data["access_token"] ?? ""),
    token_type: String(data["token_type"] ?? "bearer"),
    scope: typeof data["scope"] === "string" ? data["scope"] : undefined,
  };
}
