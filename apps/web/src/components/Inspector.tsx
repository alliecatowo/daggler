"use client";

/* ============================================================================
 * Inspector — the right-hand property panel of the Daggler editor.
 *
 * Renders one of three sub-panels depending on what's selected:
 *   - null → EmptyState
 *   - {type:"workflow"} → WorkflowInsp
 *   - {type:"job", id} → JobInsp
 *   - {type:"step", id, stepIndex} → StepInsp
 *
 * All data flows exclusively from useEditor(). Every input/select fires an
 * applyEdit() command so the YAML + graph re-render live. Quick-fix buttons
 * call applyQuickFix() which runs the structured patch.
 * ============================================================================ */

import { lookupActionMeta, trustOf } from "@daggler/validators";
import type { ActionRef, PermissionIR, StepIR } from "@daggler/workflow-ir";
import type { ReactNode } from "react";
import type { Diagnostic } from "@daggler/validators";
import { useEditor } from "../lib/store";

/* ---------------------------------------------------------------------------
 * Low-level atoms
 * ------------------------------------------------------------------------ */

/** A label + content + optional hint row inside a section. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="insp-field">
      <label className="insp-label">{label}</label>
      {children}
      {hint && <div className="insp-hint">{hint}</div>}
    </div>
  );
}

/** A single text <input> styled as an inspector input. */
function TextInput({
  value,
  onChange,
  mono = false,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}): ReactNode {
  return (
    <input
      className={"insp-input" + (mono ? " mono" : "")}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A titled subsection with an optional right-side tag/count. */
function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="insp-section">
      <div className="insp-sectionhead">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * DiagCard — a single diagnostic finding card with optional quick-fix button
 * ------------------------------------------------------------------------ */

function DiagCard({ d }: { d: Diagnostic }): ReactNode {
  const { applyQuickFix } = useEditor();
  return (
    <div className={`diagcard diagcard--${d.severity}`}>
      <div className="diagcard__top">
        <span className={`diagcard__sev sev-${d.severity}`}>{d.severity}</span>
        <code className="diagcard__code mono">{d.code}</code>
      </div>
      <div className="diagcard__title">{d.title}</div>
      <div className="diagcard__msg">{d.message}</div>
      {d.fix && (
        <button
          className="diagcard__fix"
          onClick={() => applyQuickFix(d)}
          type="button"
        >
          {d.fix.label || "Quick fix ›"}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Perms — renders a PermissionIR in all three forms:
 *   p.all   → one row "(all) read-all / write-all"
 *   p.none  → one row "(all) none"
 *   p.scopes → one row per scope
 * ------------------------------------------------------------------------ */

function Perms({ p }: { p: PermissionIR }): ReactNode {
  if (p.all) {
    // read-all or write-all
    const level = p.all === "write" ? "write-all" : "read-all";
    return (
      <div className="insp-perms">
        <div className="insp-permrow">
          <span className="mono">all</span>
          <span className={`insp-permval${p.all === "write" ? " is-write" : ""}`}>
            {level}
          </span>
        </div>
      </div>
    );
  }

  if (p.none) {
    return (
      <div className="insp-perms">
        <div className="insp-permrow">
          <span className="mono">(all)</span>
          <span className="insp-permval">none</span>
        </div>
      </div>
    );
  }

  if (p.scopes && Object.keys(p.scopes).length > 0) {
    return (
      <div className="insp-perms">
        {Object.entries(p.scopes).map(([scope, level]) => (
          <div key={scope} className="insp-permrow">
            <span className="mono">{scope}</span>
            <span className={`insp-permval${level === "write" ? " is-write" : ""}`}>
              {level}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Empty PermissionIR — nothing to show.
  return null;
}

/* ---------------------------------------------------------------------------
 * refHint — advisory text shown below the "uses" field
 * ------------------------------------------------------------------------ */

function refHint(ref: ActionRef): string | undefined {
  if (ref.refKind === "sha") return undefined;
  if (ref.refKind === "branch") return "⚠ Branch ref — pin to a SHA";
  if (ref.refKind === "tag") return "Tag ref — pin to a SHA for third-party actions";
  return undefined;
}

/* ---------------------------------------------------------------------------
 * EmptyState — shown when nothing is selected
 * ------------------------------------------------------------------------ */

function EmptyState(): ReactNode {
  return (
    <div className="insp insp--empty">
      <div className="insp-emptyicon">{"{ }"}</div>
      <div className="insp-emptytitle">Nothing selected</div>
      <div className="insp-emptytext">
        Pick a job in the graph or a line in the YAML to inspect and edit it.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * WorkflowInsp — top-level workflow properties
 * ------------------------------------------------------------------------ */

function WorkflowInsp(): ReactNode {
  const { analysis, applyEdit } = useEditor();
  const { ir } = analysis;

  return (
    <div className="insp scroll">
      {/* Header */}
      <div className="insp-head">
        <span className="insp-kind">Workflow</span>
        <h3 className="insp-title">{ir.name || "workflow"}</h3>
      </div>

      {/* General */}
      <Section title="General">
        <Field label="Name">
          <TextInput
            value={ir.name ?? ""}
            placeholder="Workflow name"
            onChange={(name) => applyEdit({ type: "workflow.rename", name })}
          />
        </Field>
      </Section>

      {/* Triggers */}
      <Section title="Triggers">
        <div className="insp-chips">
          {ir.on.map((t) => (
            <span key={t.event} className="insp-trigger mono">
              {t.event}
            </span>
          ))}
        </div>
      </Section>

      {/* Permissions — only if present */}
      {ir.permissions && (
        <Section
          title="Permissions"
          right={<span className="insp-tag">top-level</span>}
        >
          <Perms p={ir.permissions} />
        </Section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * JobInsp — job-level properties, diagnostics, steps list
 * ------------------------------------------------------------------------ */

const RUNS_ON_OPTIONS = [
  "ubuntu-latest",
  "ubuntu-24.04",
  "macos-latest",
  "windows-latest",
  "self-hosted",
] as const;

function JobInsp({ jobId }: { jobId: string }): ReactNode {
  const { analysis, applyEdit, setSelected } = useEditor();
  const { ir, diagByPath } = analysis;

  const job = ir.jobs.find((j) => j.id === jobId);
  if (!job) return <EmptyState />;

  // Merge + de-dupe by diagnostic id: job-level diags + step diags bubbled up.
  const rawDiags = [
    ...(diagByPath[`job:${jobId}`] ?? []),
    ...(diagByPath[`__job__${jobId}`] ?? []),
  ];
  const seenIds = new Set<string>();
  const diags = rawDiags.filter((d) => {
    if (seenIds.has(d.id)) return false;
    seenIds.add(d.id);
    return true;
  });

  // Resolve the display value of runs-on (may be string or string[]).
  const runsOnVal = Array.isArray(job.runsOn)
    ? (job.runsOn[0] ?? "ubuntu-latest")
    : (job.runsOn ?? "ubuntu-latest");

  return (
    <div className="insp scroll">
      {/* Header */}
      <div className="insp-head">
        <span className="insp-kind">Job</span>
        <h3 className="insp-title">{job.name || job.id}</h3>
        <code className="insp-id mono">{job.id}</code>
      </div>

      {/* Diagnostics block */}
      {diags.length > 0 && (
        <div className="insp-diags">
          {diags.map((d) => (
            <DiagCard key={d.id} d={d} />
          ))}
        </div>
      )}

      {/* Configuration */}
      <Section title="Configuration">
        <Field label="Display name">
          <TextInput
            value={job.name ?? ""}
            placeholder={job.id}
            onChange={(name) => applyEdit({ type: "job.rename", jobId, name })}
          />
        </Field>

        <Field label="runs-on">
          <div className="insp-select-wrap">
            <select
              className="insp-input mono"
              value={runsOnVal}
              onChange={(e) =>
                applyEdit({ type: "job.runsOn", jobId, runsOn: e.target.value })
              }
            >
              {RUNS_ON_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </Field>

        {job.needs.length > 0 && (
          <Field label="needs">
            <div className="insp-chips">
              {job.needs.map((n) => (
                <span
                  key={n}
                  className="insp-need mono"
                  onClick={() => setSelected({ type: "job", id: n })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      setSelected({ type: "job", id: n });
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          </Field>
        )}
      </Section>

      {/* Matrix — only if strategy.matrix.dimensions has entries */}
      {job.strategy?.matrix && Object.keys(job.strategy.matrix.dimensions).length > 0 && (
        <Section title="Matrix">
          {Object.entries(job.strategy.matrix.dimensions).map(([k, vals]) => (
            <Field key={k} label={k}>
              <div className="insp-chips">
                {vals.map((v, vi) => (
                  <span key={`${k}-${vi}`} className="insp-matval mono">
                    {String(v)}
                  </span>
                ))}
              </div>
            </Field>
          ))}
        </Section>
      )}

      {/* Job-level permissions */}
      {job.permissions && (
        <Section
          title="Permissions"
          right={<span className="insp-tag">job-level</span>}
        >
          <Perms p={job.permissions} />
        </Section>
      )}

      {/* Environment */}
      {job.environment && (
        <Section title="Environment">
          <div className="insp-envcard">
            <span className="insp-envname">{job.environment.name}</span>
            <span className="insp-envgate">protected · required reviewers</span>
          </div>
        </Section>
      )}

      {/* Outputs */}
      {job.outputs && Object.keys(job.outputs).length > 0 && (
        <Section title="Outputs">
          {Object.entries(job.outputs).map(([k, v]) => (
            <Field key={k} label={k}>
              <code className="insp-expr mono">{v}</code>
            </Field>
          ))}
        </Section>
      )}

      {/* Steps */}
      <Section
        title="Steps"
        right={<span className="insp-count">{job.steps.length}</span>}
      >
        <div className="insp-steps">
          {job.steps.map((s, i) => (
            <StepRowButton key={i} step={s} idx={i} jobId={jobId} />
          ))}
        </div>
      </Section>
    </div>
  );
}

/**
 * A single row in the step list inside JobInsp. Extracted to avoid closures
 * with loop indices in the parent map call.
 */
function StepRowButton({
  step,
  idx,
  jobId,
}: {
  step: StepIR;
  idx: number;
  jobId: string;
}): ReactNode {
  const { setSelected } = useEditor();

  // Determine display name: explicit name, uses string, run command.
  let displayName: string;
  if (step.name) {
    displayName = step.name;
  } else if (step.kind === "uses") {
    // Truncate after 40 chars so the row stays readable.
    const full = step.uses;
    displayName = full.length > 40 ? full.slice(0, 40) + "…" : full;
  } else if (step.kind === "run") {
    const first = step.run.split("\n")[0] ?? step.run;
    displayName = first.length > 40 ? first.slice(0, 40) + "…" : first;
  } else {
    displayName = "(raw step)";
  }

  const isUses = step.kind === "uses";

  return (
    <button
      type="button"
      className="insp-steprow"
      onClick={() => setSelected({ type: "step", id: jobId, stepIndex: idx })}
    >
      <span className="insp-stepidx mono">{idx + 1}</span>
      <span className={`insp-steptype ${isUses ? "is-uses" : "is-run"}`}>
        {isUses ? "uses" : "run"}
      </span>
      <span className="insp-stepname">{displayName}</span>
      <span className="insp-stepchev">›</span>
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * StepInsp — step-level properties, action metadata
 * ------------------------------------------------------------------------ */

function StepInsp({ jobId, stepIndex }: { jobId: string; stepIndex: number }): ReactNode {
  const { analysis, applyEdit, setSelected } = useEditor();
  const { ir, diagByPath } = analysis;

  const job = ir.jobs.find((j) => j.id === jobId);
  if (!job) return <EmptyState />;

  const step = job.steps[stepIndex];
  if (!step) return <EmptyState />;

  const diags = diagByPath[`step:${jobId}#${stepIndex}`] ?? [];

  // Head title: name, then uses (without @ref), then "Shell command".
  let headTitle: string;
  if (step.name) {
    headTitle = step.name;
  } else if (step.kind === "uses") {
    // Drop the @ref portion for display.
    headTitle = step.uses.split("@")[0] ?? step.uses;
  } else {
    headTitle = "Shell command";
  }

  const kindLabel = step.kind === "uses" ? "Action step" : "Run step";

  return (
    <div className="insp scroll">
      {/* Breadcrumb back to job */}
      <div className="insp-crumb">
        <button
          type="button"
          className="insp-back"
          onClick={() => setSelected({ type: "job", id: jobId })}
        >
          {"‹ "}{job.name || job.id}
        </button>
      </div>

      {/* Header */}
      <div className="insp-head">
        <span className="insp-kind">{kindLabel}</span>
        <h3 className="insp-title">{headTitle}</h3>
      </div>

      {/* Diagnostics */}
      {diags.length > 0 && (
        <div className="insp-diags">
          {diags.map((d) => (
            <DiagCard key={d.id} d={d} />
          ))}
        </div>
      )}

      {/* Step configuration */}
      <Section title="Step">
        {/* Name — always editable */}
        <Field label="Name">
          <TextInput
            value={step.name ?? ""}
            placeholder="(optional)"
            onChange={(name) =>
              applyEdit({ type: "step.setName", jobId, index: stepIndex, name })
            }
          />
        </Field>

        {/* uses — action reference */}
        {step.kind === "uses" && (
          <Field label="uses" hint={refHint(step.ref)}>
            <TextInput
              mono
              value={step.uses}
              onChange={(uses) =>
                applyEdit({ type: "step.setUses", jobId, index: stepIndex, uses })
              }
            />
          </Field>
        )}

        {/* run — shell script */}
        {step.kind === "run" && (
          <Field label="run">
            <textarea
              className="insp-input insp-textarea mono"
              rows={3}
              value={step.run}
              onChange={(e) =>
                applyEdit({ type: "step.setRun", jobId, index: stepIndex, run: e.target.value })
              }
            />
          </Field>
        )}
      </Section>

      {/* with — action inputs */}
      {step.kind === "uses" && step.with && Object.keys(step.with).length > 0 && (
        <Section
          title="with"
          right={<span className="insp-tag">inputs</span>}
        >
          {Object.entries(step.with).map(([k, v]) => (
            <Field key={k} label={k}>
              <TextInput
                mono
                value={String(v)}
                onChange={(value) =>
                  applyEdit({
                    type: "step.setWith",
                    jobId,
                    index: stepIndex,
                    key: k,
                    value,
                  })
                }
              />
            </Field>
          ))}
        </Section>
      )}

      {/* Action metadata — only for uses steps with a remote ref */}
      {step.kind === "uses" && <ActionMetaSection step={step} />}
    </div>
  );
}

/**
 * Renders the "Action metadata" section for a uses step. Extracted so the
 * catalog lookup doesn't sit inside the main render path.
 */
function ActionMetaSection({ step }: { step: { kind: "uses"; uses: string; ref: ActionRef } }): ReactNode {
  const meta = lookupActionMeta(step.ref.owner, step.ref.repo);
  const trust = trustOf(step.ref);

  // Runtime label.
  let runtimeLabel: string;
  if (meta?.runtime === "docker") {
    runtimeLabel = "Docker container";
  } else if (meta?.runtime === "node") {
    runtimeLabel = "JavaScript (node20)";
  } else if (meta?.runtime === "composite") {
    runtimeLabel = "Composite";
  } else {
    // Unknown / not in catalog — fall back based on the ref kind.
    runtimeLabel = "Composite";
  }

  // Trust display: level + verification status.
  const verificationLabel = meta?.official
    ? "GitHub-verified"
    : meta?.verified
    ? "Verified org"
    : "Unverified";
  const trustLabel = `${trust.level} · ${verificationLabel}`;

  // Resolved ref — SHA, tag, branch, or —.
  const resolvedLabel = step.ref.ref || "—";

  return (
    <Section title="Action metadata">
      <div className="insp-meta">
        <div className="insp-metarow">
          <span className="insp-metak">Resolved</span>
          <span className="insp-metav mono">{resolvedLabel}</span>
        </div>
        <div className="insp-metarow">
          <span className="insp-metak">Runtime</span>
          <span className="insp-metav">{runtimeLabel}</span>
        </div>
        <div className="insp-metarow">
          <span className="insp-metak">Trust</span>
          <span className="insp-metav">{trustLabel}</span>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------------------
 * Inspector — top-level exported component
 * ------------------------------------------------------------------------ */

export function Inspector(): ReactNode {
  const { selected } = useEditor();

  if (!selected) {
    return <EmptyState />;
  }

  if (selected.type === "workflow") {
    return <WorkflowInsp />;
  }

  if (selected.type === "job") {
    return <JobInsp jobId={selected.id} />;
  }

  // selected.type === "step"
  return <StepInsp jobId={selected.id} stepIndex={selected.stepIndex} />;
}
