import { beforeEach, describe, expect, it } from "vitest";
import {
  TOKEN_HEADER,
  getLaunchToken,
  guardJson,
  isValidRef,
  isValidRepoSlug,
  resetLaunchTokenForTests,
} from "../src/lib/guard";

const HOST = "localhost:3737";

function req(over: {
  host?: string | null;
  origin?: string;
  contentType?: string | null;
  token?: string | null;
  fetchSite?: string;
  body?: string;
} = {}): Request {
  const h = new Headers();
  if (over.host !== null) h.set("host", over.host ?? HOST);
  if (over.origin) h.set("origin", over.origin);
  if (over.fetchSite) h.set("sec-fetch-site", over.fetchSite);
  if (over.contentType !== null)
    h.set("content-type", over.contentType ?? "application/json");
  if (over.token !== null) h.set(TOKEN_HEADER, over.token ?? getLaunchToken());
  return new Request(`http://${HOST}/api/run`, {
    method: "POST",
    headers: h,
    body: over.body ?? JSON.stringify({ a: 1 }),
  });
}

async function status(r: Request): Promise<number> {
  const g = await guardJson(r);
  return g.ok ? 200 : g.response.status;
}

describe("guardJson", () => {
  beforeEach(() => {
    resetLaunchTokenForTests();
    delete process.env["DAGGLER_ALLOWED_HOSTS"];
    delete process.env["DAGGLER_TOKEN"];
  });

  it("accepts a same-origin JSON request carrying the token", async () => {
    const g = await guardJson(req({ origin: `http://${HOST}`, fetchSite: "same-origin" }));
    expect(g).toEqual({ ok: true, body: { a: 1 } });
  });

  it("accepts a header-only client without Origin (curl) when the token is right", async () => {
    expect(await status(req())).toBe(200);
  });

  it("rejects a cross-origin POST", async () => {
    expect(await status(req({ origin: "https://evil.example" }))).toBe(403);
    expect(await status(req({ origin: "null" }))).toBe(403);
    expect(await status(req({ fetchSite: "cross-site" }))).toBe(403);
  });

  it("rejects a cross-origin POST even with a valid token and a localhost lookalike origin", async () => {
    expect(await status(req({ origin: "http://localhost:9999" }))).toBe(403);
  });

  it("rejects a wrong Host header (DNS rebinding)", async () => {
    expect(await status(req({ host: "evil.example:3737" }))).toBe(403);
    expect(
      await status(req({ host: "evil.example:3737", origin: "http://evil.example:3737" })),
    ).toBe(403);
    expect(await status(req({ host: null }))).toBe(403);
  });

  it("rejects a missing or wrong token", async () => {
    expect(await status(req({ token: null }))).toBe(403);
    expect(await status(req({ token: "nope" }))).toBe(403);
  });

  it("rejects non-JSON content types (text/plain simple requests)", async () => {
    expect(await status(req({ contentType: "text/plain" }))).toBe(415);
    expect(await status(req({ contentType: null }))).toBe(415);
    expect(await status(req({ contentType: "application/jsonx" }))).toBe(415);
  });

  it("rejects oversized and malformed bodies", async () => {
    const big = await guardJson(req({ body: JSON.stringify({ y: "x".repeat(2 * 1024 * 1024) }) }));
    expect(big.ok ? 200 : big.response.status).toBe(413);
    expect(await status(req({ body: "{nope" }))).toBe(400);
  });

  it("honours DAGGLER_ALLOWED_HOSTS", async () => {
    process.env["DAGGLER_ALLOWED_HOSTS"] = "daggler.lan";
    expect(await status(req({ host: "daggler.lan:3737" }))).toBe(200);
  });
});

describe("validators", () => {
  it("validates repo slugs and refs", () => {
    expect(isValidRepoSlug("acme/repo.js")).toBe(true);
    expect(isValidRepoSlug("a/b/../../orgs/x?foo=")).toBe(false);
    expect(isValidRepoSlug("../x")).toBe(false);
    expect(isValidRepoSlug("acme")).toBe(false);
    expect(isValidRef("main")).toBe(true);
    expect(isValidRef("--upload-pack=x")).toBe(false);
    expect(isValidRef("a..b")).toBe(false);
  });
});
