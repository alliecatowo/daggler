"use client";

/**
 * /map — Repository Automation Map
 *
 * POST /api/map with { repo } or { demo: true }.
 * Renders RepoAutomationMap: per-workflow cards, totals panel, action-usage table.
 * Uses design tokens from globals.css (site section + posture classes).
 */

import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/icons";
import type {
  RepoAutomationMap,
  WorkflowSummary,
  ActionUsageEntry,
} from "@daggler/inventory";

/* ── Grade pill ──────────────────────────────────────────────────────────── */

function GradePill({ grade }: { grade: string }) {
  const cls = `posture__grade grade-${grade || "F"}`;
  return (
    <span className="posture" style={{ display: "inline-flex" }}>
      <span className={cls}>{grade || "?"}</span>
    </span>
  );
}

/* ── Trigger chip ────────────────────────────────────────────────────────── */

function TriggerChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 99,
        background: "var(--accent-soft)",
        color: "var(--accent-text)",
        border: "1px solid var(--accent-line)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/* ── Trust dot ───────────────────────────────────────────────────────────── */

function TrustDot({ level }: { level: string }) {
  const color =
    level === "high"
      ? "var(--ok)"
      : level === "medium"
        ? "var(--warn)"
        : "var(--danger)";
  return (
    <span
      title={`Trust: ${level}`}
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

/* ── Workflow card ───────────────────────────────────────────────────────── */

function WorkflowCard({ wf }: { wf: WorkflowSummary }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="map-wfcard">
      {/* Card header */}
      <div className="map-wfcard__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="map-wfcard__name">
              {wf.name ?? wf.path.split("/").pop() ?? wf.path}
            </span>
            <GradePill grade={wf.security.grade} />
            {wf.errorCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 99,
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                  fontWeight: 600,
                }}
              >
                {wf.errorCount} error{wf.errorCount !== 1 ? "s" : ""}
              </span>
            )}
            {wf.warningCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 99,
                  background: "var(--warn-soft)",
                  color: "var(--warn)",
                  fontWeight: 600,
                }}
              >
                {wf.warningCount} warn{wf.warningCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="map-wfcard__path mono">{wf.path}</div>
        </div>

        <button
          className="btn btn--ghost btn--sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ flexShrink: 0 }}
        >
          {open ? "−" : "+"} Details
        </button>
      </div>

      {/* Stats row */}
      <div className="map-wfcard__stats">
        <span className="map-stat">
          <span className="map-stat__label">Jobs</span>
          <span className="map-stat__val">{wf.jobCount}</span>
        </span>
        <span className="map-stat">
          <span className="map-stat__label">Steps</span>
          <span className="map-stat__val">{wf.stepCount}</span>
        </span>
        <span className="map-stat">
          <span className="map-stat__label">Unpinned</span>
          <span
            className="map-stat__val"
            style={wf.unpinnedCount > 0 ? { color: "var(--danger)" } : {}}
          >
            {wf.unpinnedCount}
          </span>
        </span>
        <span className="map-stat">
          <span className="map-stat__label">Complexity</span>
          <span className="map-stat__val">{wf.complexity}</span>
        </span>
        {wf.secretsReferenced.length > 0 && (
          <span className="map-stat">
            <span className="map-stat__label">Secrets</span>
            <span className="map-stat__val">{wf.secretsReferenced.length}</span>
          </span>
        )}
      </div>

      {/* Trigger chips */}
      {wf.triggers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
          {wf.triggers.map((t) => (
            <TriggerChip key={t} label={t} />
          ))}
          {wf.schedules.map((cron) => (
            <TriggerChip key={cron} label={`schedule: ${cron}`} />
          ))}
        </div>
      )}

      {/* Expanded details */}
      {open && (
        <div className="map-wfcard__detail">
          {/* Third-party actions */}
          {wf.thirdPartyActions.length > 0 && (
            <div className="map-wfcard__section">
              <div className="map-section-label">Third-party actions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {wf.thirdPartyActions.map((a) => (
                  <div key={a.uses} className="map-action-row">
                    <TrustDot level={a.trust} />
                    <span className="map-action-row__uses mono">{a.uses}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "var(--bg-3)",
                        color: "var(--text-lo)",
                      }}
                    >
                      {a.trust}
                    </span>
                    {(a.refKind === "tag" || a.refKind === "branch") && (
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: "var(--danger-soft)",
                          color: "var(--danger)",
                          fontWeight: 600,
                        }}
                      >
                        unpinned
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Secrets */}
          {wf.secretsReferenced.length > 0 && (
            <div className="map-wfcard__section">
              <div className="map-section-label">Secrets referenced</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {wf.secretsReferenced.map((s) => (
                  <span
                    key={s}
                    className="mono"
                    style={{
                      fontSize: 11.5,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "var(--bg-2)",
                      color: "var(--text-mid)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Security score */}
          <div className="map-wfcard__section" style={{ marginBottom: 0 }}>
            <div className="map-section-label">Security</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <GradePill grade={wf.security.grade} />
              <span style={{ fontSize: 12, color: "var(--text-mid)" }}>
                score {wf.security.score}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Totals panel ────────────────────────────────────────────────────────── */

function TotalsPanel({ totals }: { totals: RepoAutomationMap["totals"] }) {
  return (
    <div className="map-totals">
      <div className="map-totals__title">Summary</div>
      <div className="map-totals__grid">
        <StatCell label="Workflows" value={totals.workflows} />
        <StatCell label="Jobs" value={totals.jobs} />
        <StatCell label="Unique actions" value={totals.uniqueActions} />
        <StatCell
          label="Unpinned"
          value={totals.unpinnedActions}
          highlight={totals.unpinnedActions > 0 ? "danger" : undefined}
        />
        <StatCell label="Worst grade" value={totals.worstGrade || "—"} grade={totals.worstGrade} />
        <StatCell label="Best grade" value={totals.bestGrade || "—"} grade={totals.bestGrade} />
        <StatCell label="CI complexity" value={totals.ciComplexity} />
        <StatCell
          label="Errors"
          value={totals.errors}
          highlight={totals.errors > 0 ? "danger" : undefined}
        />
        <StatCell
          label="Warnings"
          value={totals.warnings}
          highlight={totals.warnings > 0 ? "warn" : undefined}
        />
        <StatCell label="Secrets used" value={totals.secretsUsed.length} />
      </div>

      {totals.secretsUsed.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--text-faint)",
              marginBottom: 7,
            }}
          >
            Secrets across repo
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {totals.secretsUsed.map((s) => (
              <span
                key={s}
                className="mono"
                style={{
                  fontSize: 11,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "var(--bg-2)",
                  color: "var(--text-mid)",
                  border: "1px solid var(--border)",
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  highlight,
  grade,
}: {
  label: string;
  value: string | number;
  highlight?: "danger" | "warn";
  grade?: string;
}) {
  const color = highlight === "danger"
    ? "var(--danger)"
    : highlight === "warn"
      ? "var(--warn)"
      : "var(--text-hi)";

  return (
    <div className="map-statcell">
      <div className="map-statcell__label">{label}</div>
      <div className="map-statcell__value" style={{ color }}>
        {grade ? (
          <span
            className={`posture__grade grade-${grade || "F"}`}
            style={{ display: "inline-grid", marginRight: 4 }}
          >
            {grade}
          </span>
        ) : null}
        {!grade && value}
      </div>
    </div>
  );
}

/* ── Action usage table ──────────────────────────────────────────────────── */

function ActionUsageTable({ actions }: { actions: ActionUsageEntry[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="map-table-wrap">
      <div className="map-section-title">Action usage across repo</div>
      <table className="map-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Count</th>
            <th>Trust</th>
            <th>Pinned</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.uses}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <TrustDot level={a.trust} />
                  <span className="mono" style={{ fontSize: 12 }}>
                    {a.uses}
                  </span>
                  {a.official && (
                    <span
                      style={{
                        fontSize: 9.5,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "var(--ok-soft)",
                        color: "var(--ok)",
                        fontWeight: 600,
                      }}
                    >
                      official
                    </span>
                  )}
                </div>
              </td>
              <td style={{ textAlign: "center" }}>{a.count}</td>
              <td>
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: "var(--bg-3)",
                    color: "var(--text-lo)",
                  }}
                >
                  {a.trust}
                </span>
              </td>
              <td>
                {a.pinned ? (
                  <span style={{ color: "var(--ok)", fontSize: 12 }}>✓ SHA</span>
                ) : (
                  <span style={{ color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>
                    ✗ unpinned
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Error/empty state ───────────────────────────────────────────────────── */

function AlertBox({
  title,
  message,
  kind = "error",
}: {
  title: string;
  message: string;
  kind?: "error" | "warn" | "info";
}) {
  const bg =
    kind === "error"
      ? "var(--danger-soft)"
      : kind === "warn"
        ? "var(--warn-soft)"
        : "var(--accent-soft)";
  const border =
    kind === "error"
      ? "var(--danger)"
      : kind === "warn"
        ? "var(--warn)"
        : "var(--accent-line)";
  const color =
    kind === "error"
      ? "var(--danger)"
      : kind === "warn"
        ? "var(--warn)"
        : "var(--accent-text)";

  return (
    <div
      style={{
        padding: "14px 18px",
        borderRadius: 8,
        background: bg,
        border: `1px solid ${border}`,
        marginBottom: 24,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-mid)", lineHeight: 1.5 }}>{message}</div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

type ApiResult =
  | ({ error: string; message: string })
  | RepoAutomationMap;

function isError(r: ApiResult): r is { error: string; message: string } {
  return "error" in r;
}

export default function MapPage() {
  const [repoInput, setRepoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [lastRepo, setLastRepo] = useState<string>("demo");

  async function fetchMap(repo?: string) {
    setLoading(true);
    setResult(null);
    const body = repo ? { repo } : { demo: true };
    if (repo) setLastRepo(repo);
    else setLastRepo("demo corpus");

    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiResult;
      setResult(data);
    } catch (err) {
      setResult({
        error: "network",
        message: err instanceof Error ? err.message : "Failed to reach /api/map",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = repoInput.trim();
    if (v) void fetchMap(v);
  }

  const map = result && !isError(result) ? (result as RepoAutomationMap) : null;
  const errorResult = result && isError(result) ? result : null;

  return (
    <body className="site">
      {/* ── Nav ── */}
      <header className="nav">
        <div className="wrap nav__inner">
          <Link className="brand" href="/">
            <span className="brand__logo">
              <LogoMark size={22} />
            </span>
            <span className="brand__word">
              <b>DAG</b>gler
            </span>
          </Link>

          <nav className="nav__links" aria-label="Site navigation">
            <Link className="nav__link" href="/#product">Product</Link>
            <Link className="nav__link" href="/#security">Security</Link>
            <Link className="nav__link" href="/map" style={{ color: "var(--accent-text)" }}>
              Automation map
            </Link>
          </nav>

          <div className="nav__right">
            <Link className="btn btn--primary btn--sm" href="/editor">
              Open the editor
            </Link>
          </div>
        </div>
      </header>

      {/* ── Page header ── */}
      <div
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-1)",
          padding: "32px 0 28px",
        }}
      >
        <div className="wrap">
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--accent-text)",
              marginBottom: 8,
            }}
          >
            Repository intelligence
          </div>
          <h1
            style={{
              margin: "0 0 10px",
              fontSize: "clamp(26px, 3.5vw, 38px)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--text-hi)",
              lineHeight: 1.1,
            }}
          >
            Automation map
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              color: "var(--text-mid)",
              maxWidth: 540,
              lineHeight: 1.55,
            }}
          >
            Scan any public GitHub repository and visualize its entire CI surface — workflows,
            triggers, third-party actions, security grades, and secrets at a glance.
          </p>
        </div>
      </div>

      {/* ── Input form ── */}
      <div style={{ background: "var(--bg-0)", borderBottom: "1px solid var(--border)" }}>
        <div className="wrap" style={{ padding: "20px 28px" }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex",
                flex: 1,
                minWidth: 240,
                maxWidth: 420,
                alignItems: "center",
                gap: 8,
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0 10px",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
                owner/repo
              </span>
              <input
                type="text"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="e.g. vercel/next.js"
                disabled={loading}
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: "var(--text-hi)",
                  font: "inherit",
                  fontSize: 13.5,
                  padding: "9px 0",
                }}
              />
            </div>

            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || !repoInput.trim()}
            >
              {loading ? "Mapping…" : "Map repository"}
            </button>

            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={() => void fetchMap()}
            >
              Try the demo corpus
            </button>
          </form>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="wrap" style={{ padding: "32px 28px 80px" }}>
        {/* Loading */}
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "28px 0",
              color: "var(--text-faint)",
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--accent)",
                animation: "pulse 1s infinite",
                display: "inline-block",
              }}
            />
            Fetching workflow files and building automation map…
          </div>
        )}

        {/* API error */}
        {!loading && errorResult && (
          <AlertBox
            kind={
              errorResult.error === "gh unavailable"
                ? "warn"
                : errorResult.error === "network"
                  ? "error"
                  : "error"
            }
            title={
              errorResult.error === "gh unavailable"
                ? "GitHub CLI not available"
                : errorResult.error === "invalid_repo"
                  ? "Invalid repository"
                  : "Error"
            }
            message={errorResult.message}
          />
        )}

        {/* Map result */}
        {!loading && map && (
          <>
            {/* Source label */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 24,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-faint)",
                  fontFamily: "var(--mono)",
                }}
              >
                {lastRepo}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-faint)",
                  padding: "1px 7px",
                  borderRadius: 99,
                  border: "1px solid var(--border)",
                }}
              >
                {map.totals.workflows} workflow{map.totals.workflows !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Empty repo */}
            {map.totals.workflows === 0 ? (
              <div
                style={{
                  padding: "48px 0",
                  textAlign: "center",
                  color: "var(--text-faint)",
                  fontSize: 14,
                }}
              >
                No workflow files found in this repository.
              </div>
            ) : (
              <div className="map-layout">
                {/* Left column: workflow cards */}
                <div className="map-main">
                  <div className="map-section-title" style={{ marginBottom: 14 }}>
                    Workflows
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {map.workflows.map((wf) => (
                      <WorkflowCard key={wf.path} wf={wf} />
                    ))}
                  </div>

                  {/* Action usage table */}
                  {map.actionUsage.length > 0 && (
                    <ActionUsageTable actions={map.actionUsage} />
                  )}
                </div>

                {/* Right column: totals */}
                <div className="map-aside">
                  <TotalsPanel totals={map.totals} />
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty state before any fetch */}
        {!loading && !result && (
          <div
            style={{
              padding: "60px 0",
              textAlign: "center",
              color: "var(--text-faint)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 28,
                color: "var(--border-strong)",
                marginBottom: 12,
              }}
            >
              map
            </div>
            <div style={{ fontSize: 14, color: "var(--text-mid)", marginBottom: 8 }}>
              Enter a repo or try the demo corpus.
            </div>
            <div style={{ fontSize: 12.5, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
              The demo corpus uses the built-in sample workflows. To scan a real repo, the{" "}
              <code
                style={{
                  fontFamily: "var(--mono)",
                  background: "var(--bg-2)",
                  padding: "1px 5px",
                  borderRadius: 3,
                }}
              >
                gh
              </code>{" "}
              CLI must be installed and authenticated.
            </div>
          </div>
        )}
      </div>
    </body>
  );
}
