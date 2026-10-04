/* ============================================================================
 * /api/ai — AI-assisted workflow analysis, hardening, and generation.
 *
 * NODE-ONLY: @daggler/ai and the Anthropic SDK are imported here (server route)
 * and must NEVER be imported from a client component. Clients reach this only
 * via fetch("/api/ai").
 *
 * Response shape (HTTP 200 always — availability is encoded in the body):
 *   { available: false; message: string }
 *   { available: true; intent; explanation; summary; edits; proposedYaml?; confidence }
 * ============================================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { parseWorkflow } from "@daggler/workflow-ir";
import { validateWorkflow } from "@daggler/validators";
import {
  AiResultSchema,
  buildSystemPrompt,
  buildUserPrompt,
  AI_MODEL,
} from "@daggler/ai";
import Anthropic from "@anthropic-ai/sdk";
import { guardJson, makeRateLimiter } from "../../../lib/guard";

const MAX_YAML_CHARS = 200 * 1024;
// Protect the operator's API budget: 20 AI calls per minute per server.
const allowAiCall = makeRateLimiter(20, 60_000);

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

interface AiRequestBody {
  yaml: string;
  intent: "explain" | "harden" | "generate";
  path?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  const guarded = await guardJson(req, { maxBodyBytes: 256 * 1024 });
  if (!guarded.ok) return guarded.response;

  // Honest early exit when the API key is absent.
  if (!process.env["ANTHROPIC_API_KEY"]) {
    return NextResponse.json({
      available: false,
      message:
        "AI features require ANTHROPIC_API_KEY. " +
        "Set it in your environment and restart the server.",
    });
  }

  const body = (guarded.body ?? {}) as AiRequestBody;

  const { yaml, intent, path } = body;

  if (!yaml || typeof yaml !== "string") {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }

  if (yaml.length > MAX_YAML_CHARS) {
    return NextResponse.json({ error: "yaml too large" }, { status: 413 });
  }

  if (!allowAiCall()) {
    return NextResponse.json(
      { error: "rate limit exceeded; try again shortly" },
      { status: 429 },
    );
  }

  if (intent !== "explain" && intent !== "harden" && intent !== "generate") {
    return NextResponse.json(
      { error: "intent must be explain, harden, or generate" },
      { status: 400 },
    );
  }

  // For harden/explain, run parseWorkflow + validateWorkflow to build a
  // findings summary that gives the model extra context.
  let validation: string | undefined;
  if (intent === "harden" || intent === "explain") {
    try {
      const parsed = parseWorkflow(yaml, { path });
      const result = validateWorkflow(parsed);
      if (result.diagnostics.length > 0) {
        const lines = result.diagnostics.map(
          (d) =>
            `[${d.severity.toUpperCase()}] ${d.code}: ${d.message} (${d.path})`,
        );
        validation = lines.join("\n");
      }
    } catch {
      // Non-fatal — proceed without validation context.
    }
  }

  try {
    const client = new Anthropic();

    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: buildUserPrompt(intent, yaml, { validation }),
        },
      ],
    });

    // Extract text content from the response.
    const textContent = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    // Parse the JSON from the response — Claude is instructed to return only JSON.
    let rawJson: unknown;
    try {
      // Strip potential markdown code fences.
      const cleaned = textContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      rawJson = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        available: true,
        intent,
        explanation: textContent,
        summary: "AI returned a non-JSON response — see explanation.",
        edits: [],
        confidence: "low",
      });
    }

    // Validate against the shared schema.
    const parsed = AiResultSchema.safeParse(rawJson);
    if (!parsed.success) {
      // Return partial data if possible.
      const raw = rawJson as Record<string, unknown> | null;
      return NextResponse.json({
        available: true,
        intent,
        explanation:
          typeof raw?.["explanation"] === "string"
            ? raw["explanation"]
            : textContent,
        summary:
          typeof raw?.["summary"] === "string"
            ? raw["summary"]
            : "AI result could not be fully validated — partial data shown.",
        edits: [],
        confidence: "low",
      });
    }

    return NextResponse.json({ available: true, ...parsed.data });
  } catch (err: unknown) {
    console.error("[api/ai] request failed:", err);
    return NextResponse.json({
      available: false,
      message: "AI request failed. See the server log for details.",
    });
  }
}
