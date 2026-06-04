/* ============================================================================
 * @daggler/validators — contract.
 *
 * Validation is layered. Every layer is a pure function over a ValidationContext
 * and returns Diagnostics keyed by canonical node path. The orchestrator
 * (index.ts) resolves source spans from the SourceMap, assigns stable ids,
 * computes posture scores, and sorts. Layers never touch the SourceMap range
 * math themselves — they just say *which node* and *why*.
 * ========================================================================== */

import type {
  DiagnosticSource,
  EditorCommand,
  ParseResult,
  Severity,
  SourceMap,
  SourceSpan,
  WorkflowGraph,
  WorkflowIR,
} from "@daggler/workflow-ir";

/** A concrete remediation a user can apply with one click. */
export interface QuickFix {
  label: string;
  /** Structured edits applied to the source in order. */
  commands?: EditorCommand[];
  /**
   * A pin-to-SHA fix resolved at apply-time against the actions catalog
   * (we may not know the SHA until lookup). The UI calls pinActionToSha.
   */
  pinSha?: { jobId: string; stepIndex: number };
}

export interface Diagnostic {
  /** Stable, unique per finding instance (code + path + ordinal). */
  id: string;
  /** Rule code, e.g. POL002, SEM014, EXPR003, SCHEMA001, AL2001. */
  code: string;
  severity: Severity;
  source: DiagnosticSource;
  title: string;
  message: string;
  /** Canonical node path the finding attaches to. */
  path: string;
  /** Resolved by the orchestrator from the SourceMap when available. */
  span?: SourceSpan;
  fix?: QuickFix;
  docsUrl?: string;
}

/** What a layer or policy rule emits before the orchestrator enriches it. */
export interface RawFinding {
  code: string;
  severity: Severity;
  source: DiagnosticSource;
  title: string;
  message: string;
  path: string;
  fix?: QuickFix;
  docsUrl?: string;
}

export interface ValidationContext {
  ir: WorkflowIR;
  graph: WorkflowGraph;
  sourceMap: SourceMap;
  parse: ParseResult;
  source: string;
}

/** Every analysis layer implements this signature. */
export type ValidationLayer = (ctx: ValidationContext) => RawFinding[];

/** A declarative-ish policy/security rule. */
export interface PolicyRule {
  code: string;
  title: string;
  severity: Severity;
  source: DiagnosticSource; // "policy" | "security"
  appliesTo: "workflow" | "job" | "step";
  description: string;
  /** Which built-in policy packs include this rule. */
  packs: PolicyPackId[];
  docsUrl?: string;
  /** Bad/fixed YAML illustrations for the policy detail UI. */
  exampleBad?: string;
  exampleGood?: string;
  evaluate: (ctx: ValidationContext) => RawFinding[];
}

export type PolicyPackId =
  | "oss-maintainer"
  | "enterprise-least-privilege"
  | "release-hardening"
  | "ai-agent-safety"
  | "docker-publishing"
  | "cloud-deploy";

export interface PolicyPack {
  id: PolicyPackId;
  name: string;
  description: string;
}

export interface PostureScore {
  /** 0–100, higher is safer. */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** Human summary of what dragged the score down. */
  factors: string[];
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  counts: { error: number; warning: number; info: number; total: number };
  security: PostureScore;
  /** A rough authoring-complexity metric (jobs, steps, matrix breadth, fan-out). */
  complexity: { score: number; jobs: number; steps: number; maxMatrix: number };
}
