/**
 * Token protection helpers (Node-only).
 *
 *  - encryptToken/decryptToken: AES-256-GCM for OAuth access/refresh tokens at
 *    rest. The key comes from DAGGLER_TOKEN_KEY (32 bytes, hex or base64).
 *    Format: "v1.<iv>.<tag>.<ciphertext>" (base64url parts).
 *  - hashRegistrationToken: SHA-256 hex for runner registration tokens, which
 *    are high-entropy random values, so a fast hash is enough; only the hash
 *    is stored and lookups compare hashes.
 *  - OAuth `state` helpers: random value bound to a cookie, compared in
 *    constant time, to stop login CSRF.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

/** Parse a 32-byte key given as 64 hex chars or base64. Throws TokenKeyError. */
export function parseTokenKey(raw: string | undefined): Buffer {
  if (!raw) throw new TokenKeyError("DAGGLER_TOKEN_KEY is not set");
  const v = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(v)
    ? Buffer.from(v, "hex")
    : Buffer.from(v, "base64");
  if (buf.length !== 32) {
    throw new TokenKeyError(
      "DAGGLER_TOKEN_KEY must be 32 bytes (64 hex chars or base64). Generate one with: openssl rand -hex 32",
    );
  }
  return buf;
}

const b64u = (b: Buffer): string => b.toString("base64url");

export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${b64u(iv)}.${b64u(cipher.getAuthTag())}.${b64u(ct)}`;
}

export function decryptToken(sealed: string, key: Buffer): string {
  const [ver, iv, tag, ct] = sealed.split(".");
  if (ver !== "v1" || !iv || !tag || ct === undefined) {
    throw new Error("unrecognised token format");
  }
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    d.update(Buffer.from(ct, "base64url")),
    d.final(),
  ]).toString("utf8");
}

export function hashRegistrationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time check that the callback `state` matches the cookie value. */
export function verifyOAuthState(
  fromQuery: string | null | undefined,
  fromCookie: string | null | undefined,
): boolean {
  if (!fromQuery || !fromCookie) return false;
  const a = createHash("sha256").update(fromQuery).digest();
  const b = createHash("sha256").update(fromCookie).digest();
  return timingSafeEqual(a, b);
}

/** GitHub authorize URL for the web flow, carrying `state`. */
export function buildAuthorizeUrl(opts: {
  clientId: string;
  state: string;
  redirectUri?: string;
  scope?: string;
}): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("state", opts.state);
  if (opts.redirectUri) u.searchParams.set("redirect_uri", opts.redirectUri);
  if (opts.scope) u.searchParams.set("scope", opts.scope);
  return u.toString();
}
