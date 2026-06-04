"use client";

/*
 * Daggler marketing landing page.
 *
 * Faithfully ported from /home/Allie/develop/daggler/.design/Daggler Landing.html.
 * Uses only CSS classes already defined in globals.css (site section).
 * Standalone — does not depend on the editor store.
 *
 * Theme toggle: reads/writes localStorage "daggler-theme" and flips
 * document.documentElement's data-theme attribute, matching the editor store
 * convention so theme is shared across pages.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/icons";

/* ============================================================
   Inline SVG icons only used on this page
   ============================================================ */

function GitHubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/* Sun/moon icons for theme toggle */
function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Icons for feature cards */
function FlowCardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="7" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="9" width="7" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="15" width="7" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5h2.5M14 11.5h-2.5M10 17.5h2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12l4 4 10-10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ValidateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 4v2m0 10v2M4 11h2m10 0h2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ShieldCardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 5v14l11-7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function CubeCardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7l8-4 8 4v10l-8 4-8-4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M4 7l8 4 8-4M12 11v10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12m0 0l-4-4m4 4l4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ============================================================
   Feature cards data
   ============================================================ */

const FEATURE_CARDS = [
  {
    icon: <FlowCardIcon />,
    title: "Understand",
    body: "See every trigger, job dependency, matrix expansion, and the third-party actions you depend on — laid out as an interactive graph.",
  },
  {
    icon: <PencilIcon />,
    title: "Author",
    body: "Edit jobs and steps through typed inspectors. Every visual change round-trips to a precise YAML patch — never a regenerated file.",
  },
  {
    icon: <ValidateIcon />,
    title: "Validate",
    body: "Five layers: schema, expression contexts, graph semantics, action metadata, and policy. Diagnostics map to exact YAML lines and graph nodes.",
  },
  {
    icon: <ShieldCardIcon />,
    title: "Secure",
    body: "Catch unpinned actions, over-broad permissions, untrusted-input injection, and missing environment gates — before they merge.",
  },
  {
    icon: <PlayIcon />,
    title: "Simulate",
    body: "Pick an event — a PR from a fork, a tag push — and see exactly which jobs run, which skip, and which secrets become reachable.",
  },
  {
    icon: <CubeCardIcon />,
    title: "Prove",
    body: "Dispatch a real run on a temporary branch or self-hosted runner. Logs stream back and map directly to your graph nodes.",
  },
  {
    icon: <ExportIcon />,
    title: "Export",
    body: "Ship clean native YAML by copy, commit, or a PR with a graph diff and security summary. No proprietary format, ever.",
  },
] as const;

/* ============================================================
   Policy demo rows
   ============================================================ */

const POLICY_ROWS = [
  {
    sev: "error" as const,
    code: "POL002",
    text: "Third-party action not SHA-pinned",
    fix: "Pin to SHA",
  },
  {
    sev: "error" as const,
    code: "POL003",
    text: "pull_request_target with write token",
    fix: "Restrict scope",
  },
  {
    sev: "warning" as const,
    code: "AGENT001",
    text: "Untrusted input flows into an AI agent",
    fix: "Harden",
  },
  {
    sev: "warning" as const,
    code: "POL009",
    text: "id-token: write without OIDC step",
    fix: "Remove scope",
  },
] as const;

/* ============================================================
   Page component
   ============================================================ */

