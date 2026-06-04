"use client";

/* ============================================================================
 * Chrome.tsx — Daggler editor chrome: top bar, left rail, diagnostics panel,
 * command palette, FAB, and toast stack. All components are prop-less and pull
 * state from useEditor(). Ported from .design/assets/editor-chrome.jsx to TSX,
 * wired to the live store instead of the static window.DAG mock.
 * ============================================================================ */

import { useEffect, useState, type ReactNode } from "react";
import { prettyPath } from "@daggler/workflow-ir";
import { useEditor, type RunMode } from "../lib/store";
import { pathToSelection } from "../lib/selection";
import { RunPanel } from "./RunPanel";
import {
  LogoMark,
  BranchIcon,
  PrIcon,
  FlowIcon,
  CubeIcon,
  TplIcon,
  BugIcon,
  ShieldIcon,
  GearIcon,
} from "./icons";

// ============================================================================
// ConfidenceLadder (internal)
// ============================================================================

/** The three confidence rungs that drive the run simulation. */
const RUNGS: { id: RunMode; label: string; sub: string }[] = [
  { id: "static", label: "Static", sub: "Analyze" },
  { id: "local", label: "Local", sub: "Approximate" },
  { id: "github", label: "GitHub", sub: "Prove" },
];

function ConfidenceLadder(): ReactNode {
  const { runState, runMode, runSimulation, runViaApi } = useEditor();

  return (
    <div className="ladder" role="group" aria-label="Confidence">
      {RUNGS.map((r, i) => {
        const isActive = runMode === r.id;
        const isRunning =
          runState?.mode === r.id && runState.running === true;
        const cls =
          "ladder__rung" +
          (isActive ? " is-active" : "") +
          (isRunning ? " is-running" : "");

        return (
          <button
            key={r.id}
            className={cls}
            onClick={() => r.id === "static" ? runSimulation(r.id) : runViaApi(r.id)}
            title={r.sub}
          >
            {/* numbered level badge */}
            <span className="ladder__lvl">{i + 1}</span>
            {/* label + sub-label */}
            <span className="ladder__txt">
              <span className="ladder__label">{r.label}</span>
              <span className="ladder__sub">{r.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// SecurityPosture (internal)
// ============================================================================

/** Pill showing the current security grade and score. */
function SecurityPosture(): ReactNode {
  const { analysis } = useEditor();
  const { score, grade, factors } = analysis.validation.security;

  // Build a readable factors tooltip — one factor per line.
  const title = factors.length > 0 ? factors.join("\n") : undefined;

  return (
    <div className="posture" title={title} aria-label={`Security grade ${grade}`}>
      {/* coloured grade badge */}
      <span className={`posture__grade grade-${grade}`}>{grade}</span>
      {/* score and label */}
      <span className="posture__txt">
        <span className="posture__label">{score}/100</span>
        <span className="posture__sub">SECURITY</span>
      </span>
    </div>
  );
}

// ============================================================================
// TopBar
// ============================================================================

/**
 * The 48 px header spanning the full editor width. Contains:
 *  - Brand / breadcrumb (left)
 *  - View segmented control (center, absolutely positioned)
 *  - Confidence ladder, security posture, theme toggle, Diff, Open PR (right)
 */
export function TopBar(): ReactNode {
  const { view, setView, dirty, active, theme, toggleTheme, pushToast } =
    useEditor();

  // Derive the file basename from the workflow path (e.g. "ci.yml").
  const basename = active.path.split("/").pop() ?? active.path;

  return (
    <header className="ed-top">
      {/* ---- left -------------------------------------------------------- */}
      <div className="ed-top__left">
        {/* Brand */}
        <a className="ed-brand" href="/">
          <span className="ed-logo">
            <LogoMark size={18} />
          </span>
          <span className="ed-wordmark">
            <b>DAG</b>gler
          </span>
        </a>

        {/* Separator */}
        <span className="ed-sep" />

        {/* Breadcrumb: org / repo + branch chip */}
        <nav className="ed-crumb mono">
          <span className="ed-crumb__org">acme</span>
          <span className="ed-crumb__slash">/</span>
          <span className="ed-crumb__repo">web-platform</span>
          <span className="ed-branch">
            <BranchIcon size={11} />
            main
          </span>
        </nav>

        {/* Active file chip — dirty dot when there are unsaved changes */}
        <span className="ed-file mono">
          {basename}
          {dirty && (
            <span className="ed-dirty" title="Unsaved changes" />
          )}
        </span>
      </div>

      {/* ---- center (absolutely positioned so it stays centred) --------- */}
      <div className="ed-top__center">
        <div className="ed-viewseg">
          {(["graph", "split", "yaml"] as const).map((v) => (
            <button
              key={v}
              className={"ed-viewseg__btn" + (view === v ? " is-on" : "")}
              onClick={() => setView(v)}
            >
              {/* Capitalise first letter, e.g. "Graph" */}
              {v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ---- right ------------------------------------------------------- */}
      <div className="ed-top__right">
        {/* Confidence ladder */}
        <ConfidenceLadder />

        {/* Security posture pill */}
        <SecurityPosture />

        {/* Theme toggle */}
        <button
          className="ed-icbtn"
          title="Toggle theme"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>

        {/* Diff button */}
        <button
          className="btn btn--sm"
          onClick={() => pushToast("Diff view — connect a base revision")}
        >
          Diff
        </button>

        {/* Open PR button */}
        <button
          className="btn btn--primary btn--sm"
          onClick={() => pushToast("Opening a PR requires connecting GitHub")}
        >
          <PrIcon size={12} />
          Open PR
        </button>
      </div>
    </header>
  );
}

// ============================================================================
// LeftRail
// ============================================================================

/** Sidebar icon rail with tab switching and an error badge on diagnostics. */
export function LeftRail(): ReactNode {
  const { tab, setTab, analysis, pushToast } = useEditor();
  const errorCount = analysis.validation.counts.error;

  const items: {
    id: "workflows" | "actions" | "templates" | "diagnostics" | "policies";
    icon: ReactNode;
    label: string;
  }[] = [
    { id: "workflows", icon: <FlowIcon />, label: "Workflows" },
    { id: "actions", icon: <CubeIcon />, label: "Actions catalog" },
    { id: "templates", icon: <TplIcon />, label: "Templates" },
    { id: "diagnostics", icon: <BugIcon />, label: "Diagnostics" },
    { id: "policies", icon: <ShieldIcon />, label: "Policies" },
  ];

  return (
    <nav className="ed-rail">
      {items.map((it) => (
        <button
          key={it.id}
          className={"ed-rail__btn" + (tab === it.id ? " is-on" : "")}
          onClick={() => setTab(it.id)}
          title={it.label}
          aria-current={tab === it.id ? "page" : undefined}
        >
          {it.icon}
          {/* Error badge — only shown when there is at least one error */}
          {it.id === "diagnostics" && errorCount > 0 && (
            <span className="ed-rail__badge" aria-label={`${errorCount} errors`}>
              {errorCount}
            </span>
          )}
        </button>
      ))}

      {/* Push the gear to the bottom */}
      <div className="ed-rail__spacer" />

      <button
        className="ed-rail__btn"
        title="Settings"
        onClick={() => pushToast("Settings")}
      >
        <GearIcon />
      </button>
    </nav>
  );
}

// ============================================================================
// DiagnosticsPanel
// ============================================================================

/** Collapsible bottom panel with Diagnostics + Run tabs. */
export function DiagnosticsPanel(): ReactNode {
  const { analysis, diagOpen, setDiagOpen, setSelected, lastRun } = useEditor();
  const { diagnostics, counts } = analysis.validation;
  const [activeTab, setActiveTab] = useState<"diagnostics" | "run">("diagnostics");

  // Switch to Run tab automatically when a new run result arrives.
  useEffect(() => {
    if (lastRun) setActiveTab("run");
  }, [lastRun]);

  return (
    <div className={"ed-bottom" + (diagOpen ? " is-open" : "")}>
      {/* Header — always visible, toggles open/closed */}
      <div className="ed-bottom__head-row">
        {/* Tab buttons */}
        <button
          className={"ed-bottom__tab" + (activeTab === "diagnostics" ? " is-active" : "")}
          onClick={() => { setActiveTab("diagnostics"); setDiagOpen(true); }}
        >
          Diagnostics
          <span className="ed-bottom__counts">
            {counts.error > 0 && (
              <span className="ed-cnt sev-error">● {counts.error}</span>
            )}
            {counts.warning > 0 && (
              <span className="ed-cnt sev-warning">● {counts.warning}</span>
            )}
          </span>
        </button>
        <button
          className={"ed-bottom__tab" + (activeTab === "run" ? " is-active" : "")}
          onClick={() => { setActiveTab("run"); setDiagOpen(true); }}
        >
          Run
          {lastRun && (
            <span className={`ed-cnt ed-cnt--run sev-${lastRun.status === "passed" || lastRun.status === "ok" ? "info" : lastRun.status === "unavailable" ? "warning" : "error"}`}>
              ● {lastRun.status}
            </span>
          )}
        </button>
        {/* Toggle collapse */}
        <button
          className="ed-bottom__toggle"
          onClick={() => setDiagOpen(!diagOpen)}
          aria-expanded={diagOpen}
          aria-label={diagOpen ? "Collapse panel" : "Expand panel"}
        >
          <span className="ed-bottom__chev" aria-hidden>
            {diagOpen ? "▾" : "▴"}
          </span>
        </button>
      </div>

      {/* Panel body — rendered only when open */}
      {diagOpen && activeTab === "diagnostics" && (
        <div className="ed-bottom__list scroll" role="list">
          {diagnostics.map((d) => (
            <button
              key={d.id}
              className="ed-diagrow"
              role="listitem"
              onClick={() => setSelected(pathToSelection(d.path))}
              title={d.message}
            >
              {/* Severity colour dot */}
              <span className={`ed-diagrow__sev sev-${d.severity}`} aria-hidden />
              {/* Rule code */}
              <code className="ed-diagrow__code mono">{d.code}</code>
              {/* Short title */}
              <span className="ed-diagrow__title">{d.title}</span>
              {/* Validation layer / source */}
              <span className="ed-diagrow__src mono">{d.source}</span>
              {/* Human-readable path */}
              <span className="ed-diagrow__path mono">{prettyPath(d.path)}</span>
            </button>
          ))}
        </div>
      )}

      {diagOpen && activeTab === "run" && <RunPanel />}
    </div>
  );
}

// ============================================================================
// CommandPalette
// ============================================================================

/** Command definition used inside the palette. */
interface PaletteCommand {
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

/** Full-screen command palette (⌘K). Filters by label substring. */
export function CommandPalette(): ReactNode {
  const {
    palOpen,
    setPalOpen,
    setView,
    runSimulation,
    runViaApi,
    runEventSimulate,
    analysis,
    applyQuickFix,
    pushToast,
    toggleTheme,
  } = useEditor();

  const [query, setQuery] = useState("");

  // Reset the search query whenever the palette opens.
  useEffect(() => {
    if (palOpen) setQuery("");
  }, [palOpen]);

  // Nothing to render when closed — this avoids leaving a focus trap in the DOM.
  if (!palOpen) return null;

  /** Apply all pin-SHA quick-fixes found in the current diagnostics list. */
  const pinAll = () => {
    const pinnable = analysis.validation.diagnostics.filter(
      (d) => d.fix?.pinSha != null,
    );
    for (const d of pinnable) {
      applyQuickFix(d);
    }
    pushToast(
      pinnable.length > 0
        ? `Pinned ${pinnable.length} action${pinnable.length === 1 ? "" : "s"} to SHA`
        : "No unpinned actions found",
    );
    setPalOpen(false);
  };

  const commands: PaletteCommand[] = [
    {
      label: "Validate workflow",
      hint: "static",
      icon: "✓",
      run: () => { runSimulation("static"); setPalOpen(false); },
    },
    {
      label: "Run locally (approximate)",
      hint: "local",
      icon: "▷",
      run: () => { runViaApi("local"); setPalOpen(false); },
    },
    {
      label: "Prove on GitHub",
      hint: "github",
      icon: "◆",
      run: () => { runViaApi("github"); setPalOpen(false); },
    },
    {
      label: "Simulate event (pull_request@main)",
      hint: "simulate",
      icon: "⚡",
      run: () => { runEventSimulate(); setPalOpen(false); },
    },
    {
      label: "Switch to Graph view",
      icon: "▢",
      run: () => { setView("graph"); setPalOpen(false); },
    },
    {
      label: "Switch to Split view",
      icon: "◫",
      run: () => { setView("split"); setPalOpen(false); },
    },
    {
      label: "Switch to YAML view",
      icon: "⌶",
      run: () => { setView("yaml"); setPalOpen(false); },
    },
    {
      label: "Pin all third-party actions to SHA",
      icon: "⚲",
      run: pinAll,
    },
    {
      label: "Reduce permissions to least privilege",
      icon: "⛨",
      run: () => {
        pushToast("Least-privilege suggestions coming soon");
        setPalOpen(false);
      },
    },
    {
      label: "Open pull request",
      icon: "⤴",
      run: () => {
        pushToast("Connect GitHub to open a PR");
        setPalOpen(false);
      },
    },
    {
      label: "Toggle theme",
      icon: "☾",
      run: () => { toggleTheme(); setPalOpen(false); },
    },
  ];

  const filtered =
    query.trim() === ""
      ? commands
      : commands.filter((c) =>
          c.label.toLowerCase().includes(query.toLowerCase()),
        );

  return (
    /* Overlay — clicking outside closes the palette */
    <div
      className="pal-overlay"
      onClick={() => setPalOpen(false)}
      role="dialog"
      aria-modal
      aria-label="Command palette"
    >
      {/* Stop propagation so clicks inside the palette don't close it */}
      <div className="pal" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <input
          className="pal__input mono"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setPalOpen(false);
            }
          }}
          aria-label="Search commands"
        />

        {/* Command list */}
        <div className="pal__list scroll" role="listbox">
          {filtered.length === 0 ? (
            <div className="pal__empty">No matching commands</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.label}
                className="pal__row"
                role="option"
                aria-selected={false}
                onClick={c.run}
              >
                <span className="pal__icon" aria-hidden>{c.icon}</span>
                <span className="pal__label">{c.label}</span>
                {c.hint != null && (
                  <span className="pal__hint mono">{c.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Fab
// ============================================================================

/** Fixed action button (⌘K) that opens the command palette. */
export function Fab(): ReactNode {
  const { setPalOpen } = useEditor();

  return (
    <button
      className="ed-fab"
      onClick={() => setPalOpen(true)}
      aria-label="Open command palette (⌘K)"
    >
      <kbd className="kbd">⌘K</kbd>
      Commands
    </button>
  );
}

// ============================================================================
// ToastStack
// ============================================================================

/** Renders the stack of ephemeral toast notifications. */
export function ToastStack(): ReactNode {
  const { toasts } = useEditor();

  return (
    <div className="toast-wrap" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status">
          <span className="toast__dot" aria-hidden />
          {t.text}
        </div>
      ))}
    </div>
  );
}
