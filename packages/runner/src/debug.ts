/* ============================================================================
 * debug.ts — failure→source debugging engine
 *
 * Maps GitHub Actions run logs (from `gh run view --log` / `--log-failed`)
 * back to the workflow source: extracts the failing job/step and resolves the
 * corresponding YAML node path + source span via the WorkflowIR + SourceMap.
 *
 * All functions are pure / synchronous / deterministic — no I/O happens here.
 * The caller is responsible for fetching the log text (e.g. via gh CLI).
 * ========================================================================== */

import type { WorkflowIR, SourceSpan } from "@daggler/workflow-ir";
import { stepPath, jobPath } from "@daggler/workflow-ir";
import type { SourceMap } from "@daggler/workflow-ir";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunFailure {
  /** The job name/id extracted from the log, if found. */
  failedJob?: string;
  /**
   * The step label that was active when the first ##[error] appeared.
   * Typically matches the "Run <action>" group header that precedes the error.
   */
  failedStep?: string;
  /** Every line containing "##[error]" (stripped of the prefix). */
  errorLines: string[];
  /**
   * Human-readable diagnostic lines that look like errors but are not
   * prefixed with ##[error]: lines containing "Error:", "not exist",
   * "command not found", "No such file", etc.
   */
  annotations: string[];
}

export interface FailureLocation {
  /** Matching job id in the IR (may differ from the log name). */
  jobId?: string;
  /** Canonical node path for the job, e.g. `job:check`. */
  jobPath?: string;
  /** 0-based index of the matching step. */
  stepIndex?: number;
  /** Canonical node path for the step, e.g. `step:check#1`. */
  stepPath?: string;
  /** Source span from the SourceMap, if available. */
  span?: SourceSpan;
  /** Human-readable one-liner summary. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Log-line format constants
// ---------------------------------------------------------------------------

// `gh run view --log` lines typically look like:
//   <job-name>\t<step-name>\t<ISO-timestamp> <message>
// or  2019-style:
//   <job-name>\t<step-name>\t<message>
// Error annotations appear as:
//   <job-name>\t<step-name>\t<timestamp> ##[error]The specified node …
//   ##[error]<message>
// Group markers:
//   <job-name>\t<step-name>\t##[group]Run actions/setup-node@v4

const TAB = "\t";
const ERROR_PREFIX = "##[error]";
const GROUP_PREFIX = "##[group]";

// Patterns for "error-like" lines that are not prefixed with ##[error]
const ANNOTATION_PATTERNS: RegExp[] = [
  /\bError:/,
  /\bnot exist\b/i,
  /\bcommand not found\b/i,
  /\bNo such file\b/i,
  /\bfailed\b.*with exit code/i,
  /\bProcess completed with exit code [^0]/,
];

// ---------------------------------------------------------------------------
// parseRunFailure
// ---------------------------------------------------------------------------

/**
 * Parse the text output of `gh run view --log` or `--log-failed`.
 *
 * The function does a single linear pass over the lines so it is O(n) and
 * deterministic.
 */
export function parseRunFailure(logText: string): RunFailure {
  const lines = logText.split(/\r?\n/);

  let failedJob: string | undefined;
  let failedStep: string | undefined;
  // The most recent step "group" header seen before the first error.
  let currentStep: string | undefined;
  let currentJob: string | undefined;
  let firstErrorSeen = false;

  const errorLines: string[] = [];
  const annotations: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    // --- Try to split the tab-delimited envelope ---
    const parts = line.split(TAB);

    // A tab-delimited log line has at least 3 parts: job, step, message.
    // If it has 2 parts: job, message (some older formats).
    let jobName: string | undefined;
    let stepName: string | undefined;
    let message: string;

    if (parts.length >= 3) {
      jobName = parts[0]?.trim() || undefined;
      stepName = parts[1]?.trim() || undefined;
      // The message part may start with an ISO timestamp "2024-01-01T…Z "
      const rawMsg = parts.slice(2).join(TAB);
      message = stripTimestamp(rawMsg);
    } else if (parts.length === 2) {
      jobName = parts[0]?.trim() || undefined;
      message = stripTimestamp(parts[1] ?? "");
    } else {
      // No tabs — bare message line (e.g. from --log-failed piped output)
      message = line;
    }

    // Update current job tracker from the envelope.
    if (jobName) currentJob = jobName;

    // --- Detect step group headers ---
    // "##[group]Run actions/setup-node@v4" or "##[group]Set up job"
    if (message.startsWith(GROUP_PREFIX)) {
      const groupLabel = message.slice(GROUP_PREFIX.length).trim();
      currentStep = groupLabel || stepName;
    } else if (stepName && !message.startsWith("##[endgroup]")) {
      // Some formats emit the step name in column 2 rather than in a group.
      // Keep the most-recently-seen non-empty step name as the current step.
      if (!currentStep || currentStep !== stepName) {
        // Only update currentStep if we haven't yet locked onto an error step.
        if (!firstErrorSeen) {
          currentStep = stepName;
        }
      }
    }

    // --- Detect ##[error] lines ---
    if (message.startsWith(ERROR_PREFIX)) {
      const body = message.slice(ERROR_PREFIX.length).trim();
      errorLines.push(body);

      if (!firstErrorSeen) {
        firstErrorSeen = true;
        // Lock the failing job/step at the moment of the first error.
        failedJob = currentJob ?? jobName;
        failedStep = currentStep ?? stepName;
      }
      continue;
    }

    // --- Detect annotation-style error lines (not ##[error] prefixed) ---
    if (!firstErrorSeen) {
      for (const pattern of ANNOTATION_PATTERNS) {
        if (pattern.test(message)) {
          annotations.push(message.trim());
          break;
        }
      }
    }
  }

