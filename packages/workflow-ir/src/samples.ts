/* ============================================================================
 * A small corpus of real-shaped workflows. Used by validator tests and shipped
 * to the web app as the starting library so the editor works with zero backend.
 * Each is intentionally crafted to exercise specific diagnostics.
 * ========================================================================== */

export interface SampleWorkflow {
  id: string;
  name: string;
  path: string;
  description: string;
  /** Short tag shown in the workflow list. */
  tag: string;
  yaml: string;
}

const ciRelease = `name: CI / Release

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency: ci-\${{ github.ref }}

jobs:
  lint:
    name: Lint & typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - name: Static checks
        run: npm run lint && npm run typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    needs: [lint]
    strategy:
      matrix:
        node: ["18", "20", "22"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
      - run: npm ci
      - name: Unit tests
        run: npm test -- --coverage

  build:
    name: Build & package
    runs-on: ubuntu-latest
    needs: [lint, test]
    outputs:
      image: \${{ steps.meta.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Build app
        run: npm run build
      - id: meta
        uses: docker/build-push-action@v5
        with:
          push: true
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  deploy:
    name: Deploy production
    runs-on: ubuntu-latest
    needs: [build]
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@main
        with:
          role-to-assume: \${{ secrets.DEPLOY_ROLE }}
      - name: Deploy
        run: ./scripts/deploy.sh
`;

const prTargetInjection = `name: PR Preview

on:
  pull_request_target:
    types: [opened, synchronize]

permissions:
  contents: write
  pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - name: Greet
        run: |
          echo "Building PR: \${{ github.event.pull_request.title }}"
          echo "By: \${{ github.event.pull_request.user.login }}"
      - run: npm ci && npm run build
      - uses: some-org/deploy-preview@v1
        with:
          token: \${{ secrets.DEPLOY_TOKEN }}
`;

const agentInjection = `name: Triage Agent

on:
  issues:
    types: [opened]
  issue_comment:
    types: [created]

permissions:
  contents: write
  issues: write
  models: read

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run agent on issue
        uses: example/ai-agent-action@v2
        with:
          prompt: |
            You are a triage bot. Read this issue and take action:
            \${{ github.event.issue.body }}
          allow-tools: shell,write
          github-token: \${{ secrets.GITHUB_TOKEN }}
      - name: Apply agent patch
        run: |
          echo "\${{ steps.agent.outputs.patch }}" > patch.diff
          git apply patch.diff || true
`;

const brokenNeeds = `name: Broken graph

on: push

jobs:
  a:
    runs-on: ubuntu-latest
    needs: [c]
    steps:
      - run: echo a

  b:
    runs-on: ubuntu-latest
    needs: [a]
    steps:
      - run: echo "\${{ matrix.os }}"

  c:
    runs-on: ubuntu-latest
    needs: [b]
    steps:
      - run: echo c

  publish:
    runs-on: ubuntu-latest
    needs: [ghost]
    steps:
      - run: echo "ref \${{ needs.b.outputs.value }}"
`;

const minimal = `name: Hello

on:
  workflow_dispatch:

jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Hello from Daggler"
`;

export const SAMPLE_WORKFLOWS: SampleWorkflow[] = [
  {
    id: "ci-release",
    name: "CI / Release",
    path: ".github/workflows/ci.yml",
    description:
      "A four-stage pipeline: lint → test (matrix) → build → deploy. The flagship example — surfaces supply-chain, OIDC, and output-reference findings.",
    tag: "pipeline",
    yaml: ciRelease,
  },
  {
    id: "pr-preview",
    name: "PR Preview",
    path: ".github/workflows/pr-preview.yml",
    description:
      "A pull_request_target workflow that checks out untrusted PR code and interpolates PR text into a shell step — the canonical privilege + injection hazard.",
    tag: "security",
    yaml: prTargetInjection,
  },
  {
    id: "triage-agent",
    name: "Triage Agent",
    path: ".github/workflows/triage-agent.yml",
    description:
      "An AI-agent workflow that pipes untrusted issue body straight into an agent prompt with shell tools — agentic workflow injection.",
    tag: "agent",
    yaml: agentInjection,
  },
  {
    id: "broken-graph",
    name: "Broken graph",
    path: ".github/workflows/broken.yml",
    description:
      "A cyclic needs chain (a → c → b → a), a job that needs a non-existent job, and matrix/output contexts referenced where they cannot resolve.",
    tag: "diagnostics",
    yaml: brokenNeeds,
  },
  {
    id: "minimal",
    name: "Hello",
    path: ".github/workflows/hello.yml",
    description: "A minimal, clean, manually-dispatched workflow. The happy path.",
    tag: "starter",
    yaml: minimal,
  },
];

export const SAMPLE_BY_ID: Record<string, SampleWorkflow> = Object.fromEntries(
  SAMPLE_WORKFLOWS.map((s) => [s.id, s]),
);
