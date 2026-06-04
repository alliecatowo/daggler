"use client";

/* ============================================================================
 * GraphCanvas — the live DAG canvas for a GitHub Actions workflow.
 *
 * Renders the job graph pulled from the shared editor store: job nodes laid
 * out by `needs` depth (pre-computed by buildGraph — we read node.depth, never
 * recompute), hairline bezier edges between jobs, run-simulation status, and
 * per-node diagnostic badges.  All logic is client-side; no network calls.
 *
 * Layout constants:
 *   COL_W  = 248  — column-to-column pitch (px)
 *   NODE_W = 196  — card width (px)
 *   GAP_Y  = 26   — vertical gap between cards in the same column (px)
 *   PAD    = 40   — canvas padding on all sides (px)
 *
 * Node height is fixed at 74 px so we can do the vertical-centering math
 * without measuring the DOM.
 * ============================================================================ */

import { useMemo } from "react";
import { useEditor } from "../lib/store";
import type { JobGraphNode } from "@daggler/workflow-ir";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const COL_W = 248;
const NODE_W = 196;
const GAP_Y = 26;
const PAD = 40;
const NODE_H = 74; // fixed card height

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface NodePos {
  x: number;
  y: number;
  w: number;
  h: number;
}

type PosMap = Record<string, NodePos>;

// ---------------------------------------------------------------------------
// Layout helper: group by depth, then vertically center each column.
// ---------------------------------------------------------------------------
function buildLayout(nodes: JobGraphNode[]): { pos: PosMap; canvasW: number; canvasH: number } {
  if (nodes.length === 0) {
    return { pos: {}, canvasW: PAD * 2, canvasH: PAD * 2 };
  }

  // Group job ids by their depth (pre-computed in the IR graph).
  const cols: Record<number, string[]> = {};
  for (const node of nodes) {
    const bucket = cols[node.depth] ?? (cols[node.depth] = []);
    bucket.push(node.id);
  }

  const depthKeys = Object.keys(cols)
    .map(Number)
    .sort((a, b) => a - b);

  // Calculate the max column height (in rows) across all columns.
  const maxRows = Math.max(...depthKeys.map((d) => cols[d]!.length));

  // Canvas height: at least 420 px, or tall enough for the tallest column.
  const canvasH = Math.max(420, maxRows * 100);

  // Assign x positions from depth; collect per-column total heights for
  // vertical centering.
  const pos: PosMap = {};

  for (const depth of depthKeys) {
    const ids = cols[depth]!;
    const colItemH = ids.length * NODE_H + (ids.length - 1) * GAP_Y;
    // Start y so the column is vertically centered within the canvas.
    let y = PAD + (canvasH - colItemH) / 2;

    for (const id of ids) {
      pos[id] = {
        x: PAD + depth * COL_W,
        y,
        w: NODE_W,
        h: NODE_H,
      };
      y += NODE_H + GAP_Y;
    }
  }

  // Canvas width: rightmost card edge + padding.
  const maxX = Math.max(...Object.values(pos).map((p) => p.x + p.w));
  const canvasW = maxX + PAD;

  return { pos, canvasW, canvasH };
}