  // If we never saw an ##[error] but do have annotation lines, pick up the
  // job/step from the last context we tracked.
  if (!firstErrorSeen && annotations.length > 0) {
    failedJob = currentJob;
    failedStep = currentStep;
  }

  return { failedJob, failedStep, errorLines, annotations };
}

// ---------------------------------------------------------------------------
// mapFailureToSource
// ---------------------------------------------------------------------------

/**
 * Given a parsed {@link RunFailure}, a {@link WorkflowIR}, and its
 * {@link SourceMap}, locate the corresponding job and step in the IR and
 * return the canonical node path + source span.
 *
 * Matching is best-effort:
 *  1. Job: exact id match → exact name match → substring match on name/id.
 *  2. Step: exact name match → exact uses/run prefix match → substring match.
 */
export function mapFailureToSource(
  failure: RunFailure,
  ir: WorkflowIR,
  sourceMap: SourceMap,
): FailureLocation {
  const workflowFile = ir.path.replace(/.*[\\/]/, ""); // basename

  // ---- 1. Locate the failing job in the IR ---------------------------------

  const job = failure.failedJob
    ? findJob(ir, failure.failedJob)
    : undefined;

  if (!job) {
    // No job match — return a minimal summary.
    const hint = failure.failedJob
      ? `job '${failure.failedJob}' not found in IR`
      : "no failing job identified";
    return {
      summary: `Run failed (${workflowFile}): ${hint}. Errors: ${summariseErrors(failure)}`,
    };
  }

  const resolvedJobPath = jobPath(job.id);
  const jobSpan = sourceMap.spanForPath(resolvedJobPath);

  // ---- 2. Locate the failing step in the job --------------------------------

  const step = failure.failedStep
    ? findStep(job.steps, failure.failedStep)
    : undefined;

  if (!step) {
    // Job found but step not matched.
    const lineRef = jobSpan
      ? ` (${workflowFile}:${jobSpan.start.line})`
      : ` (${workflowFile})`;
    const stepHint = failure.failedStep
      ? `step '${failure.failedStep}' not found`
      : "no failing step identified";
    return {
      jobId: job.id,
      jobPath: resolvedJobPath,
      span: jobSpan,
      summary: `Job '${job.id}' failed — ${stepHint}${lineRef}. ${summariseErrors(failure)}`,
    };
  }

  const resolvedStepPath = stepPath(job.id, step.index);
  const stepSpan = sourceMap.spanForPath(resolvedStepPath);
  const effectiveSpan = stepSpan ?? jobSpan;

  const lineRef = effectiveSpan
    ? ` (${workflowFile}:${effectiveSpan.start.line})`
    : ` (${workflowFile})`;

  const stepLabel = failure.failedStep ?? step.path;

  return {
    jobId: job.id,
    jobPath: resolvedJobPath,
    stepIndex: step.index,
    stepPath: resolvedStepPath,
    span: effectiveSpan,
    summary: `Job '${job.id}' failed at step '${stepLabel}'${lineRef}. ${summariseErrors(failure)}`,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip a leading ISO-8601 timestamp from a log message segment. */
function stripTimestamp(msg: string): string {
  // e.g. "2024-01-15T12:34:56.789Z " or "2024-01-15T12:34:56Z "
  return msg.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*/, "");
}

/** Find the best-matching job in the IR for a log job name. */
function findJob(
  ir: WorkflowIR,
  logJobName: string,
): typeof ir.jobs[number] | undefined {
  const needle = logJobName.toLowerCase();

  // 1. Exact id match
  let match = ir.jobs.find((j) => j.id === logJobName);
  if (match) return match;

  // 2. Exact name match
  match = ir.jobs.find((j) => j.name === logJobName);
  if (match) return match;

  // 3. Case-insensitive id or name match
  match = ir.jobs.find(
    (j) => j.id.toLowerCase() === needle || j.name?.toLowerCase() === needle,
  );
  if (match) return match;

  // 4. Substring match (id or name contains the log name, or vice-versa)
  match = ir.jobs.find(
    (j) =>
      j.id.toLowerCase().includes(needle) ||
      needle.includes(j.id.toLowerCase()) ||
      (j.name &&
        (j.name.toLowerCase().includes(needle) ||
          needle.includes(j.name.toLowerCase()))),
  );
  return match;
}

/** Step shape with guaranteed index (the IR guarantees this but TS needs help). */
interface StepWithIndex {
  index: number;
  path: string;
  name?: string;
  kind: string;
}

/** Find the best-matching step for a log step label. */
function findStep(
  steps: WorkflowIR["jobs"][number]["steps"],
  logStepLabel: string,
): StepWithIndex | undefined {
  // The log label is often the group header value which looks like:
  //   "Run actions/setup-node@v4"
  //   "Set up job"
  //   "Check out repository"
  // The IR has step.name and for uses-steps: step.uses; for run-steps: step.run.

  const needle = logStepLabel.toLowerCase();

  // Strip a "Run " prefix that the runner adds automatically.
  const needleWithoutRun = needle.startsWith("run ")
    ? needle.slice("run ".length)
    : needle;

  for (const step of steps) {
    const nameLower = step.name?.toLowerCase();

    // 1. Exact name match
    if (nameLower !== undefined && nameLower === needle) {
      return step as StepWithIndex;
    }

    // 2. Name matches the label without the "Run " prefix
    if (nameLower !== undefined && nameLower === needleWithoutRun) {
      return step as StepWithIndex;
    }

    // 3. `uses` / `run` field substring match
    if (step.kind === "uses") {
      const usesLower = step.uses.toLowerCase();
      if (
        usesLower === needleWithoutRun ||
        usesLower.includes(needleWithoutRun) ||
        needleWithoutRun.includes(usesLower.split("@")[0] ?? "")
      ) {
        return step as StepWithIndex;
      }
    }

    if (step.kind === "run") {
      const runLower = step.run.toLowerCase().trim();
      if (
        runLower === needleWithoutRun ||
        runLower.startsWith(needleWithoutRun) ||
        needleWithoutRun.startsWith(runLower.split("\n")[0] ?? "")
      ) {
        return step as StepWithIndex;
      }
    }

    // 4. Name substring match (both directions)
    if (nameLower !== undefined) {
      if (nameLower.includes(needleWithoutRun) || needleWithoutRun.includes(nameLower)) {
        return step as StepWithIndex;
      }
    }
  }

  // 5. Loose: any step whose uses contains a distinctive keyword from the label
  // Only use words that are specific enough (>= 6 chars) to avoid false matches
  // on generic words like "action", "step", "run", etc.
  const keywords = needleWithoutRun
    .split(/[\s/@-]+/)
    .filter((k) => k.length >= 7);
  if (keywords.length > 0) {
    for (const step of steps) {
      if (step.kind === "uses") {
        const usesLower = step.uses.toLowerCase();
        if (keywords.some((kw) => usesLower.includes(kw))) {
          return step as StepWithIndex;
        }
      }
      if (step.name) {
        const nameLower2 = step.name.toLowerCase();
        if (keywords.some((kw) => nameLower2.includes(kw))) {
          return step as StepWithIndex;
        }
      }
    }
  }

  return undefined;
}

/** Compact error summary for the human-readable summary line. */
function summariseErrors(failure: RunFailure): string {
  const all = [...failure.errorLines, ...failure.annotations];
  if (all.length === 0) return "(no error details captured)";
  const first = all[0]!;
  return all.length === 1 ? first : `${first} (+${all.length - 1} more)`;
}
