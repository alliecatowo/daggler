/**
 * GitHub App webhook helpers for Daggler.
 *
 * Node-only (uses node:crypto). Must only be imported in server route handlers.
 *
 * Design: every function is pure (no I/O side-effects beyond crypto). The
 * route handler is responsible for enqueuing jobs returned by dispatchWebhook.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a GitHub webhook signature.
 *
 * Implements the real GitHub algorithm:
 *   HMAC-SHA256(secret, rawPayload) → hex → prefix "sha256="
 *
 * Returns false (never throws) for any invalid/missing input so callers can
 * always use the boolean directly.
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  // Guard: both secret and header must be non-empty strings.
  if (!secret || !signatureHeader) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  // timingSafeEqual requires same-length Buffers — length mismatch → false.
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(signatureHeader, "utf-8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

export interface ParsedWebhookEvent {
  event: string;
  deliveryId?: string;
  action?: string;
  repo?: string;
  payload: unknown;
}

/**
 * Parse raw webhook headers + body into a structured event object.
 *
 * Reads x-github-event, x-github-delivery, then JSON-parses the body and
 * extracts action + repository.full_name when present.
 */
export function parseWebhookEvent(
  headers: Record<string, string | undefined>,
  body: string,
): ParsedWebhookEvent {
  const event = headers["x-github-event"] ?? "";
  const deliveryId = headers["x-github-delivery"];

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = {};
  }

  let action: string | undefined;
  let repo: string | undefined;

  if (payload !== null && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p["action"] === "string") {
      action = p["action"];
    }
    const repository = p["repository"];
    if (
      repository !== null &&
      typeof repository === "object" &&
      typeof (repository as Record<string, unknown>)["full_name"] === "string"
    ) {
      repo = (repository as Record<string, unknown>)["full_name"] as string;
    }
  }

  return { event, deliveryId, action, repo, payload };
}

// ---------------------------------------------------------------------------
// Event → job mapping
// ---------------------------------------------------------------------------

/**
 * Maps GitHub event names to the @daggler/worker job names that should run
 * when that event is received.
 */
export const EVENT_JOB_MAP: Record<string, string[]> = {
  push: ["sync.workflowFiles", "validate.workflow"],
  pull_request: ["validate.workflow"],
  installation: ["sync.installation"],
  installation_repositories: ["sync.repository"],
  workflow_run: ["import.workflowRun"],
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface WebhookDispatchResult {
  ok: boolean;
  status: number;
  event?: string;
  jobs?: string[];
  reason?: string;
}

/**
 * Verify, parse, and map a GitHub webhook delivery to job names.
 *
 * Pure orchestration — the route handler is responsible for actually
 * enqueuing the returned jobs.
 *
 * - Missing secret → 503 (not configured)
 * - Bad signature → 401 (rejected)
 * - Valid delivery → 202 with event name + job list (may be empty)
 */
export function dispatchWebhook(
  headers: Record<string, string | undefined>,
  body: string,
  secret: string | undefined,
): WebhookDispatchResult {
  if (!secret) {
    return { ok: false, status: 503, reason: "webhook secret not configured" };
  }

  const signatureHeader = headers["x-hub-signature-256"] ?? null;
  if (!verifyWebhookSignature(body, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "invalid signature" };
  }

  const parsed = parseWebhookEvent(headers, body);
  const jobs = EVENT_JOB_MAP[parsed.event] ?? [];

  return { ok: true, status: 202, event: parsed.event, jobs };
}
