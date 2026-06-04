"use client";

/* ============================================================================
 * SidePanel — the left sidebar that switches between five tabs: workflows,
 * actions, templates, policies, and diagnostics. Prop-less: everything comes
 * from useEditor(). Port of /design/assets/editor-sidebar.jsx wired to the
 * live Analysis pipeline.
 * ============================================================================ */

import { useState } from "react";
import { POLICY_PACKS, POLICY_RULES, trustOf, lookupActionMeta } from "@daggler/validators";
import { useEditor } from "../lib/store";
import { pathToSelection } from "../lib/selection";
import { SearchIcon } from "./icons";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate, type UsesStepIR } from "@daggler/workflow-ir";

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/** Extract the last path segment of a file path (e.g. "ci.yml" from ".github/workflows/ci.yml"). */
function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/* ---------------------------------------------------------------------------
 * Section heading shared across all tabs
 * ---------------------------------------------------------------------------
 * Matches the `.side-head` rule — uppercase 11 px label + optional count badge.
 */
function SideHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="side-head">
      <span>{title}</span>
      {count !== undefined && (
        <span className="side-count">{count}</span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Tab: Workflows
 * ---------------------------------------------------------------------------
 * Lists all sample workflows, then the jobs for the active workflow. When a
 * job is selected its steps are revealed as a nested `.side-steps` subtree.
 */
function WorkflowsTab() {
  const {
    workflows,
    activeId,
    active,
    analysis,
    selected,
    setSelected,
    selectWorkflow,
  } = useEditor();

  const activeName = basename(active.path);

  return (
    <div className="side scroll">
      {/* ---- workflow file list ---- */}
      <SideHead title="Workflows" count={workflows.length} />
      <div className="side-files">
        {workflows.map((w) => (
          <button
            key={w.id}
            className={"side-file" + (w.id === activeId ? " is-on" : "")}
            onClick={() => selectWorkflow(w.id)}
          >
            <span className="side-file__dot" />
            <span className="side-file__body">
              <span className="side-file__name">{w.name}</span>
              <span className="side-file__path mono">{w.path}</span>
            </span>
            <span className="side-file__n mono">{w.tag}</span>
          </button>
        ))}
      </div>

      {/* ---- job tree for active workflow ---- */}
      <SideHead title={`Jobs · ${activeName}`} />
      <div className="side-tree">
        {analysis.ir.jobs.map((j) => {
          // Bubble worst severity: jobSeverity is pre-computed by the engine
          // as the worst severity across the job and all its steps.
          const sev = analysis.jobSeverity[j.id] ?? null;
          const isJobSelected =
            selected?.type === "job" && selected.id === j.id;

          return (
            <div key={j.id}>
              {/* Job row */}
              <button
                className={"side-job" + (isJobSelected ? " is-on" : "")}
                onClick={() => setSelected({ type: "job", id: j.id })}
              >
                <span className="side-job__name">{j.name ?? j.id}</span>
                {sev && (
                  <span className={`side-job__sev sev-${sev}`} />
                )}
              </button>

              {/* Step list — only when this job is selected */}
              {isJobSelected && (
                <div className="side-steps">
                  {j.steps.map((step, i) => {
                    const isUses = step.kind === "uses";
                    const isRun = step.kind === "run";
                    const typeLabel = isUses ? "uses" : isRun ? "run" : "raw";
                    const typeClass = isUses
                      ? "is-uses"
                      : isRun
                        ? "is-run"
                        : "is-run";

                    // Display name: explicit name → uses string → run snippet.
                    let displayName: string = step.name ?? "";
                    if (!displayName) {
                      if (step.kind === "uses") {
                        displayName = step.uses;
                      } else if (step.kind === "run") {
                        // Show the first non-empty line of the run script.
                        displayName =
                          step.run.trim().split("\n")[0] ?? step.run;
                      } else {
                        displayName = "(raw step)";
                      }
                    }

                    return (
                      <button
                        key={i}
                        className="side-step"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected({ type: "step", id: j.id, stepIndex: i });
                        }}
                      >
                        <span
                          className={`side-step__t mono ${typeClass}`}
                        >
                          {typeLabel}
                        </span>
                        <span className="side-step__name">{displayName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Tab: Actions
 * ---------------------------------------------------------------------------
 * Gathers the unique `uses` actions from the live IR. Renders a searchable
 * list of action cards with trust level and ref. If an action is selected and
 * has catalog metadata, an `.actiondetail` block appears above the list.
 */
function ActionsTab() {
  const { analysis, selectedAction, setSelectedAction, insertActionStep } = useEditor();
  const [query, setQuery] = useState("");

  // Collect unique uses-steps keyed by step.uses string.
  const usesMap = new Map<string, UsesStepIR>();
  for (const job of analysis.ir.jobs) {
    for (const step of job.steps) {
      if (step.kind === "uses" && !usesMap.has(step.uses)) {
        usesMap.set(step.uses, step);
      }
    }
  }
  const usesSteps = Array.from(usesMap.values());

  // Filter by query.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? usesSteps.filter((s) => s.uses.toLowerCase().includes(q))
    : usesSteps;

  // Resolve detail for currently selected action.
  const detailStep = selectedAction
    ? usesSteps.find((s) => s.uses === selectedAction)
    : null;
  const detailMeta =
    detailStep?.ref.kind === "remote"
      ? lookupActionMeta(detailStep.ref.owner, detailStep.ref.repo)
      : null;
  const detailTrust = detailStep ? trustOf(detailStep.ref) : null;

  // Color for the trust fill bar.
  const trustFillColor =
    detailTrust?.level === "high"
      ? "var(--ok)"
      : detailTrust?.level === "medium"
        ? "var(--accent)"
        : "var(--warn)";

  return (
    <div className="side scroll">
      {/* Search box */}
      <div className="side-search">
        <SearchIcon />
        <input
          className="side-search__in"
          placeholder="Search actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Action detail block — shown above the list when an action is selected
          and we have catalog metadata for it. */}
      {detailStep && detailMeta && detailTrust && (
        <div className="actiondetail">
          <div className="actiondetail__name">{detailMeta.fullName}</div>
          <div className="actiondetail__desc">{detailMeta.description}</div>

          {/* Trust bar */}
          <div className="actiondetail__trustbar">
            <div
              className="actiondetail__trustfill"
              style={{
                width: `${detailTrust.score}%`,
                background: trustFillColor,
              }}
            />
          </div>

          {/* Inputs / outputs table */}
          {(detailMeta.inputs.length > 0 || detailMeta.outputs.length > 0) && (
            <div className="io-table">
              {detailMeta.inputs.map((inp) => (
                <div key={inp.name} className="io-row">
                  <span className="io-row__name">{inp.name}</span>
                  {inp.required && (
                    <span className="io-row__req">required</span>
                  )}
                </div>
              ))}
              {detailMeta.outputs.map((out) => (
                <div key={out} className="io-row">
                  <span className="io-row__name">{out}</span>
                </div>
              ))}
            </div>
          )}

          {/* Insert action into selected job */}
          <button
            className="action-insert-btn"
            onClick={() => insertActionStep(selectedAction!)}
            title={`Insert ${selectedAction} into the selected job`}
          >
            + Insert into selected job
          </button>
        </div>
      )}

      {/* Action list */}
      <SideHead title="Used in this repo" />
      <div className="side-actions">
        {filtered.map((step) => {
          const trust = trustOf(step.ref);
          const ref = step.ref;

          // Determine display name: owner/repo (strip subpath for brevity).
          const displayName =
            ref.kind === "remote" && ref.owner && ref.repo
              ? `${ref.owner}/${ref.repo}`
              : step.uses;

          // Warn when ref is a mutable tag or branch and the action is not official.
          const isMutable =
            ref.refKind === "tag" || ref.refKind === "branch";
          const isOfficial =
            ref.kind === "remote" &&
            (ref.owner === "actions" || ref.owner === "github");
          const showWarn = isMutable && !isOfficial;

          // Trust label text and CSS class.
          const trustClass =
            trust.level === "high"
              ? "trust-verified"
              : trust.level === "medium"
                ? "trust-org"
                : "trust-community";
          const trustLabel =
            trust.official
              ? "✓ verified"
              : trust.level === "medium"
                ? "✓ org"
                : "community";

          return (
            <div
              key={step.uses}
              className="side-action side-action--row"
              role="button"
              tabIndex={0}
              onClick={() =>
                setSelectedAction(
                  selectedAction === step.uses ? null : step.uses,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  setSelectedAction(selectedAction === step.uses ? null : step.uses);
              }}
            >
              <span className="side-action__top">
                <span className="side-action__name mono">{displayName}</span>
                {showWarn && (
                  <span
                    className="side-action__warn"
                    title="Mutable ref — pin to a SHA for supply-chain safety"
                  >
                    !
                  </span>
                )}
              </span>
              <span className="side-action__meta">
                {ref.ref && (
                  <span className="side-action__ref mono">{ref.ref}</span>
                )}
                <span className={`side-action__trust ${trustClass}`}>
                  {trustLabel}
                </span>
                <button
                  className="action-insert-icon"
                  title={`Insert ${step.uses} into selected job`}
                  onClick={(e) => {
                    e.stopPropagation();
                    insertActionStep(step.uses);
                  }}
                >
                  +
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Tab: Templates
 * ---------------------------------------------------------------------------
 * Renders WORKFLOW_TEMPLATES from @daggler/workflow-ir grouped by category.
 * Clicking a template (or its + button) calls insertTemplate(t.id).
 */

/** Group WORKFLOW_TEMPLATES by category, preserving insertion order. */
function groupTemplates(
  templates: readonly WorkflowTemplate[],
): { category: string; items: WorkflowTemplate[] }[] {
  const map = new Map<string, WorkflowTemplate[]>();
  for (const t of templates) {
    const bucket = map.get(t.category);
    if (bucket) {
      bucket.push(t);
    } else {
      map.set(t.category, [t]);
    }
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

const TEMPLATE_CATEGORY_GROUPS = groupTemplates(WORKFLOW_TEMPLATES);

function TemplatesTab() {
  const { insertTemplate } = useEditor();

  return (
    <div className="side scroll">
      <SideHead title="Templates" count={WORKFLOW_TEMPLATES.length} />
      {TEMPLATE_CATEGORY_GROUPS.map((grp) => (
        <div key={grp.category} className="side-tplgroup">
          <div className="side-tplgroup__h">{grp.category}</div>
          {grp.items.map((t) => (
            <button
              key={t.id}
              className="side-tpl"
              title={t.description}
              onClick={() => insertTemplate(t.id)}
            >
              <span className="side-tpl__icon mono">⌘</span>
              <span className="side-tpl__name">{t.name}</span>
              <span className="side-tpl__add">+</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Tab: Policies
 * ---------------------------------------------------------------------------
 * Renders every entry in POLICY_PACKS with an on/off toggle (visual only —
 * policy toggle state is not yet persisted in v1) and a count of how many
 * POLICY_RULES belong to that pack.
 */
function PoliciesTab() {
  return (
    <div className="side scroll">
      <SideHead title="Policy packs" />
      <div className="side-policies">
        {POLICY_PACKS.map((pack) => {
          // Count rules that reference this pack.
          const ruleCount = POLICY_RULES.filter((r) =>
            r.packs.includes(pack.id),
          ).length;

          // All packs default on in the UI mock.
          const isOn = true;

          return (
            <div
              key={pack.id}
              className={"side-policy" + (isOn ? "" : " is-off")}
            >
              {/* Toggle knob */}
              <span
                className={
                  "side-policy__toggle" + (isOn ? " is-on" : "")
                }
              >
                <span className="side-policy__knob" />
              </span>

              {/* Pack name + metadata */}
              <span className="side-policy__body">
                <span className="side-policy__name">{pack.name}</span>
                <span className="side-policy__meta">
                  <span className="side-policy__mode mode-advisory">
                    advisory
                  </span>
                  <span className="side-policy__rules mono">
                    {ruleCount} rules
                  </span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Tab: Diagnostics
 * ---------------------------------------------------------------------------
 * Lists all validation diagnostics for the active workflow. Clicking a row
 * navigates the editor selection to the offending node via pathToSelection().
 */
function DiagnosticsTab() {
  const { analysis, setSelected } = useEditor();
  const { diagnostics } = analysis.validation;

  return (
    <div className="side scroll">
      <SideHead title="Diagnostics" count={diagnostics.length} />
      <div className="side-diaglist">
        {diagnostics.map((d, i) => (
          <button
            key={d.id ?? i}
            className="side-diag"
            onClick={() => setSelected(pathToSelection(d.path))}
          >
            <span className={`side-diag__sev sev-${d.severity}`} />
            <span className="side-diag__body">
              <span className="side-diag__title">{d.title}</span>
              <span className="side-diag__code mono">
                {d.code} · {d.source}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * SidePanel — root switch on tab
 * ---------------------------------------------------------------------------
 * Rendered inside `.ed-side` by the editor layout. The outer container div is
 * owned by the layout; SidePanel itself just returns the active tab's subtree.
 */
export function SidePanel() {
  const { tab } = useEditor();

  switch (tab) {
    case "workflows":
      return <WorkflowsTab />;
    case "actions":
      return <ActionsTab />;
    case "templates":
      return <TemplatesTab />;
    case "policies":
      return <PoliciesTab />;
    case "diagnostics":
      return <DiagnosticsTab />;
    default: {
      // TypeScript exhaustiveness guard — should never reach here at runtime.
      const _exhaustive: never = tab;
      return null;
    }
  }
}