// ---------------------------------------------------------------------------
// GraphCanvas component
// ---------------------------------------------------------------------------
export function GraphCanvas() {
  const { analysis, selected, setSelected, runState, simulateResult } = useEditor();
  const { ir, graph, diagByPath, jobSeverity } = analysis;

  // Compute layout from the graph nodes (depth is pre-computed by buildGraph).
  const { pos, canvasW, canvasH } = useMemo(
    () => buildLayout(graph.jobs),
    [graph.jobs],
  );

  // ---------- Empty state --------------------------------------------------
  if (ir.jobs.length === 0) {
    return (
      <div className="graph-wrap scroll">
        <div className="graph-empty">
          <div className="graph-empty__icon">{"{ }"}</div>
          <div className="graph-empty__title">No jobs to graph</div>
          <p className="graph-empty__text">
            Add a job under the <code>jobs:</code> key, or fix parse errors so
            the workflow can be understood.
          </p>
        </div>
      </div>
    );
  }

  // ---------- Edge rendering helpers ---------------------------------------
  // Only draw "needs" edges; resolve whether an edge is selected.
  const needsEdges = graph.edges.filter((e) => e.kind === "needs");

  const isJobSel = (id: string): boolean =>
    selected !== null && selected.type === "job" && selected.id === id;

  // ---------- Run-banner state ---------------------------------------------
  // Derive a single status label from the run state job map.
  function bannerDotClass(): string {
    if (!runState) return "idle";
    const statuses = Object.values(runState.jobs);
    if (statuses.some((s) => s === "running")) return "running";
    if (statuses.some((s) => s === "failed")) return "failed";
    return "passed";
  }

  function bannerModeLabel(): string {
    if (!runState) return "";
    switch (runState.mode) {
      case "local":
        return "Local approximation";
      case "github":
        return "GitHub run";
      case "static":
        return "Static analysis";
    }
  }

  // ---------- Render -------------------------------------------------------
  return (
    <div className="graph-wrap scroll" style={{ position: "absolute", inset: 0 }}>
      {/* Absolutely positioned canvas sized to content */}
      <div
        className="graph-canvas"
        style={{ width: canvasW, height: canvasH, position: "relative" }}
      >
        {/* ---- SVG edge layer -------------------------------------------- */}
        <svg
          className="graph-edges"
          width={canvasW}
          height={canvasH}
          aria-hidden
        >
          <defs>
            {/* Default (inactive) arrowhead marker */}
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={6}
              markerHeight={6}
              orient="auto-start-reverse"
            >
              <path
                d="M0,1 L8,5 L0,9"
                fill="none"
                stroke="var(--edge)"
                strokeWidth={1.5}
              />
            </marker>
            {/* Active (selected) arrowhead marker */}
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={6}
              markerHeight={6}
              orient="auto-start-reverse"
            >
              <path
                d="M0,1 L8,5 L0,9"
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
              />
            </marker>
          </defs>

          {needsEdges.map((edge) => {
            const a = pos[edge.from];
            const b = pos[edge.to];
            // Skip edges where either endpoint is not in layout
            // (can happen when graph and IR are briefly out of sync).
            if (!a || !b) return null;

            // Connect right-center of source to left-center of target.
            const x1 = a.x + a.w;
            const y1 = a.y + a.h / 2;
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            // Midpoint for cubic bezier control points.
            const mx = (x1 + x2) / 2;

            const active = isJobSel(edge.from) || isJobSel(edge.to);

            return (
              <path
                key={edge.id}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                className={`graph-edge${active ? " graph-edge--active" : ""}`}
                markerEnd={active ? "url(#arrow-active)" : "url(#arrow)"}
              />
            );
          })}
        </svg>

        {/* ---- Job nodes ------------------------------------------------- */}
        {graph.jobs.map((node) => {
          const nodePos = pos[node.id];
          if (!nodePos) return null;

          const { job } = node;

          // Run status for this job (idle by default when no run is active).
          const runStatus = runState?.jobs[node.id] ?? null;

          // Diagnostics: prefer the bubbled-up "__job__<id>" key which
          // includes both job-level and step-level diagnostics, then fall back
          // to the job-level path alone.
          const diags =
            diagByPath[`__job__${node.id}`] ??
            diagByPath[`job:${node.id}`] ??
            [];
          const diagCount = diags.length;

          // Worst severity for this job (pre-indexed by engine).
          const worst = jobSeverity[node.id] ?? null;

          // Badge text: "i" for info-only, otherwise the count.
          const badgeText = worst === "info" ? "i" : diagCount;

          // runs-on display: join arrays with ", "; undefined → em dash.
          let runsOnText: string;
          if (job.runsOn === undefined) {
            runsOnText = "—";
          } else if (Array.isArray(job.runsOn)) {
            runsOnText = job.runsOn.join(", ");
          } else {
            runsOnText = job.runsOn;
          }

          // Matrix chip: first dimension length, or total matrix size.
          let matrixN: number | null = null;
          if (job.strategy?.matrix) {
            const dims = job.strategy.matrix.dimensions;
            const firstDim = Object.values(dims)[0];
            if (firstDim !== undefined) {
              matrixN = firstDim.length;
            } else {
              matrixN = job.strategy.matrix.size;
            }
          }

          // Simulate overlay: dim/highlight based on event simulation decision.
          const simDec = simulateResult?.jobs[node.id]?.decision;

          // Node CSS classes.
          const sel = isJobSel(node.id);
          let cls = "jobnode";
          if (sel) cls += " jobnode--sel";
          if (runStatus) cls += ` jobnode--${runStatus}`;
          if (simDec) cls += ` jobnode--sim-${simDec}`;

          // Dot class reflects run status or defaults to "idle".
          const dotCls = `jobnode__dot ${runStatus ?? "idle"}`;

          return (
            <div
              key={node.id}
              className={cls}
              style={{
                position: "absolute",
                left: nodePos.x,
                top: nodePos.y,
                width: nodePos.w,
              }}
              onClick={() => setSelected({ type: "job", id: node.id })}
            >
              {/* Left accent bar — color driven by CSS class (.jobnode--sel,
                  .jobnode--running, .jobnode--passed, .jobnode--failed) */}
              <div className="jobnode__bar" />

              {/* Header: status dot + name + severity badge */}
              <div className="jobnode__head">
                <span className={dotCls} />
                <span className="jobnode__name">{job.name ?? job.id}</span>
                {worst !== null && diagCount > 0 && (
                  <span className={`jobnode__badge sev-${worst}`}>
                    {badgeText}
                  </span>
                )}
              </div>

              {/* Meta row: runs-on, optional matrix chip, optional env chip */}
              <div className="jobnode__meta">
                <span className="mono">{runsOnText}</span>
                {matrixN !== null && (
                  <span className="jobnode__chip">matrix ×{matrixN}</span>
                )}
                {job.environment !== undefined && (
                  <span className="jobnode__chip jobnode__chip--env">
                    {job.environment.name}
                  </span>
                )}
              </div>

              {/* Step dots: up to 6 colored dots + total step count */}
              <div className="jobnode__steps">
                {job.steps.slice(0, 6).map((step, i) => {
                  // Title for accessibility/tooltip.
                  const title =
                    step.name ??
                    (step.kind === "uses"
                      ? step.uses
                      : step.kind === "run"
                        ? step.run.slice(0, 40)
                        : String(step.index));
                  return (
                    <span
                      key={i}
                      className={`stepdot${step.kind === "uses" ? " stepdot--uses" : ""}`}
                      title={title}
                    />
                  );
                })}
                <span className="jobnode__stepn">{job.steps.length} steps</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- Run simulation banner ---------------------------------------- */}
      {runState !== null && (
        <div className="run-banner">
          <span className={`run-banner__dot ${bannerDotClass()}`} />
          <span className="run-banner__mode">{bannerModeLabel()}</span>
          {runState.simulated && (
            <span style={{ color: "var(--text-faint)" }}>(simulated)</span>
          )}
        </div>
      )}
    </div>
  );
}
