<script setup lang="ts">
import { computed, ref } from "vue";
import { withBase } from "vitepress";
import lintOut from "./data/release-lint.txt?raw";
import workflowSrc from "./data/release.yml?raw";

/* ---- the drawing: jobs of the example release.yml, edges from `needs` ---- */
type Job = {
  id: string;
  needs: string[];
  d: { x: number; y: number };
  m: { x: number; y: number };
};
const JOBS: Job[] = [
  { id: "lint", needs: [], d: { x: 24, y: 104 }, m: { x: 14, y: 82 } },
  { id: "test", needs: [], d: { x: 24, y: 224 }, m: { x: 176, y: 82 } },
  { id: "build", needs: ["lint", "test"], d: { x: 244, y: 164 }, m: { x: 95, y: 202 } },
  { id: "e2e", needs: ["build"], d: { x: 464, y: 104 }, m: { x: 14, y: 322 } },
  { id: "docs", needs: ["build"], d: { x: 464, y: 224 }, m: { x: 176, y: 322 } },
  { id: "publish", needs: ["e2e", "docs"], d: { x: 684, y: 164 }, m: { x: 95, y: 442 } },
  { id: "deploy", needs: ["publish"], d: { x: 904, y: 164 }, m: { x: 95, y: 562 } },
];

/* ---- findings: copied from `daggler lint` on that file ---- */
type Finding = {
  n: number;
  code: string;
  sev: "error" | "warning";
  at: string; // job id or "workflow"
  loc: string;
  title: string;
};
const FINDINGS: Finding[] = [
  { n: 1, code: "POL007", sev: "error", at: "lint", loc: "12:9", title: "Action ref uses a branch" },
  { n: 2, code: "POL008", sev: "error", at: "test", loc: "19:9", title: "Shell injection from untrusted input" },
  { n: 3, code: "POL002", sev: "error", at: "build", loc: "27:9", title: "Third-party action not SHA-pinned" },
  { n: 4, code: "POL003", sev: "error", at: "publish", loc: "52:5", title: "Privileged token on an untrusted event" },
  { n: 5, code: "POL004", sev: "error", at: "publish", loc: "57:9", title: "Secret reachable from untrusted event" },
  { n: 6, code: "POL004", sev: "error", at: "deploy", loc: "66:9", title: "Secret reachable from untrusted event" },
  { n: 7, code: "POL001", sev: "warning", at: "workflow", loc: "permissions", title: "No top-level permissions" },
  { n: 8, code: "POL006", sev: "warning", at: "publish", loc: "49:3", title: "Deploy without environment gate" },
  { n: 9, code: "POL009", sev: "warning", at: "publish", loc: "49:3", title: "OIDC permission without a cloud step" },
  { n: 10, code: "POL006", sev: "warning", at: "deploy", loc: "61:3", title: "Deploy without environment gate" },
];

const active = ref(0);
const showSrc = ref(false);

const NW = { d: 170, m: 150 };
const NH = { d: 60, m: 56 };

