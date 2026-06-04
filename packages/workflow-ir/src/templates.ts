/* ============================================================================
 * WORKFLOW_TEMPLATES — a polished, lint-friendly starter corpus.
 *
 * Rules for every entry:
 *   - top-level `permissions: contents: read` (least privilege by default)
 *   - actions pinned to a tag (or SHA where pinning matters most)
 *   - no untrusted event data passed into shell steps without sanitisation
 *   - valid GitHub Actions YAML that parses cleanly under daggler
 * ========================================================================== */

export interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  yaml: string;
}

// ---------------------------------------------------------------------------
// node-ci
// ---------------------------------------------------------------------------
const nodeCi = `name: Node CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  build:
    name: Lint, typecheck & test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ["18", "20", "22"]
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Typecheck
        run: npm run typecheck
      - name: Test
        run: npm test
`;

// ---------------------------------------------------------------------------
// python-ci
// ---------------------------------------------------------------------------
const pythonCi = `name: Python CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    name: Test (Python \${{ matrix.python-version }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
          cache: pip
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
      - name: Lint with ruff
        run: ruff check .
      - name: Type-check with mypy
        run: mypy .
      - name: Run tests
        run: pytest --tb=short
`;

// ---------------------------------------------------------------------------
// docker-publish
// ---------------------------------------------------------------------------
const dockerPublish = `name: Docker publish

on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    name: Build & push image
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/\${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;

// ---------------------------------------------------------------------------
// npm-publish
// ---------------------------------------------------------------------------
const npmPublish = `name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    name: npm publish
    runs-on: ubuntu-latest
    environment: npm-publish
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: https://registry.npmjs.org
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
      - name: Publish with provenance
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;

// ---------------------------------------------------------------------------
// release-please
// ---------------------------------------------------------------------------
const releasePlease = `name: Release Please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    name: Release Please
    runs-on: ubuntu-latest
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
      tag_name: \${{ steps.release.outputs.tag_name }}
    steps:
      - name: Run Release Please
        id: release
        uses: googleapis/release-please-action@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          release-type: node
`;

// ---------------------------------------------------------------------------
// ai-agent-safe
//
// Demonstrates the SAFE pattern for an AI-agent workflow:
//   - the event payload (untrusted) is NOT interpolated directly into the
//     prompt; instead it is written to a file and the agent reads the file.
//   - permissions are least-privilege (only what the task actually needs)
//   - no shell/write tools enabled for the agent
// ---------------------------------------------------------------------------
const aiAgentSafe = `name: AI Issue Triage (safe)

on:
  issues:
    types: [opened, labeled]

permissions:
  contents: read
  issues: write

jobs:
  triage:
    name: Triage new issue
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Write untrusted event data to a file — never inline it into the prompt.
      - name: Write issue body to file
        run: |
          printf '%s' "\$ISSUE_BODY" > /tmp/issue-body.txt
          printf '%s' "\$ISSUE_TITLE" > /tmp/issue-title.txt
        env:
          ISSUE_BODY: \${{ github.event.issue.body }}
          ISSUE_TITLE: \${{ github.event.issue.title }}

      - name: Run triage agent
        uses: anthropics/claude-code-action@v1
        with:
          # Prompt reads from files — no untrusted data in the prompt string.
          prompt: |
            Read /tmp/issue-title.txt and /tmp/issue-body.txt (already written
            for you). Classify this issue as bug / feature / question / other
            and reply with ONLY a JSON object:
            {"label":"<label>","reason":"<one sentence>"}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          # No shell or write tools — agent can only read and comment.
          allowed-tools: github_comment
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`;

// ---------------------------------------------------------------------------
// Corpus export
// ---------------------------------------------------------------------------

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "node-ci",
    name: "Node CI",
    category: "CI",
    description:
      "Lint, typecheck, and test a Node.js project across a version matrix. Caches npm dependencies for speed.",
    yaml: nodeCi,
  },
  {
    id: "python-ci",
    name: "Python CI",
    category: "CI",
    description:
      "Run ruff, mypy, and pytest across a Python version matrix with pip caching.",
    yaml: pythonCi,
  },
  {
    id: "docker-publish",
    name: "Docker Publish",
    category: "Publish",
    description:
      "Build and push a Docker image to GHCR on semver tags. Uses Buildx layer caching via GitHub Actions cache.",
    yaml: dockerPublish,
  },
  {
    id: "npm-publish",
    name: "npm Publish",
    category: "Publish",
    description:
      "Publish a package to npm on release with OIDC-based provenance attestation. No long-lived secrets.",
    yaml: npmPublish,
  },
  {
    id: "release-please",
    name: "Release Please",
    category: "Release",
    description:
      "Automate changelogs and GitHub releases with Release Please. Outputs release_created for downstream jobs.",
    yaml: releasePlease,
  },
  {
    id: "ai-agent-safe",
    name: "AI Agent (safe)",
    category: "AI",
    description:
      "Issue triage agent using the secure pattern: untrusted event data goes to files, never into the prompt string. Least-privilege permissions, no shell tools.",
    yaml: aiAgentSafe,
  },
];

export const TEMPLATE_BY_ID: Record<string, WorkflowTemplate> = Object.fromEntries(
  WORKFLOW_TEMPLATES.map((t) => [t.id, t]),
);
