/* ============================================================================
 * AnalyzerAdapter — rung 1 of the confidence ladder.
 *
 * This adapter is REAL: it actually runs parseWorkflow + validateWorkflow from
 * the @daggler/workflow-ir and @daggler/validators packages and converts every
 * Diagnostic into a RunnerLogEvent. No fakery — deterministic static analysis
 * on any workflow YAML, with no external dependencies.
 * ========================================================================== */

import { parseWorkflow } from "@daggler/workflow-ir";
import { validateWorkflow } from "@daggler/validators";
import type {
  RunnerCapabilities,
  RunnerLogEvent,
  RunnerPort,
  RunnerRunRequest,
  RunnerRunResult,
  RunStatus,
} from "../types.js";

export class AnalyzerAdapter implements RunnerPort {
  capabilities(): RunnerCapabilities {
    return {
      kind: "analyzer",
      label: "Static analysis",
      hasGit: false,
      hasDocker: false,
      hasAct: false,
      authoritative: false,
      notes: "Deterministic checks; no execution",
    };
  }

  async startRun(req: RunnerRunRequest): Promise<RunnerRunResult> {
    const parseResult = parseWorkflow(req.workflowYaml, {
      path: req.path,
    });

    const validation = validateWorkflow(parseResult);

    const logs: RunnerLogEvent[] = [];
    let seq = 0;

    for (const d of validation.diagnostics) {
      const level: RunnerLogEvent["level"] =
        d.severity === "error"
          ? "error"
          : d.severity === "warning"
            ? "warn"
            : "info";

      logs.push({
        seq: seq++,
        level,
        nodePath: d.path,
        message: `${d.code}: ${d.title}`,
      });
    }

    const status: RunStatus =
      validation.counts.error > 0 ? "failure" : "success";

    const { error, warning } = validation.counts;
    const { grade } = validation.security;
    const summary = `${error} error${error !== 1 ? "s" : ""}, ${warning} warning${warning !== 1 ? "s" : ""} (security grade ${grade})`;

    return { status, logs, summary };
  }
}
