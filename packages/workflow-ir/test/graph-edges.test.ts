import { describe, expect, it } from "vitest";
import { buildGraph, parseWorkflow, SAMPLE_BY_ID } from "../src/index.js";
import type { GraphEdge } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edgesOf(kind: GraphEdge["kind"], edges: GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.kind === kind);
}

function hasEdge(
  edges: GraphEdge[],
  match: Partial<Pick<GraphEdge, "from" | "to" | "label" | "kind">>,
): boolean {
  return edges.some((e) =>
    (match.kind === undefined || e.kind === match.kind) &&
    (match.from === undefined || e.from === match.from) &&
    (match.to === undefined || e.to === match.to) &&
    (match.label === undefined || e.label === match.label),
  );
}

// ---------------------------------------------------------------------------
// DATA edges
// ---------------------------------------------------------------------------

describe("DATA edges", () => {
  it("existing needs+trigger edges are still present in broken-graph", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["broken-graph"]!.yaml);
    const g = buildGraph(ir);
    const needs = edgesOf("needs", g.edges);
    // a needs [c] → c->a edge; b needs [a] → a->b edge; c needs [b] → b->c edge
    // publish needs [ghost] → ghost->publish edge (missing dep still emitted)
    expect(needs.length).toBeGreaterThanOrEqual(3);
    // "a needs [c]" means a depends on c, edge: from=c, to=a
    expect(needs.some((e) => e.from === "c" && e.to === "a")).toBe(true);
  });

  it("broken-graph: DATA edge b->publish for output 'value'", () => {
    // publish has: run: echo "ref ${{ needs.b.outputs.value }}"
    const { ir } = parseWorkflow(SAMPLE_BY_ID["broken-graph"]!.yaml);
    const g = buildGraph(ir);
    const data = edgesOf("data", g.edges);
    expect(data.length).toBeGreaterThan(0);
    expect(
      hasEdge(data, { kind: "data", from: "b", to: "publish", label: "value" }),
    ).toBe(true);
  });

  it("broken-graph: DATA edge has stable id", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["broken-graph"]!.yaml);
    const g = buildGraph(ir);
    const e = g.edges.find(
      (edge) => edge.kind === "data" && edge.from === "b" && edge.to === "publish",
    );
    expect(e).toBeDefined();
    expect(e!.id).toBe("data:b->publish:value");
  });

  it("does not emit DATA edges when no needs.outputs references exist", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["minimal"]!.yaml);
    const g = buildGraph(ir);
    expect(edgesOf("data", g.edges).length).toBe(0);
  });

  it("deduplicates DATA edges when the same output is referenced multiple times", () => {
    const yaml = `
name: Dedupe test
on: push
jobs:
  producer:
    runs-on: ubuntu-latest
    steps:
      - run: echo done
  consumer:
    runs-on: ubuntu-latest
    needs: [producer]
    steps:
      - run: echo "\${{ needs.producer.outputs.artifact }}"
      - run: echo "\${{ needs.producer.outputs.artifact }}"
`;
    const { ir } = parseWorkflow(yaml);
    const g = buildGraph(ir);
    const matching = g.edges.filter(
      (e) =>
        e.kind === "data" &&
        e.from === "producer" &&
        e.to === "consumer" &&
        e.label === "artifact",
    );
    expect(matching.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AUTHORITY edges
// ---------------------------------------------------------------------------

describe("AUTHORITY edges", () => {
  it("pr-preview: AUTHORITY edge for secret DEPLOY_TOKEN -> preview", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["pr-preview"]!.yaml);
    const g = buildGraph(ir);
    const auth = edgesOf("authority", g.edges);
    expect(auth.length).toBeGreaterThan(0);
    expect(
      hasEdge(auth, {
        kind: "authority",
        from: "secret:DEPLOY_TOKEN",
        to: "preview",
        label: "DEPLOY_TOKEN",
      }),
    ).toBe(true);
  });

  it("pr-preview: AUTHORITY edge for contents:write -> preview", () => {
    // workflow-level permissions: contents: write (no job-level override)
    const { ir } = parseWorkflow(SAMPLE_BY_ID["pr-preview"]!.yaml);
    const g = buildGraph(ir);
    const auth = edgesOf("authority", g.edges);
    expect(
      hasEdge(auth, {
        kind: "authority",
        from: "perm:contents",
        to: "preview",
        label: "contents",
      }),
    ).toBe(true);
  });

  it("pr-preview: AUTHORITY edge for pull-requests:write -> preview", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["pr-preview"]!.yaml);
    const g = buildGraph(ir);
    const auth = edgesOf("authority", g.edges);
    expect(
      hasEdge(auth, {
        kind: "authority",
        from: "perm:pull-requests",
        to: "preview",
        label: "pull-requests",
      }),
    ).toBe(true);
  });

  it("GITHUB_TOKEN is excluded from secret authority edges", () => {
    // triage-agent uses secrets.GITHUB_TOKEN — must not produce an authority edge
    const { ir } = parseWorkflow(SAMPLE_BY_ID["triage-agent"]!.yaml);
    const g = buildGraph(ir);
    const auth = edgesOf("authority", g.edges);
    expect(
      auth.some((e) => e.label === "GITHUB_TOKEN"),
    ).toBe(false);
  });

  it("ci-release: deploy job gets AUTHORITY edge for DEPLOY_ROLE secret", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["ci-release"]!.yaml);
    const g = buildGraph(ir);
    const auth = edgesOf("authority", g.edges);
    expect(
      hasEdge(auth, {
        kind: "authority",
        from: "secret:DEPLOY_ROLE",
        to: "deploy",
        label: "DEPLOY_ROLE",
      }),
    ).toBe(true);
  });

  it("ci-release: deploy job gets AUTHORITY edge for id-token:write (job-level perm)", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["ci-release"]!.yaml);
    const g = buildGraph(ir);
    const auth = edgesOf("authority", g.edges);
    // deploy has job-level permissions: id-token: write
    expect(
      hasEdge(auth, {
        kind: "authority",
        from: "perm:id-token",
        to: "deploy",
        label: "id-token",
      }),
    ).toBe(true);
  });

  it("no authority edges for minimal workflow", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["minimal"]!.yaml);
    const g = buildGraph(ir);
    expect(edgesOf("authority", g.edges).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Backward-compat: existing consumers that filter kind==="needs"|"trigger"
// ---------------------------------------------------------------------------

describe("backward-compat: existing edge filtering still works", () => {
  it("ci-release still has exactly 4 needs edges", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["ci-release"]!.yaml);
    const g = buildGraph(ir);
    expect(edgesOf("needs", g.edges).length).toBe(4);
  });

  it("ci-release trigger edges still feed root jobs", () => {
    const { ir } = parseWorkflow(SAMPLE_BY_ID["ci-release"]!.yaml);
    const g = buildGraph(ir);
    const triggerEdges = edgesOf("trigger", g.edges);
    expect(triggerEdges.every((e) => e.to === "lint")).toBe(true);
  });
});
