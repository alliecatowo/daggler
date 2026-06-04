import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildGraph,
  classifyRef,
  parseActionRef,
  parsePermissions,
  parseWorkflow,
  SAMPLE_BY_ID,
  serialize,
  SourceMap,
} from "../src/index.js";

const ci = SAMPLE_BY_ID["ci-release"]!.yaml;
const broken = SAMPLE_BY_ID["broken-graph"]!.yaml;

describe("parseWorkflow — structure", () => {
  const { ir, ok } = parseWorkflow(ci, { path: ".github/workflows/ci.yml" });

  it("parses without fatal errors", () => {
    expect(ok).toBe(true);
  });

  it("extracts the workflow name and triggers", () => {
    expect(ir.name).toBe("CI / Release");
    const events = ir.on.map((t) => t.event).sort();
    expect(events).toEqual(["pull_request", "push", "workflow_dispatch"]);
    const push = ir.on.find((t) => t.event === "push");
    expect(push?.branches).toEqual(["main"]);
  });

  it("captures top-level permissions and concurrency", () => {
    expect(ir.permissions?.scopes?.contents).toBe("read");
    expect(ir.concurrency?.group).toContain("github.ref");
  });

  it("models four jobs with the right needs edges", () => {
    expect(ir.jobs.map((j) => j.id)).toEqual(["lint", "test", "build", "deploy"]);
    const build = ir.jobs.find((j) => j.id === "build")!;
    expect(build.needs).toEqual(["lint", "test"]);
    expect(build.outputs?.image).toContain("steps.meta.outputs.tag");
  });

  it("expands the test matrix", () => {
    const test = ir.jobs.find((j) => j.id === "test")!;
    expect(test.strategy?.matrix?.dimensions.node).toEqual(["18", "20", "22"]);
    expect(test.strategy?.matrix?.size).toBe(3);
  });

  it("classifies action refs (uses steps)", () => {
    const build = ir.jobs.find((j) => j.id === "build")!;
    const docker = build.steps.find(
      (s) => s.kind === "uses" && s.uses.startsWith("docker/"),
    );
    expect(docker?.kind).toBe("uses");
    if (docker?.kind === "uses") {
      expect(docker.ref.owner).toBe("docker");
      expect(docker.ref.repo).toBe("build-push-action");
      expect(docker.ref.ref).toBe("v5");
      expect(docker.ref.refKind).toBe("tag");
    }
  });

  it("grants deploy id-token: write and an environment", () => {
    const deploy = ir.jobs.find((j) => j.id === "deploy")!;
    expect(deploy.permissions?.scopes?.["id-token"]).toBe("write");
    expect(deploy.environment?.name).toBe("production");
  });
});

describe("source map", () => {
  const { sourceMap } = parseWorkflow(ci);
  const map = new SourceMap(sourceMap);

  it("locates a job block", () => {
    const span = map.spanForPath("job:build");
    expect(span).toBeDefined();
    expect(span!.start.line).toBeGreaterThan(0);
    expect(span!.end.line).toBeGreaterThanOrEqual(span!.start.line);
  });

  it("round-trips line → path → line", () => {
    const span = map.spanForPath("job:deploy")!;
    const path = map.pathAtLine(span.start.line);
    // most specific path at the job's opening line should be the job or a step within
    expect(path === "job:deploy" || path?.startsWith("step:deploy")).toBe(true);
  });
});

describe("buildGraph", () => {
  it("layers the CI pipeline by needs depth", () => {
    const { ir } = parseWorkflow(ci);
    const g = buildGraph(ir);
    const depth = Object.fromEntries(g.jobs.map((n) => [n.id, n.depth]));
    expect(depth.lint).toBe(0);
    expect(depth.test).toBe(1);
    expect(depth.build).toBe(2);
    expect(depth.deploy).toBe(3);
    expect(g.hasCycle).toBe(false);
    expect(g.edges.filter((e) => e.kind === "needs").length).toBe(4);
  });

  it("detects cycles and unreachable jobs in the broken sample", () => {
    const { ir } = parseWorkflow(broken);
    const g = buildGraph(ir);
    expect(g.hasCycle).toBe(true);
    expect(g.cycleNodes.sort()).toEqual(["a", "b", "c"]);
    // publish needs a non-existent job "ghost" → never runs
    expect(g.unreachable).toContain("publish");
  });
});

describe("normalize helpers", () => {
  it("classifies refs", () => {
    expect(classifyRef("a".repeat(40))).toBe("sha");
    expect(classifyRef("v4")).toBe("tag");
    expect(classifyRef("v4.1.0")).toBe("tag");
    expect(classifyRef("main")).toBe("branch");
  });

  it("parses local and docker refs", () => {
    expect(parseActionRef("./.github/actions/build").kind).toBe("local");
    expect(parseActionRef("docker://alpine:3").kind).toBe("docker");
    const r = parseActionRef("actions/checkout@v4");
    expect(r.owner).toBe("actions");
    expect(r.repo).toBe("checkout");
  });

  it("parses permission forms", () => {
    expect(parsePermissions("read-all")).toEqual({ all: "read" });
    expect(parsePermissions({})).toEqual({ none: true });
    expect(parsePermissions({ contents: "write" })?.scopes?.contents).toBe("write");
  });
});

describe("serialize round-trip", () => {
  it("re-parses to an equivalent job/needs structure", () => {
    const { ir } = parseWorkflow(ci);
    const yaml = serialize(ir);
    const again = parseWorkflow(yaml).ir;
    expect(again.jobs.map((j) => j.id)).toEqual(ir.jobs.map((j) => j.id));
    const build = again.jobs.find((j) => j.id === "build")!;
    expect(build.needs).toEqual(["lint", "test"]);
    expect(again.name).toBe("CI / Release");
  });
});

describe("applyCommand — source-preserving edits", () => {
  it("renames a job without disturbing the rest", () => {
    const res = applyCommand(ci, { type: "job.rename", jobId: "lint", name: "Lint!" });
    expect(res.ok).toBe(true);
    expect(res.source).toContain("Lint!");
    // other content survives
    expect(res.source).toContain("Deploy production");
    const reparsed = parseWorkflow(res.source).ir;
    expect(reparsed.jobs.find((j) => j.id === "lint")!.name).toBe("Lint!");
  });

  it("adds and removes a needs edge", () => {
    const added = applyCommand(ci, { type: "job.addNeed", jobId: "lint", need: "test" });
    expect(parseWorkflow(added.source).ir.jobs.find((j) => j.id === "lint")!.needs)
      .toContain("test");
    const removed = applyCommand(added.source, {
      type: "job.removeNeed",
      jobId: "lint",
      need: "test",
    });
    expect(parseWorkflow(removed.source).ir.jobs.find((j) => j.id === "lint")!.needs)
      .not.toContain("test");
  });
});
