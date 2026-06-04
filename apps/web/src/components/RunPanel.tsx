"use client";

/* ============================================================================
 * RunPanel — shows the result of the last /api/run call (lastRun) and the
 * most-recent event simulation (simulateResult) in the bottom panel's "Run"
 * tab.  Styled with existing design tokens; no new CSS classes required beyond
 * a few additions to globals.css.
 * ============================================================================ */

import type { ReactNode } from "react";
import { useEditor } from "../lib/store";

export function RunPanel(): ReactNode {
  const { lastRun, simulateResult, runViaApi, runEventSimulate, runMode } =
    useEditor();

  const isEmpty = !lastRun && !simulateResult;

  return (
    <div className="run-panel scroll">
      {isEmpty && (
        <div className="run-panel__empty">
          No run output yet — click a confidence ladder rung or use ⌘K &gt;
          &quot;Simulate event&quot;.
        </div>
      )}

      {/* ---- Last API run result ----------------------------------------- */}
      {lastRun && (
        <section className="run-panel__section">
          <div className="run-panel__sec-head">
            <span
              className={`run-panel__status-dot run-panel__status-dot--${lastRun.status}`}
              aria-hidden
            />
            <span className="run-panel__sec-title mono">
              {lastRun.mode} run
            </span>
            <span className="run-panel__sec-badge mono">{lastRun.status}</span>
            <button
              className="run-panel__re-run btn btn--sm"
              onClick={() => runViaApi(runMode === "static" ? "local" : runMode)}
              title="Re-run"
            >
              ▷ Re-run
            </button>
          </div>
          <div className="run-panel__summary">{lastRun.summary}</div>
          {lastRun.logs.length > 0 && (
            <div className="run-panel__logs mono">
              {lastRun.logs.map((line, i) => (
                <div
                  key={i}
                  className={`run-panel__log-line run-panel__log-line--${line.level}`}
                >
                  <span className="run-panel__log-lvl">{line.level}</span>
                  {line.message}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---- Event simulation result -------------------------------------- */}
      {simulateResult && (
        <section className="run-panel__section">
          <div className="run-panel__sec-head">
            <span
              className={`run-panel__status-dot run-panel__status-dot--${simulateResult.triggered ? "passed" : "skip"}`}
              aria-hidden
            />
            <span className="run-panel__sec-title mono">
              simulate pull_request@main
            </span>
            <span className="run-panel__sec-badge mono">
              {simulateResult.triggered ? "triggered" : "not triggered"}
            </span>
            <button
              className="run-panel__re-run btn btn--sm"
              onClick={runEventSimulate}
              title="Re-simulate"
            >
              ⚡ Re-simulate
            </button>
          </div>
          <div className="run-panel__summary">{simulateResult.triggerReason}</div>
          <div className="run-panel__sim-jobs">
            {Object.entries(simulateResult.jobs).map(([jobId, dec]) => (
              <div
                key={jobId}
                className={`run-panel__sim-row run-panel__sim-row--${dec.decision}`}
                title={dec.reason}
              >
                <span className="run-panel__sim-icon" aria-hidden>
                  {dec.decision === "run"
                    ? "▷"
                    : dec.decision === "skip"
                      ? "—"
                      : "?"}
                </span>
                <span className="run-panel__sim-job mono">{jobId}</span>
                <span className="run-panel__sim-reason">{dec.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
