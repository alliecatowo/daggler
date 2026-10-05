/* Encrypted-at-rest storage for the OAuth token (self-hosted, server only).
 *
 * Until a database driver is wired in (@daggler/db has none yet), the token is
 * written, AES-256-GCM encrypted, to a 0600 file under DAGGLER_DATA_DIR
 * (default ./.daggler-data). If DAGGLER_TOKEN_KEY is not set nothing is
 * persisted: a token is never written in plaintext. */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decryptToken, encryptToken, parseTokenKey } from "@daggler/github";

function dir(): string {
  return process.env["DAGGLER_DATA_DIR"] || join(process.cwd(), ".daggler-data");
}
const FILE = "github-oauth.enc";

export type SaveResult = { saved: true } | { saved: false; reason: string };

export async function saveOAuthToken(token: string): Promise<SaveResult> {
  let key: Buffer;
  try {
    key = parseTokenKey(process.env["DAGGLER_TOKEN_KEY"]);
  } catch (err) {
    return { saved: false, reason: err instanceof Error ? err.message : "no key" };
  }
  const d = dir();
  await mkdir(d, { recursive: true, mode: 0o700 });
  const file = join(d, FILE);
  await writeFile(file, encryptToken(token, key), { mode: 0o600 });
  await chmod(file, 0o600);
  return { saved: true };
}

export async function loadOAuthToken(): Promise<string | null> {
  try {
    const key = parseTokenKey(process.env["DAGGLER_TOKEN_KEY"]);
    return decryptToken(await readFile(join(dir(), FILE), "utf8"), key);
  } catch {
    return null;
  }
}