function layout(kind: "d" | "m") {
  const w = NW[kind];
  const h = NH[kind];
  const nodes = JOBS.map((j) => {
    const p = j[kind];
    const own = FINDINGS.filter((f) => f.at === j.id);
    return { ...j, x: p.x, y: p.y, w, h, own };
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges: { key: string; path: string }[] = [];
  for (const t of nodes) {
    for (const s of t.needs) {
      const a = byId[s];
      let path: string;
      if (kind === "d") {
        const sx = a.x + w;
        const sy = a.y + h / 2;
        const tx = t.x;
        const ty = t.y + h / 2;
        const mx = sx + (tx - sx) / 2;
        path = `M${sx} ${sy} H${mx} V${ty} H${tx - 1}`;
      } else {
        const sx = a.x + w / 2;
        const sy = a.y + h;
        const tx = t.x + w - 18;
        const ty = t.y;
        const by = sy + (ty - sy) / 2;
        path = `M${sx} ${sy} V${by} H${tx} V${ty - 1}`;
      }
      edges.push({ key: `${s}>${t.id}`, path });
    }
  }
  return { nodes, edges };
}
const D = computed(() => layout("d"));
const M = computed(() => layout("m"));
const nJobs = JOBS.length;
const nEdges = JOBS.reduce((a, j) => a + j.needs.length, 0);

function balloonX(i: number, x: number) {
  return x + 14 + i * 24;
}
const wfFinding = FINDINGS.find((f) => f.at === "workflow")!;

/* ---- real daggler output, one span per line ---- */
const outLines = lintOut
  .trimEnd()
  .split("\n")
  .map((t) => {
    let cls = "";
    if (t.includes("● POL")) cls = "e";
    else if (t.includes("▲ POL")) cls = "w";
    else if (t.trimStart().startsWith("└─")) cls = "m";
    else if (t.trimStart().startsWith("⚑")) cls = "f";
    else if (t.includes("Security F")) cls = "g";
    else if (t.startsWith("─") || t.startsWith("═")) cls = "r m0";
    return { t, cls };
  });

const LAYERS = [
  { n: "0", name: "Parser", codes: "syntax", what: "YAML syntax errors and warnings, with line and column." },
  { n: "1", name: "Schema", codes: "SCHEMA001-005", what: "Required fields, empty step lists, missing runs-on, no jobs, no triggers." },
  { n: "2", name: "Expressions", codes: "EXPR001-004", what: "Context availability inside ${{ }}: matrix, needs, steps, inputs." },
  { n: "3", name: "Graph", codes: "SEM001-003, 005", what: "needs cycles, dangling references, unreachable jobs, oversized matrices." },
  { n: "4", name: "Actions", codes: "ACT001-005", what: "uses: steps checked against a curated catalog: inputs, outputs, deprecated majors." },
];

const RULES: { code: string; sev: "error" | "warning"; title: string; packs: string }[] = [
  { code: "POL001", sev: "warning", title: "No top-level permissions block", packs: "oss-maintainer, enterprise-least-privilege" },
  { code: "POL002", sev: "error", title: "Third-party action not SHA-pinned", packs: "oss-maintainer, release-hardening, enterprise-least-privilege" },
  { code: "POL003", sev: "error", title: "Privileged token on an untrusted event", packs: "oss-maintainer, enterprise-least-privilege" },
  { code: "POL004", sev: "error", title: "Secret reachable from untrusted event", packs: "oss-maintainer" },
  { code: "POL005", sev: "warning", title: "Broad contents:write on PR workflow", packs: "oss-maintainer" },
  { code: "POL006", sev: "warning", title: "Deploy without environment gate", packs: "release-hardening, cloud-deploy" },
  { code: "POL007", sev: "error", title: "Action ref uses a branch", packs: "release-hardening, enterprise-least-privilege" },
  { code: "POL008", sev: "error", title: "Shell injection from untrusted input", packs: "oss-maintainer, enterprise-least-privilege" },
  { code: "POL009", sev: "warning", title: "OIDC permission without a cloud step", packs: "cloud-deploy, enterprise-least-privilege" },
  { code: "POL010", sev: "warning", title: "Workflow modifies workflow files", packs: "enterprise-least-privilege" },
  { code: "AGENT001", sev: "error", title: "Untrusted input flows into an AI agent", packs: "ai-agent-safety" },
  { code: "AGENT002", sev: "warning", title: "Over-permitted AI agent", packs: "ai-agent-safety" },
  { code: "AGENT003", sev: "error", title: "Agent output executed", packs: "ai-agent-safety" },
];

const SHEETS = 6;
</script>

<template>
  <div class="dh">
    <!-- ======================= SHEET 1: the graph ======================= -->
    <section class="sheet" aria-labelledby="s1">
      <div class="sheet-in">
        <p class="sheet-tag">SHEET 01 / WORKFLOW GRAPH</p>
        <h1 id="s1" class="hero-h">
          Your pipeline, drawn.<br />
          <span class="sig">The flaws, marked.</span>
        </h1>
        <p class="lede">
          Daggler parses GitHub Actions workflows into a typed graph, validates them in five layers
          and scores their security. Below is a real release workflow and what
          <code>daggler lint</code> found in it, pinned where it was found.
        </p>
        <div class="cta">
          <a class="btn solid" :href="withBase('/app/editor/')" target="_self">Open the editor</a>
          <a class="btn" :href="withBase('/guide/getting-started')">Get started</a>
          <code class="cmd" aria-label="install command"><span>$</span> npx daggler-cli lint</code>
        </div>

        <figure class="dag" aria-label="Job graph of release.yml with ten lint findings pinned to jobs">
          <!-- wide drawing -->
          <svg class="dag-d" viewBox="0 0 1100 336" role="img" aria-label="Job dependency graph of release.yml: lint and test feed build, build feeds e2e and docs, both feed publish, publish feeds deploy. Ten findings are marked.">
            <defs>
              <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0 1 L10 5 L0 9 z" class="arrow" />
              </marker>
            </defs>
            <!-- trigger note -->
            <g>
              <rect x="24" y="12" width="360" height="34" class="note" />
              <text x="38" y="34" class="t-mono t-sm">on: pull_request_target · push tags v*</text>
              <g
                class="balloon"
                :class="[wfFinding.sev, { hot: active === wfFinding.n }]"
                :transform="`translate(364 29)`"
              >
                <circle r="10" /><text y="4" text-anchor="middle">{{ wfFinding.n }}</text>
              </g>
            </g>
            <path v-for="e in D.edges" :key="e.key" :d="e.path" class="edge" marker-end="url(#ah)" />
            <g v-for="n in D.nodes" :key="n.id">
              <rect v-if="n.own.length" :x="n.x - 5" :y="n.y - 5" :width="n.w + 10" :height="n.h + 10" rx="7" class="cloud" />
              <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" class="node" />
              <line :x1="n.x" :x2="n.x + n.w" :y1="n.y + 30" :y2="n.y + 30" class="node-rule" />
              <text :x="n.x + 12" :y="n.y + 21" class="t-mono t-id">{{ n.id }}</text>
              <text :x="n.x + 12" :y="n.y + 48" class="t-mono t-sm mute">{{ n.needs.length ? "needs " + n.needs.join(", ") : "no needs" }}</text>
              <g
                v-for="(f, i) in n.own"
                :key="f.n"
                class="balloon"
                :class="[f.sev, { hot: active === f.n }]"
                :transform="`translate(${balloonX(i, n.x)} ${n.y - 18})`"
              >
                <circle r="10" /><text y="4" text-anchor="middle">{{ f.n }}</text>
              </g>
            </g>
            <!-- dimension line -->
            <g class="dim">
              <line x1="24" x2="1074" y1="318" y2="318" />
              <line x1="24" x2="24" y1="311" y2="325" />
              <line x1="1074" x2="1074" y1="311" y2="325" />
              <rect x="395" y="309" width="310" height="18" class="dim-gap" />
              <text x="550" y="322" text-anchor="middle" class="t-mono t-sm">{{ nJobs }} JOBS · {{ nEdges }} NEEDS EDGES · 5 STAGES</text>
            </g>
          </svg>

          <!-- narrow drawing -->
          <svg class="dag-m" viewBox="0 0 340 664" role="img" aria-label="Job dependency graph of release.yml, drawn top to bottom, with ten findings marked.">
            <defs>
              <marker id="ahm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0 1 L10 5 L0 9 z" class="arrow" />
              </marker>
            </defs>
            <rect x="14" y="10" width="312" height="34" class="note" />
            <text x="24" y="31" class="t-mono t-sm">on: pull_request_target · push tags</text>
            <g class="balloon" :class="[wfFinding.sev, { hot: active === wfFinding.n }]" transform="translate(304 27)">
              <circle r="10" /><text y="4" text-anchor="middle">{{ wfFinding.n }}</text>
            </g>
            <path v-for="e in M.edges" :key="e.key" :d="e.path" class="edge" marker-end="url(#ahm)" />
            <g v-for="n in M.nodes" :key="n.id">
              <rect v-if="n.own.length" :x="n.x - 4" :y="n.y - 4" :width="n.w + 8" :height="n.h + 8" rx="7" class="cloud" />
              <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" class="node" />
              <line :x1="n.x" :x2="n.x + n.w" :y1="n.y + 28" :y2="n.y + 28" class="node-rule" />
              <text :x="n.x + 10" :y="n.y + 20" class="t-mono t-id">{{ n.id }}</text>
              <text :x="n.x + 10" :y="n.y + 45" class="t-mono t-xs mute">{{ n.needs.length ? "needs " + n.needs.join(", ") : "no needs" }}</text>
              <g
                v-for="(f, i) in n.own"
                :key="f.n"
                class="balloon"
                :class="[f.sev, { hot: active === f.n }]"
                :transform="`translate(${balloonX(i, n.x) - 2} ${n.y - 17})`"
              >
                <circle r="10" /><text y="4" text-anchor="middle">{{ f.n }}</text>
              </g>
            </g>
            <text x="170" y="656" text-anchor="middle" class="t-mono t-xs mute">{{ nJobs }} JOBS · {{ nEdges }} NEEDS EDGES · 5 STAGES</text>
          </svg>
        </figure>

        <div class="sched-wrap">
          <table class="sched">
            <caption>
              Findings schedule <span class="mute">from <code>daggler lint</code> on release.yml · security grade F, 0/100 · 6 errors, 4 warnings</span>
            </caption>
            <thead>
              <tr><th>No.</th><th>Code</th><th>Where</th><th>Finding</th></tr>
            </thead>
            <tbody>
              <tr
                v-for="f in FINDINGS"
                :key="f.n"
                :class="{ hot: active === f.n }"
                @mouseenter="active = f.n"
                @mouseleave="active = 0"
              >
                <td><span class="pin" :class="f.sev">{{ f.n }}</span></td>
                <td class="code">{{ f.code }}</td>
                <td class="where">{{ f.at }}<span class="mute"> · {{ f.loc }}</span></td>
                <td>{{ f.title }}<span class="sr"> ({{ f.sev }})</span></td>
              </tr>
            </tbody>
          </table>
          <p class="key">
            <span class="pin error">n</span> error &nbsp; <span class="pin warning">n</span> warning &nbsp;
            <span class="cloud-key"></span> job with findings
          </p>
        </div>

        <div class="tblock">
          <div class="tb-title"><i>Title</i>release.yml, dependency graph</div>
          <div><i>Project</i>daggler</div>
          <div><i>Sheet</i>1 of {{ SHEETS }}</div>
          <div><i>Rev</i>0.1.2</div>
          <div class="tb-wide"><i>Drawn by</i>daggler lint --no-color</div>
        </div>
      </div>
    </section>

    <!-- ======================= SHEET 2: real output ======================= -->
    <section class="sheet" aria-labelledby="s2">
      <div class="sheet-in">
        <p class="sheet-tag">SHEET 02 / REPORT</p>
        <h2 id="s2" class="sheet-h">The same file, as the terminal prints it</h2>
        <p class="lede">
          This is the unedited output of <code>npx daggler-cli@0.1.2 lint --no-color</code> on the
          workflow above. Every line is addressed: file, line, column, and what to do about it. The exit
          code is <code>1</code> whenever there is an error, so it can gate CI.
        </p>
        <div class="term" role="region" aria-label="daggler lint output" tabindex="0">
          <div class="term-bar">$ npx daggler-cli lint --no-color .github/workflows/release.yml</div>
          <pre><span v-for="(l, i) in outLines" :key="i" :class="l.cls">{{ l.t || " " }}</span></pre>
        </div>
        <button class="btn small" type="button" :aria-expanded="showSrc" @click="showSrc = !showSrc">
          {{ showSrc ? "Hide" : "Show" }} release.yml ({{ workflowSrc.trim().split("\n").length }} lines)
        </button>
        <div v-if="showSrc" class="term src">
          <div class="term-bar">.github/workflows/release.yml</div>
          <pre>{{ workflowSrc }}</pre>
        </div>
        <div class="tblock">
          <div class="tb-title"><i>Title</i>Lint report, verbatim</div>
          <div><i>Project</i>daggler</div>
          <div><i>Sheet</i>2 of {{ SHEETS }}</div>
          <div><i>Rev</i>0.1.2</div>
          <div class="tb-wide"><i>Source</i>npx daggler-cli@0.1.2</div>
        </div>
      </div>
    </section>

    <!-- ======================= SHEET 3: layers ======================= -->
    <section class="sheet" aria-labelledby="s3">
      <div class="sheet-in">
        <p class="sheet-tag">SHEET 03 / SECTION A-A</p>
        <h2 id="s3" class="sheet-h">Five layers, cut through the pipeline</h2>
        <p class="lede">
          Workflow YAML becomes a typed IR with a source map, then a job graph. Each layer runs over the
          same parse and adds diagnostics; the policy engine sits on top and scores the result from A to F.
          The whole pipeline is TypeScript and runs in the browser.
        </p>
        <ol class="layers">
          <li v-for="l in LAYERS" :key="l.n">
            <span class="ln">L{{ l.n }}</span>
            <strong>{{ l.name }}</strong>
            <code>{{ l.codes }}</code>
            <span class="what">{{ l.what }}</span>
          </li>
        </ol>
        <div class="tblock">
          <div class="tb-title"><i>Title</i>Validation layers</div>
          <div><i>Project</i>daggler</div>
          <div><i>Sheet</i>3 of {{ SHEETS }}</div>
          <div><i>Rev</i>0.1.2</div>
          <div class="tb-wide"><i>Ref</i><a :href="withBase('/reference/validation')">reference/validation</a></div>
        </div>
      </div>
    </section>

    <!-- ======================= SHEET 4: rules ======================= -->
    <section class="sheet" aria-labelledby="s4">
      <div class="sheet-in">
        <p class="sheet-tag">SHEET 04 / SCHEDULE OF RULES</p>
        <h2 id="s4" class="sheet-h">Thirteen policy rules</h2>
        <p class="lede">
          POL001 to POL010 cover permissions, pinning, untrusted triggers and injection. AGENT001 to
          AGENT003 cover AI-agent workflows: prompt injection, over-permitted agents and executed model
          output. Rules are grouped into six packs.
        </p>
        <div class="sched-wrap">
          <table class="sched rules">
            <thead><tr><th>Code</th><th>Severity</th><th>Rule</th><th class="packs">Packs</th></tr></thead>
            <tbody>
              <tr v-for="r in RULES" :key="r.code">
                <td class="code">{{ r.code }}</td>
                <td><span class="pin sm" :class="r.sev"></span><span class="sevtxt">{{ r.sev }}</span></td>
                <td>{{ r.title }}</td>
                <td class="packs mute">{{ r.packs }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="tblock">
          <div class="tb-title"><i>Title</i>Policy rules</div>
          <div><i>Project</i>daggler</div>
          <div><i>Sheet</i>4 of {{ SHEETS }}</div>
          <div><i>Rev</i>0.1.2</div>
          <div class="tb-wide"><i>Ref</i><a :href="withBase('/reference/policy-rules')">reference/policy-rules</a></div>
        </div>
      </div>
    </section>

    <!-- ======================= SHEET 5: editor ======================= -->
    <section class="sheet" aria-labelledby="s5">
      <div class="sheet-in">
        <p class="sheet-tag">SHEET 05 / DETAIL VIEWS</p>
        <h2 id="s5" class="sheet-h">The editor</h2>
        <p class="lede">
          Captures of the real editor from a checkout, using the real engine and bundled sample
          workflows. The <a :href="withBase('/app/editor/')" target="_self">hosted editor</a> runs the same
          engine in your browser: graph, diagnostics, event simulation and policy checks. Running
          workflows needs the CLI or a local build.
        </p>
        <div class="details">
          <figure class="wide">
            <img :src="withBase('/images/editor.png')" width="3200" height="1800" loading="lazy" alt="The Daggler editor: job graph, Monaco YAML with diagnostics, inspector, confidence ladder" />
            <figcaption><b>Detail A</b> Live job graph, Monaco YAML with source-mapped diagnostics, a typed inspector and one-click quick-fixes.</figcaption>
          </figure>
          <figure>
            <img :src="withBase('/images/security.png')" width="3200" height="1800" loading="lazy" alt="Security view of an AI-agent workflow graded F with AGENT001 findings" />
            <figcaption><b>Detail B</b> Security view: an AI-agent workflow graded F, with AGENT001 and POL003 findings.</figcaption>
          </figure>
          <figure>
            <img :src="withBase('/images/live-run.png')" width="3200" height="1800" loading="lazy" alt="The Local rung of the confidence ladder streaming an act plan into the Run panel" />
            <figcaption><b>Detail C</b> The Local rung runs act against Docker and streams the plan into the Run panel.</figcaption>
          </figure>
        </div>
        <div class="tblock">
          <div class="tb-title"><i>Title</i>Editor, local build</div>
          <div><i>Project</i>daggler</div>
          <div><i>Sheet</i>5 of {{ SHEETS }}</div>
          <div><i>Rev</i>0.1.2</div>
          <div class="tb-wide"><i>Ref</i><a :href="withBase('/guide/web-editor')">guide/web-editor</a></div>
        </div>
      </div>
    </section>

    <!-- ======================= SHEET 6: install ======================= -->
    <section class="sheet" aria-labelledby="s6" id="install">
      <div class="sheet-in">
        <p class="sheet-tag">SHEET 06 / GENERAL NOTES</p>
        <h2 id="s6" class="sheet-h">Install and run</h2>
        <ol class="notes">
          <li>
            <p>Run the CLI once, Node 20 or newer. With no arguments <code>lint</code> scans <code>.github/workflows/</code>.</p>
            <pre class="cmdblock">npx daggler-cli lint</pre>
          </li>
          <li>
            <p>Or install it. The package is <a href="https://www.npmjs.com/package/daggler-cli">daggler-cli</a>; the binary is <code>daggler</code>.</p>
            <pre class="cmdblock">npm install -g daggler-cli
daggler lint</pre>
          </li>
          <li>
            <p>Open the hosted editor, no install: <a :href="withBase('/app/editor/')" target="_self">alliecatowo.github.io/daggler/app/editor</a>. Or build the full editor from source (Node 20+, pnpm 10+).</p>
            <pre class="cmdblock">git clone https://github.com/alliecatowo/daggler
cd daggler && pnpm install
pnpm --filter @daggler/web dev   # http://localhost:3737</pre>
          </li>
        </ol>
        <div class="tblock">
          <div class="tb-title"><i>Title</i>Install</div>
          <div><i>Project</i>daggler</div>
          <div><i>Sheet</i>6 of {{ SHEETS }}</div>
          <div><i>Rev</i>0.1.2</div>
          <div class="tb-wide"><i>Source</i><a href="https://github.com/alliecatowo/daggler">github.com/alliecatowo/daggler</a></div>
        </div>
      </div>
    </section>
  </div>
</template>
