/* ============================================================================
 * /api/verify — workflow verification endpoint.
 *
 * NODE-ONLY: @daggler/runner (ActionlintAdapter) is imported here (server route)
 * and must NEVER be imported from a client component.
 * ========================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { parseWorkflow } from "@daggler/workflow-ir";
import { validateWorkflow } from "@daggler/validators";
import { ActionlintAdapter } from "@daggler/runner";

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

interface VerifyRequestBody {
  yaml: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: VerifyRequestBody;
  try {
    body = (await req.json()) as VerifyRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { yaml, path } = body;

  if (!yaml || typeof yaml !== "string") {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }

  // ---- Daggler static analysis (parseWorkflow + validateWorkflow) -----------
  const parseResult = parseWorkflow(yaml, { path });
  const validation = validateWorkflow(parseResult);

  const daggerResult = {
    errors: validation.counts.error,
    warnings: validation.counts.warning,
    infos: validation.counts.info,
    grade: validation.security.grade,
    diagnostics: validation.diagnostics.map((d) => ({
      id: d.id,
      code: d.code,
      severity: d.severity,
      source: d.source,
      title: d.title,
      message: d.message,
      path: d.path,
    })),
  };

  // ---- actionlint (if available) -------------------------------------------
  const actionlintResult = ActionlintAdapter.runActionlint(yaml, path);

  return NextResponse.json({
    daggler: daggerResult,
    actionlint: {
      available: actionlintResult.available,
      findings: actionlintResult.findings,
    },
  });
}
