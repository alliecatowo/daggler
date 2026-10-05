import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TokenKeyError,
  buildAuthorizeUrl,
  decryptToken,
  encryptToken,
  generateOAuthState,
  hashRegistrationToken,
  parseTokenKey,
  verifyOAuthState,
} from "../src/token-crypto.js";

const key = randomBytes(32);

describe("token encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const sealed = encryptToken("ghu_exampletoken123", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("ghu_example");
    expect(decryptToken(sealed, key)).toBe("ghu_exampletoken123");
  });
  it("uses a fresh IV per call and rejects tampering or a wrong key", () => {
    const a = encryptToken("x", key);
    expect(a).not.toBe(encryptToken("x", key));
    const parts = a.split(".");
    parts[3] = Buffer.from("zz").toString("base64url");
    expect(() => decryptToken(parts.join("."), key)).toThrow();
    expect(() => decryptToken(a, randomBytes(32))).toThrow();
  });
  it("parses hex and base64 keys, rejects bad ones", () => {
    expect(parseTokenKey(key.toString("hex")).equals(key)).toBe(true);
    expect(parseTokenKey(key.toString("base64")).equals(key)).toBe(true);
    expect(() => parseTokenKey(undefined)).toThrow(TokenKeyError);
    expect(() => parseTokenKey("short")).toThrow(TokenKeyError);
  });
});

describe("registration token hashing", () => {
  it("is deterministic sha-256 hex", () => {
    expect(hashRegistrationToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("oauth state", () => {
  it("accepts only an identical, non-empty state", () => {
    const s = generateOAuthState();
    expect(s.length).toBeGreaterThanOrEqual(40);
    expect(verifyOAuthState(s, s)).toBe(true);
    expect(verifyOAuthState(s, generateOAuthState())).toBe(false);
    expect(verifyOAuthState(null, s)).toBe(false);
    expect(verifyOAuthState(s, undefined)).toBe(false);
    expect(verifyOAuthState("", "")).toBe(false);
  });
  it("builds an authorize URL carrying state", () => {
    const u = new URL(buildAuthorizeUrl({ clientId: "cid", state: "st" }));
    expect(u.host).toBe("github.com");
    expect(u.searchParams.get("state")).toBe("st");
  });
});
