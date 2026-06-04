/**
 * Pure crypto tests for the GitHub webhook helpers.
 *
 * NOT gated — these tests only use node:crypto and the pure functions in
 * webhook.ts, so they always run without any external dependencies.
 */

import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  verifyWebhookSignature,
  parseWebhookEvent,
  EVENT_JOB_MAP,
  dispatchWebhook,
} from "../src/webhook.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const SECRET = "s3cr3t";
const PAYLOAD = '{"zen":"x"}';

/** Compute the expected signature the same way GitHub does. */
function makeSignature(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

const VALID_SIG = makeSignature(PAYLOAD, SECRET);

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature", () => {
  it("returns true for a correct sha256 signature", () => {
    expect(verifyWebhookSignature(PAYLOAD, VALID_SIG, SECRET)).toBe(true);
  });

  it("returns false for an incorrect signature", () => {
    const wrong = "sha256=" + "a".repeat(64);
    expect(verifyWebhookSignature(PAYLOAD, wrong, SECRET)).toBe(false);
  });

  it("returns false when the header is null", () => {
    expect(verifyWebhookSignature(PAYLOAD, null, SECRET)).toBe(false);
  });

  it("returns false when the header is an empty string", () => {
    expect(verifyWebhookSignature(PAYLOAD, "", SECRET)).toBe(false);
  });

  it("returns false when the secret is empty", () => {
    expect(verifyWebhookSignature(PAYLOAD, VALID_SIG, "")).toBe(false);
  });

  it("returns false when the payload has been tampered with", () => {
    const tampered = '{"zen":"y"}';
    expect(verifyWebhookSignature(tampered, VALID_SIG, SECRET)).toBe(false);
  });

  it("returns false for a length-mismatch (prevents timing oracle)", () => {
    // A truncated signature has a different length — must return false without
    // calling timingSafeEqual (which would throw on mismatched lengths).
    expect(verifyWebhookSignature(PAYLOAD, "sha256=abc", SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseWebhookEvent
// ---------------------------------------------------------------------------

describe("parseWebhookEvent", () => {
  it("extracts event name and deliveryId from headers", () => {
    const headers = {
      "x-github-event": "push",
      "x-github-delivery": "abc-123",
    };
    const result = parseWebhookEvent(headers, PAYLOAD);
    expect(result.event).toBe("push");
    expect(result.deliveryId).toBe("abc-123");
  });

  it("extracts action from the JSON body", () => {
    const body = JSON.stringify({ action: "opened" });
    const result = parseWebhookEvent({ "x-github-event": "pull_request" }, body);
    expect(result.action).toBe("opened");
  });

  it("extracts repository.full_name as repo", () => {
    const body = JSON.stringify({
      repository: { full_name: "acme/my-service" },
    });
    const result = parseWebhookEvent({ "x-github-event": "push" }, body);
    expect(result.repo).toBe("acme/my-service");
  });

  it("leaves action and repo undefined when not present in body", () => {
    const result = parseWebhookEvent({ "x-github-event": "ping" }, "{}");
    expect(result.action).toBeUndefined();
    expect(result.repo).toBeUndefined();
  });

  it("returns the parsed payload object", () => {
    const result = parseWebhookEvent({ "x-github-event": "push" }, PAYLOAD);
    expect(result.payload).toEqual({ zen: "x" });
  });

  it("sets event to empty string when x-github-event header is absent", () => {
    const result = parseWebhookEvent({}, "{}");
    expect(result.event).toBe("");
  });
});

// ---------------------------------------------------------------------------
// EVENT_JOB_MAP
// ---------------------------------------------------------------------------

describe("EVENT_JOB_MAP", () => {
  it("maps push to sync.workflowFiles and validate.workflow", () => {
    expect(EVENT_JOB_MAP["push"]).toEqual(["sync.workflowFiles", "validate.workflow"]);
  });

  it("maps pull_request to validate.workflow", () => {
    expect(EVENT_JOB_MAP["pull_request"]).toEqual(["validate.workflow"]);
  });

  it("maps installation to sync.installation", () => {
    expect(EVENT_JOB_MAP["installation"]).toEqual(["sync.installation"]);
  });

  it("maps installation_repositories to sync.repository", () => {
    expect(EVENT_JOB_MAP["installation_repositories"]).toEqual(["sync.repository"]);
  });

  it("maps workflow_run to import.workflowRun", () => {
    expect(EVENT_JOB_MAP["workflow_run"]).toEqual(["import.workflowRun"]);
  });
});

// ---------------------------------------------------------------------------
// dispatchWebhook
// ---------------------------------------------------------------------------

describe("dispatchWebhook", () => {
  it("returns 503 when no secret is provided", () => {
    const headers = {
      "x-github-event": "push",
      "x-hub-signature-256": VALID_SIG,
    };
    const result = dispatchWebhook(headers, PAYLOAD, undefined);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.reason).toBe("webhook secret not configured");
  });

  it("returns 503 when secret is an empty string", () => {
    const headers = { "x-github-event": "push" };
    const result = dispatchWebhook(headers, PAYLOAD, "");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("returns 401 for a bad signature", () => {
    const headers = {
      "x-github-event": "push",
      "x-hub-signature-256": "sha256=" + "0".repeat(64),
    };
    const result = dispatchWebhook(headers, PAYLOAD, SECRET);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toBe("invalid signature");
  });

  it("returns 401 when the signature header is absent", () => {
    const headers = { "x-github-event": "push" };
    const result = dispatchWebhook(headers, PAYLOAD, SECRET);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns 202 with event + jobs for a valid push delivery", () => {
    const pushPayload = JSON.stringify({
      zen: "x",
      repository: { full_name: "acme/my-service" },
    });
    const sig = makeSignature(pushPayload, SECRET);
    const headers = {
      "x-github-event": "push",
      "x-github-delivery": "del-001",
      "x-hub-signature-256": sig,
    };
    const result = dispatchWebhook(headers, pushPayload, SECRET);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.event).toBe("push");
    expect(result.jobs).toEqual(["sync.workflowFiles", "validate.workflow"]);
  });

  it("returns 202 with empty jobs array for an unmapped event", () => {
    const body = JSON.stringify({ action: "created" });
    const sig = makeSignature(body, SECRET);
    const headers = {
      "x-github-event": "unknown_event",
      "x-hub-signature-256": sig,
    };
    const result = dispatchWebhook(headers, body, SECRET);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.jobs).toEqual([]);
  });

  it("returns 202 for a valid pull_request delivery", () => {
    const prPayload = JSON.stringify({ action: "opened" });
    const sig = makeSignature(prPayload, SECRET);
    const headers = {
      "x-github-event": "pull_request",
      "x-hub-signature-256": sig,
    };
    const result = dispatchWebhook(headers, prPayload, SECRET);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.event).toBe("pull_request");
    expect(result.jobs).toEqual(["validate.workflow"]);
  });
});
