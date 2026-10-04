/* ============================================================================
 * Request guard for the local Daggler server.
 *
 * Every privileged or state-changing /api route must call `guardJson()`.
 * Layered defences (all must pass):
 *   1. Host header allowlist           — stops DNS rebinding
 *   2. Origin / Sec-Fetch-Site check   — stops cross-site browser requests
 *   3. Content-Type: application/json  — stops "simple" no-preflight POSTs
 *   4. Per-launch random token header  — stops anything that cannot read the
 *                                        served UI (cross-origin pages can't)
 *   5. Body size cap
 * The server itself must also bind to 127.0.0.1 (see package.json scripts).
 * ========================================================================== */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "x-daggler-token";
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

const TOKEN_KEY = Symbol.for("daggler.web.launchToken");

type GlobalWithToken = typeof globalThis & { [TOKEN_KEY]?: string };

/**
 * Per-launch token. Stored on globalThis so every route bundle and the root
 * layout in the same Node process see the same value. DAGGLER_TOKEN may pin it.
 */
export function getLaunchToken(): string {
  const g = globalThis as GlobalWithToken;
  let t = g[TOKEN_KEY];
  if (!t) {
    const pinned = process.env["DAGGLER_TOKEN"];
    t = pinned && pinned.length >= 16 ? pinned : randomBytes(32).toString("hex");
    g[TOKEN_KEY] = t;
  }
  return t;
}

/** Test hook: forget the cached token. */
export function resetLaunchTokenForTests(): void {
  delete (globalThis as GlobalWithToken)[TOKEN_KEY];
}

export function allowedHostnames(): Set<string> {
  const s = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const h of (process.env["DAGGLER_ALLOWED_HOSTS"] ?? "").split(",")) {
    const v = h.trim().toLowerCase();
    if (v) s.add(v);
  }
  return s;
}

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

function digest(v: string): Buffer {
  return createHash("sha256").update(v).digest();
}

function tokenMatches(provided: string | null): boolean {
  if (!provided) return false;
  return timingSafeEqual(digest(provided), digest(getLaunchToken()));
}

function deny(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export type GuardResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response };

export interface GuardOptions {
  maxBodyBytes?: number;
}

/** Check headers only (no body). Returns a denial response or null. */
export function checkHeaders(req: Request): Response | null {
  const host = req.headers.get("host");
  if (!host || !allowedHostnames().has(hostnameOf(host))) {
    return deny(403, "forbidden: host not allowed");
  }

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return deny(403, "forbidden: bad origin");
    }
    if (originHost !== host.trim().toLowerCase()) {
      return deny(403, "forbidden: cross-origin request");
    }
  }

  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return deny(403, "forbidden: cross-site request");
  }

  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(ct)) {
    return deny(415, "content-type must be application/json");
  }

  if (!tokenMatches(req.headers.get(TOKEN_HEADER))) {
    return deny(403, "forbidden: missing or invalid token");
  }
  return null;
}

/** Full guard: headers, then a size-capped JSON body parse. */
export async function guardJson(
  req: Request,
  opts: GuardOptions = {},
): Promise<GuardResult> {
  const denied = checkHeaders(req);
  if (denied) return { ok: false, response: denied };

  const max = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) {
    return { ok: false, response: deny(413, "request body too large") };
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > max) {
    return { ok: false, response: deny(413, "request body too large") };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: deny(400, "Invalid JSON body") };
  }
}

/** Tiny fixed-window in-memory rate limiter (single local process). */
export function makeRateLimiter(limit: number, windowMs: number) {
  let windowStart = Date.now();
  let count = 0;
  return (): boolean => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= limit;
  };
}

// Input validators shared by routes -----------------------------------------
export const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GIT_REF_RE = /^[A-Za-z0-9_./-]{1,200}$/;
const WORKFLOW_PATH_RE = /^[A-Za-z0-9_./-]{1,200}$/;

export function isValidRepoSlug(v: unknown): v is string {
  if (typeof v !== "string" || !REPO_SLUG_RE.test(v)) return false;
  return v.split("/").every((p) => p !== "." && p !== "..");
}
export function isValidRef(v: unknown): v is string {
  return (
    typeof v === "string" &&
    GIT_REF_RE.test(v) &&
    !v.includes("..") &&
    !v.startsWith("-")
  );
}
export function isValidWorkflowPath(v: unknown): v is string {
  return (
    typeof v === "string" &&
    WORKFLOW_PATH_RE.test(v) &&
    !v.split("/").includes("..") &&
    !v.startsWith("-")
  );
}