export default function LandingPage() {
  /*
   * Theme state: initialised from localStorage on mount to avoid flicker.
   * The <html> data-theme is set by layout.tsx initially; this component
   * syncs on top of that after hydration.
   */
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("daggler-theme") as "dark" | "light" | null;
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("daggler-theme", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <body className="site">
      {/* ================================================================
          NAV
          ================================================================ */}
      <header className="nav">
        <div className="wrap nav__inner">
          {/* Brand */}
          <a className="brand" href="/">
            <span className="brand__logo">
              <LogoMark size={22} />
            </span>
            <span className="brand__word">
              <b>DAG</b>gler
            </span>
          </a>

          {/* Centre links */}
          <nav className="nav__links" aria-label="Site navigation">
            <a className="nav__link" href="#product">Product</a>
            <a className="nav__link" href="#security">Security</a>
            <a className="nav__link" href="#selfhost">Self-host</a>
            <a className="nav__link" href="#">Docs</a>
            <a className="nav__link" href="#">Pricing</a>
            <Link className="nav__link" href="/map">Automation map</Link>
          </nav>

          {/* Right cluster */}
          <div className="nav__right">
            <a
              className="nav__gh"
              href="https://github.com/alliecatowo/daggler"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon />
              Star
              <span className="nav__star">2.4k</span>
            </a>

            {/* Theme toggle — persists to localStorage */}
            <button
              className="btn btn--ghost btn--sm"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>

            <Link className="btn btn--primary btn--sm" href="/editor">
              Open the editor
            </Link>
          </div>
        </div>
      </header>

      {/* ================================================================
          HERO
          ================================================================ */}
      <section className="hero">
        {/* Grid overlay */}
        <div className="hero__grid" aria-hidden />

        <div className="wrap hero__inner">
          {/* Eyebrow badge */}
          <div className="hero__eyebrow">
            <b>v0.1</b>
            Self-hostable · Native GitHub Actions YAML
          </div>

          {/* Headline */}
          <h1>
            The semantic workbench for{" "}
            <em>GitHub Actions</em>
          </h1>

          {/* Sub-copy */}
          <p className="hero__sub">
            Open any repo and understand its automation in seconds. Daggler visualizes, validates,
            secures, and simulates your workflows — then ships clean native YAML. No lock-in, no
            proprietary runner.
          </p>

          {/* CTA row */}
          <div className="hero__cta">
            <Link className="btn btn--primary btn--lg" href="/editor">
              Open the editor →
            </Link>
            <a
              className="btn btn--lg"
              href="https://github.com/alliecatowo/daggler"
              target="_blank"
              rel="noopener noreferrer"
            >
              Star on GitHub
            </a>
          </div>

          {/* Fine print */}
          <div className="hero__note">npx daggler bridge · MIT licensed core</div>
        </div>

        {/* ---- Product shot ---- */}
        <div className="wrap shot">
          <div className="shot__glow" aria-hidden />
          <div className="shot__frame">
            {/* Faux browser bar */}
            <div className="shot__bar">
              <div className="shot__dots" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <span className="shot__url">daggler.dev/app/acme/web-platform/workflows/ci.yml</span>
            </div>

            {/*
             * Editor screenshot. Place the real screenshot at
             * /public/editor-shot.png — until then the SVG diagram below
             * serves as a fallback.
             */}
            <div className="higraph" style={{ position: "relative", width: "100%", aspectRatio: "16 / 8.6", background: "var(--bg-0)" }}>
              <svg
                viewBox="0 0 1080 580"
                preserveAspectRatio="xMidYMid meet"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                aria-hidden
              >
                {/* Edges */}
                <path className="hg-edge--a" d="M214,150 C260,150 260,290 306,290" />
                <path className="hg-edge--a" d="M214,150 C290,150 290,150 306,150" />
                <path className="hg-edge" d="M510,150 C556,150 556,230 602,230" />
                <path className="hg-edge" d="M510,290 C556,290 556,250 602,250" />
                <path className="hg-edge" d="M806,240 C840,240 840,400 700,400" />

                {/* Lint & typecheck node */}
                <g>
                  <rect className="hg-node" x="40" y="110" width="174" height="80" rx="12" />
                  <rect className="hg-bar--ok" x="40" y="110" width="3" height="80" />
                  <circle className="hg-dot--ok" cx="62" cy="136" r="4" />
                  <text className="hg-label" x="76" y="140">Lint & typecheck</text>
                  <text className="hg-meta" x="60" y="166">ubuntu-latest · 4 steps</text>
                </g>

                {/* Test node */}
                <g>
                  <rect className="hg-node" x="306" y="110" width="204" height="80" rx="12" />
                  <rect className="hg-bar--ok" x="306" y="110" width="3" height="80" />
                  <circle className="hg-dot--ok" cx="328" cy="136" r="4" />
                  <text className="hg-label" x="342" y="140">Test</text>
                  <text className="hg-meta" x="326" y="166">matrix ×3 · node 18/20/22</text>
                </g>

                {/* Build & package node (selected) */}
                <g>
                  <rect className="hg-node hg-node--sel" x="306" y="250" width="204" height="80" rx="12" />
                  <rect className="hg-bar" x="306" y="250" width="3" height="80" />
                  <circle className="hg-dot--run" cx="328" cy="276" r="4" />
                  <text className="hg-label" x="342" y="280">Build & package</text>
                  <text className="hg-meta" x="326" y="306">ubuntu-latest · 5 steps</text>
                  <circle className="hg-badge" cx="490" cy="266" r="9" />
                  <text x="490" y="270" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">1</text>
                </g>

                {/* Deploy production node */}
                <g>
                  <rect className="hg-node" x="602" y="200" width="204" height="80" rx="12" />
                  <rect className="hg-bar" x="602" y="200" width="3" height="80" />
                  <circle className="hg-dot" cx="624" cy="226" r="4" />
                  <text className="hg-label" x="638" y="230">Deploy production</text>
                  <text className="hg-meta" x="622" y="256">environment: production</text>
                  <circle className="hg-badge" cx="786" cy="216" r="9" />
                  <text x="786" y="220" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">1</text>
                </g>

                {/* YAML mini panel */}
                <g>
                  <rect className="hg-yaml" x="602" y="360" width="438" height="180" rx="12" />
                  <rect className="hg-hl" x="602" y="392" width="438" height="20" />
                  <text className="hg-yt" x="624" y="386">
                    <tspan className="hg-yk">jobs:</tspan>
                  </text>
                  <text className="hg-yt" x="642" y="406">
                    <tspan className="hg-yk">build:</tspan>
                  </text>
                  <text className="hg-yt" x="660" y="426">runs-on: ubuntu-latest</text>
                  <text className="hg-yt" x="660" y="446">
                    <tspan className="hg-yk">needs:</tspan> [lint, test]
                  </text>
                  <text className="hg-yt" x="660" y="466">
                    <tspan className="hg-yk">steps:</tspan>
                  </text>
                  <text className="hg-yt" x="678" y="486">
                    - uses: docker/build-push-action
                    <tspan className="hg-ye">@v5</tspan>
                  </text>
                  <text className="hg-ye" x="678" y="510">⚠ POL002 · pin to a commit SHA</text>
                </g>
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          TRUST STRIP
          ================================================================ */}
      <div className="wrap trust">
        <div className="trust__label">Reads the workflows you already have</div>
        <div className="trust__row" aria-label="Ecosystems supported">
          <span>Vercel</span>
          <span>Neon</span>
          <span>Drizzle</span>
          <span>actionlint</span>
          <span>Octokit</span>
          <span>act</span>
        </div>
      </div>

      {/* ================================================================
          PRODUCT / FEATURE CARDS
          ================================================================ */}
      <section className="section" id="product">
        <div className="wrap">
          <div className="section__head center">
            <div className="section__tag">The model, not the YAML</div>
            <h2>GitHub Actions is already a DAG. Daggler shows you the real thing.</h2>
            <p className="section__lead">
              Events flow to workflows, jobs, and steps; permissions, secrets, and artifacts flow
              between them. Daggler treats that graph as the source of truth — and rewrites it back
              to clean native YAML.
            </p>
          </div>

          <div className="fcards">
            {FEATURE_CARDS.map((card) => (
              <div key={card.title} className="fcard">
                <div className="fcard__icon">{card.icon}</div>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================
          CONFIDENCE LADDER
          ================================================================ */}
      <section className="section band" id="confidence">
        <div className="wrap ladder-feat">
          {/* Left: copy */}
          <div>
            <div className="section__tag">Execution is a ladder, not a platform</div>
            <h2>Three rungs of confidence. One honest model.</h2>
            <p className="section__lead">
              Most tools bury you in runner modes. Daggler exposes exactly three levels — and the
              cost, speed, and authority of each is always clear. Static checks need no Docker.
              Local approximation runs through a bridge. GitHub runs are the real thing.
            </p>
          </div>

          {/* Right: rungs */}
          <div className="rungs">
            {/* Rung 1 — accent (instant) */}
            <div className="rung rung--accent">
              <div className="rung__n">1</div>
              <div className="rung__body">
                <h4>Static analysis</h4>
                <p>
                  Instant, deterministic. Parse, validate contexts, expand matrices, run policy and
                  security rules — entirely in the browser and worker.
                </p>
              </div>
              <span className="rung__tag">instant</span>
            </div>

            {/* Rung 2 — local */}
            <div className="rung">
              <div className="rung__n">2</div>
              <div className="rung__body">
                <h4>Local approximation</h4>
                <p>
                  Pair a local bridge with <span className="mono">npx daggler bridge</span> to run
                  actionlint and <span className="mono">act</span> against a real checkout. Useful,
                  not authoritative.
                </p>
              </div>
              <span className="rung__tag">~seconds</span>
            </div>

            {/* Rung 3 — GitHub */}
            <div className="rung">
              <div className="rung__n">3</div>
              <div className="rung__body">
                <h4>Prove on GitHub</h4>
                <p>
                  Dispatch a real run on a temporary branch or self-hosted runner. Logs stream back
                  and map directly to your graph nodes.
                </p>
              </div>
              <span className="rung__tag">authoritative</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECURITY
          ================================================================ */}
      <section className="section" id="security">
        <div className="wrap split split--rev">
          {/* Left: policy demo terminal */}
          <div className="split__media">
            <div className="codewell">
              <div className="codewell__bar">
                <div className="shot__dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
                <span className="mono">policy · diagnostics</span>
              </div>
              <div className="codewell__body">
                <span className="cl">
                  <span className="c"># jobs.deploy.steps[1]</span>
                </span>

                {POLICY_ROWS.map((row) => (
                  <span key={row.code} className="cl" style={{ marginBottom: 4, display: "block" }}>
                    <span className="polrow__sev" style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: row.sev === "error" ? "var(--danger)" : "var(--warn)",
                      verticalAlign: "middle",
                      marginRight: 8,
                    }} aria-hidden />
                    <span className={row.sev === "error" ? "bad" : "e"}>
                      {row.sev === "error" ? "✗" : "⚠"} {row.code}
                    </span>
                    {"  "}{row.text}
                    {"  "}
                    <span className="ok">→ {row.fix}</span>
                  </span>
                ))}

                <span className="cl"> </span>
                <span className="cl">
                  <span className="c">
                    # {POLICY_ROWS.filter((r) => r.sev === "error").length} errors ·{" "}
                    {POLICY_ROWS.filter((r) => r.sev === "warning").length} warnings
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Right: copy */}
          <div>
            <div className="section__tag">Security as a first-class graph</div>
            <h2>See what has permission to write, and where secrets flow.</h2>
            <p className="section__lead">
              Daggler ships policy packs for least-privilege, release hardening, and a current one:{" "}
              <strong>AI agent workflow safety</strong> — catching untrusted issue and PR content
              flowing into prompts and scripts.
            </p>

            <div className="flist">
              <div className="fitem">
                <span className="fitem__check">✓</span>
                <div className="fitem__body">
                  <h4>Permission & secret flow graph</h4>
                  <p>
                    Trace every <span className="mono">write</span> scope and every secret from its
                    source to the steps that can read it.
                  </p>
                </div>
              </div>

              <div className="fitem">
                <span className="fitem__check">✓</span>
                <div className="fitem__body">
                  <h4>Action trust scoring</h4>
                  <p>
                    Verified owner, release age, SHA-pinning, and known advisories — surfaced inline
                    as you insert an action.
                  </p>
                </div>
              </div>

              <div className="fitem">
                <span className="fitem__check">✓</span>
                <div className="fitem__body">
                  <h4>Advisory or blocking</h4>
                  <p>
                    Run packs as guidance, or enforce them on PRs with Check annotations that block
                    the merge.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SELF-HOST
          ================================================================ */}
      <section className="section band selfhost" id="selfhost">
        <div className="wrap">
          <div className="section__head center">
            <div className="section__tag">No lock-in</div>
            <h2>Run it yourself. Same image, your infrastructure.</h2>
            <p className="section__lead">
              Daggler is a modular monolith — web, worker, Postgres, and an optional bridge. No
              Redis, no Kubernetes, no proprietary backend. Bring your own GitHub App.
            </p>
          </div>

          {/* docker compose codewell */}
          <div className="codewell" style={{ maxWidth: 580, margin: "32px auto 0", textAlign: "left" }}>
            <div className="codewell__bar">
              <div className="shot__dots" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <span className="mono">~/daggler — docker compose</span>
            </div>
            <div className="codewell__body">
              <span className="cl">
                <span className="c"># clone and bring up the full stack</span>
              </span>
              <span className="cl">
                <span className="ok">$</span> git clone https://github.com/alliecatowo/daggler
              </span>
              <span className="cl">
                <span className="ok">$</span> cp .env.example .env{" "}
                <span className="c"># add GitHub App creds + DAGGLER_SECRET_KEY</span>
              </span>
              <span className="cl">
                <span className="ok">$</span> docker compose up -d
              </span>
              <span className="cl"> </span>
              <span className="cl">
                <span className="k">web</span>{"      "}ready  →  http://localhost:3000
              </span>
              <span className="cl">
                <span className="k">worker</span>{"   "}ready  →  graphile-worker · 4 jobs
              </span>
              <span className="cl">
                <span className="k">postgres</span>{" "}ready  →  neon-compatible schema
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          CTA BAND
          ================================================================ */}
      <section className="cta">
        <div className="wrap">
          <h2>Untangle your workflows.</h2>
          <p className="cta__sub">
            Connect a repo and Daggler maps your entire CI surface in under a minute.
          </p>
          <div className="hero__cta">
            <Link className="btn btn--primary btn--lg" href="/editor">
              Open the editor →
            </Link>
            <a
              className="btn btn--lg"
              href="https://github.com/alliecatowo/daggler"
              target="_blank"
              rel="noopener noreferrer"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ================================================================
          FOOTER
          ================================================================ */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer__top">
            {/* Brand + tagline */}
            <div style={{ maxWidth: 280 }}>
              <a className="brand" href="/" style={{ marginBottom: 14, display: "inline-flex" }}>
                <span className="brand__logo">
                  <LogoMark size={22} />
                </span>
                <span className="brand__word">
                  <b>DAG</b>gler
                </span>
              </a>
              <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.5, margin: "10px 0 0" }}>
                A semantic workbench for GitHub Actions. Native YAML, no lock-in, self-hostable.
              </p>
            </div>

            {/* Link columns */}
            <div className="footer__cols">
              <div className="footer__col">
                <h5>Product</h5>
                <Link href="/editor">Editor</Link>
                <a href="#product">Features</a>
                <a href="#confidence">Confidence ladder</a>
                <a href="#security">Security</a>
              </div>
              <div className="footer__col">
                <h5>Resources</h5>
                <a href="#">Docs</a>
                <a href="#selfhost">Self-host</a>
                <a href="#">Bridge CLI</a>
                <a href="#">Changelog</a>
              </div>
              <div className="footer__col">
                <h5>Company</h5>
                <a
                  href="https://github.com/alliecatowo/daggler"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
                <a href="#">License (MIT)</a>
                <a href="#">Discussions</a>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="footer__bottom">
            <span className="mono">Daggler · MIT-licensed · Self-hostable</span>
            <span>© 2026 Daggler. Not affiliated with GitHub.</span>
          </div>
        </div>
      </footer>

      {/*
       * Inline styles needed only for the hero SVG graph classes that live
       * in the <style> block of the original HTML mock. These are scoped
       * tightly to the landing page and do not conflict with editor styles.
       */}
      <style>{`
        .higraph svg { position: absolute; inset: 0; width: 100%; height: 100%; }
        .hg-node { fill: var(--bg-1); stroke: var(--border); stroke-width: 1; }
        .hg-node--sel { stroke: var(--accent-line); stroke-width: 1.5; }
        .hg-bar { fill: var(--accent); }
        .hg-bar--ok { fill: var(--ok); }
        .hg-edge { stroke: var(--edge, var(--border-strong)); stroke-width: 1.5; fill: none; }
        .hg-edge--a { stroke: var(--accent); stroke-width: 2; fill: none; }
        .hg-label { fill: var(--text-hi); font: 600 12px "Geist", sans-serif; }
        .hg-meta { fill: var(--text-faint); font: 10px "Geist Mono", monospace; }
        .hg-dot { fill: var(--text-faint); }
        .hg-dot--ok { fill: var(--ok); }
        .hg-dot--run { fill: var(--accent); }
        .hg-badge { fill: var(--danger); }
        .hg-yaml { fill: var(--bg-inset); stroke: var(--border); }
        .hg-yt { fill: var(--text-lo); font: 10.5px "Geist Mono", monospace; }
        .hg-yk { fill: var(--accent-text); font: 10.5px "Geist Mono", monospace; }
        .hg-ye { fill: var(--warn); font: 10.5px "Geist Mono", monospace; }
        .hg-hl { fill: var(--accent-soft); }
      `}</style>
    </body>
  );
}
