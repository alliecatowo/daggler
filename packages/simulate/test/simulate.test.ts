import { describe, expect, it } from "vitest";
import { parseWorkflow, SAMPLE_BY_ID } from "@daggler/workflow-ir";
import { simulateEvent } from "../src/index.js";
import { matchGlob } from "../src/triggers.js";
import { evalIf } from "../src/expr.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

function parseSample(id: string) {
  const sample = SAMPLE_BY_ID[id]!;
  const { ir, ok } = parseWorkflow(sample.yaml, { path: sample.path });
  expect(ok).toBe(true);
  return ir;
}

/* -------------------------------------------------------------------------- */
/* Glob matcher unit tests                                                      */
/* -------------------------------------------------------------------------- */

describe("matchGlob", () => {
  it("matches exact strings", () => {
    expect(matchGlob("main", "main")).toBe(true);
    expect(matchGlob("main", "other")).toBe(false);
  });

  it("* matches within a segment", () => {
    expect(matchGlob("release/*", "release/v1")).toBe(true);
    expect(matchGlob("release/*", "release/v1.2.3")).toBe(true);
    expect(matchGlob("release/*", "release/v1/extra")).toBe(false);
    expect(matchGlob("feature/*", "feature/foo-bar")).toBe(true);
  });

  it("** matches across segments", () => {
    expect(matchGlob("src/**", "src/a/b/c.ts")).toBe(true);
    expect(matchGlob("src/**/*.ts", "src/foo/bar.ts")).toBe(true);
    expect(matchGlob("src/**/*.ts", "src/foo/bar.js")).toBe(false);
    expect(matchGlob("**", "anything/deep/in/here")).toBe(true);
  });

  it("prefix ** patterns", () => {
    expect(matchGlob("**/*.md", "docs/README.md")).toBe(true);
    expect(matchGlob("**/*.md", "README.md")).toBe(true);
    expect(matchGlob("**/*.md", "README.ts")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* evalIf unit tests                                                            */
/* -------------------------------------------------------------------------- */

describe("evalIf", () => {
  const ctx = {
    github: {
      event_name: "push",
      ref: "refs/heads/main",
      ref_name: "main",
      actor: "alice",
      base_ref: "",
      head_ref: "main",
    },
    inputs: { MY_VAR: "hello" },
    jobStatus: "success" as const,
  };

  it("evaluates literal true/false", () => {
    expect(evalIf("true", ctx).value).toBe(true);
    expect(evalIf("false", ctx).value).toBe(false);
  });

  it("strips ${{ }} wrapper", () => {
    expect(evalIf("${{ true }}", ctx).value).toBe(true);
    expect(evalIf("${{ false }}", ctx).value).toBe(false);
  });

  it("compares github.event_name", () => {
    expect(evalIf("github.event_name == 'push'", ctx).value).toBe(true);
    expect(evalIf("github.event_name == 'pull_request'", ctx).value).toBe(false);
    expect(evalIf("github.event_name != 'pull_request'", ctx).value).toBe(true);
  });

  it("compares github.ref", () => {
    expect(evalIf("github.ref == 'refs/heads/main'", ctx).value).toBe(true);
    expect(evalIf("github.ref != 'refs/heads/main'", ctx).value).toBe(false);
  });

  it("evaluates && and ||", () => {
    expect(evalIf("github.event_name == 'push' && github.ref == 'refs/heads/main'", ctx).value).toBe(true);
    expect(evalIf("github.event_name == 'push' || github.event_name == 'pull_request'", ctx).value).toBe(true);
    expect(evalIf("github.event_name == 'pull_request' || false", ctx).value).toBe(false);
  });

  it("evaluates !", () => {
    expect(evalIf("!false", ctx).value).toBe(true);
    expect(evalIf("!true", ctx).value).toBe(false);
    expect(evalIf("!(github.event_name == 'pull_request')", ctx).value).toBe(true);
  });

  it("evaluates contains()", () => {
    expect(evalIf("contains(github.ref, 'main')", ctx).value).toBe(true);
    expect(evalIf("contains(github.ref, 'feature')", ctx).value).toBe(false);
  });

  it("evaluates startsWith() and endsWith()", () => {
    expect(evalIf("startsWith(github.ref, 'refs/heads/')", ctx).value).toBe(true);
    expect(evalIf("endsWith(github.ref, 'main')", ctx).value).toBe(true);
    expect(evalIf("endsWith(github.ref, 'feature')", ctx).value).toBe(false);
  });

  it("evaluates success() and always()", () => {
    expect(evalIf("success()", ctx).value).toBe(true);
    expect(evalIf("always()", ctx).value).toBe(true);
    expect(evalIf("failure()", ctx).value).toBe(false);
    expect(evalIf("cancelled()", ctx).value).toBe(false);
  });

  it("reads inputs.X", () => {
    expect(evalIf("inputs.MY_VAR == 'hello'", ctx).value).toBe(true);
    expect(evalIf("inputs.MY_VAR == 'world'", ctx).value).toBe(false);
  });

  it("returns unknown for unsupported context references", () => {
    const result = evalIf("github.unknown_key == 'foo'", ctx);
    expect(result.value).toBe("unknown");
  });

  it("returns unknown for unsupported functions", () => {
    const result = evalIf("toJSON(github)", ctx);
    expect(result.value).toBe("unknown");
  });
});

/* -------------------------------------------------------------------------- */
/* CI / Release sample — push to main                                          */
/* -------------------------------------------------------------------------- */

describe("ci-release: push to refs/heads/main", () => {
  const ir = parseSample("ci-release");

  it("triggers the workflow", () => {
    const result = simulateEvent(ir, { event: "push", ref: "refs/heads/main" });
    expect(result.triggered).toBe(true);
    expect(result.matchedTrigger).toBe("push");
  });

  it("all four jobs run", () => {
    const result = simulateEvent(ir, { event: "push", ref: "refs/heads/main" });
    expect(result.jobs["lint"]?.decision).toBe("run");
    expect(result.jobs["test"]?.decision).toBe("run");
    expect(result.jobs["build"]?.decision).toBe("run");
    expect(result.jobs["deploy"]?.decision).toBe("run");
  });
});

/* -------------------------------------------------------------------------- */
/* CI / Release sample — push to feature branch                               */
/* -------------------------------------------------------------------------- */

describe("ci-release: push to refs/heads/feature/my-feature", () => {
  const ir = parseSample("ci-release");

  it("does NOT trigger the workflow via push (main-only branch filter)", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/heads/feature/my-feature",
    });
    // The push trigger requires branches: [main]; a feature branch does not match.
    // pull_request and workflow_dispatch also exist but are different events.
    expect(result.triggered).toBe(false);
  });

  it("all jobs are skipped when push does not trigger", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/heads/feature/my-feature",
    });
    for (const dec of Object.values(result.jobs)) {
      expect(dec.decision).toBe("skip");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* CI / Release sample — pull_request event                                   */
/* -------------------------------------------------------------------------- */

describe("ci-release: pull_request event", () => {
  const ir = parseSample("ci-release");

  it("triggers the workflow", () => {
    const result = simulateEvent(ir, {
      event: "pull_request",
      ref: "refs/heads/feature/my-feature",
      baseRef: "refs/heads/main",
    });
    expect(result.triggered).toBe(true);
    expect(result.matchedTrigger).toBe("pull_request");
  });

  it("all four jobs run", () => {
    const result = simulateEvent(ir, {
      event: "pull_request",
      ref: "refs/heads/feature/my-feature",
      baseRef: "refs/heads/main",
    });
    expect(result.jobs["lint"]?.decision).toBe("run");
    expect(result.jobs["test"]?.decision).toBe("run");
    expect(result.jobs["build"]?.decision).toBe("run");
    expect(result.jobs["deploy"]?.decision).toBe("run");
  });
});

/* -------------------------------------------------------------------------- */
/* workflow_dispatch event                                                      */
/* -------------------------------------------------------------------------- */

describe("ci-release: workflow_dispatch event", () => {
  const ir = parseSample("ci-release");

  it("triggers the workflow", () => {
    const result = simulateEvent(ir, {
      event: "workflow_dispatch",
      ref: "refs/heads/main",
    });
    expect(result.triggered).toBe(true);
    expect(result.matchedTrigger).toBe("workflow_dispatch");
  });
});

/* -------------------------------------------------------------------------- */
/* Crafted workflow: job-level if: github.event_name == 'push'                */
/* -------------------------------------------------------------------------- */

const conditionalYaml = `name: Conditional Job

on:
  push:
  pull_request:

jobs:
  always-runs:
    runs-on: ubuntu-latest
    steps:
      - run: echo always

  push-only:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    steps:
      - run: echo push only

  pr-only:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - run: echo pr only

  depends-on-push-only:
    runs-on: ubuntu-latest
    needs: [push-only]
    steps:
      - run: echo downstream
`;

describe("conditional job if: github.event_name == 'push'", () => {
  const { ir, ok } = parseWorkflow(conditionalYaml, {
    path: ".github/workflows/conditional.yml",
  });
  expect(ok).toBe(true);

  it("on push: push-only runs, pr-only skips", () => {
    const result = simulateEvent(ir, { event: "push", ref: "refs/heads/main" });
    expect(result.triggered).toBe(true);
    expect(result.jobs["always-runs"]?.decision).toBe("run");
    expect(result.jobs["push-only"]?.decision).toBe("run");
    expect(result.jobs["pr-only"]?.decision).toBe("skip");
    expect(result.jobs["depends-on-push-only"]?.decision).toBe("run");
  });

  it("on pull_request: push-only skips, pr-only runs, downstream skips", () => {
    const result = simulateEvent(ir, {
      event: "pull_request",
      ref: "refs/heads/feature/x",
      baseRef: "refs/heads/main",
      action: "opened",
    });
    expect(result.triggered).toBe(true);
    expect(result.jobs["always-runs"]?.decision).toBe("run");
    expect(result.jobs["push-only"]?.decision).toBe("skip");
    expect(result.jobs["pr-only"]?.decision).toBe("run");
    // depends-on-push-only depends on push-only which was skipped
    expect(result.jobs["depends-on-push-only"]?.decision).toBe("skip");
    expect(result.jobs["depends-on-push-only"]?.reason).toContain("push-only");
  });
});

/* -------------------------------------------------------------------------- */
/* always() in if expression — job runs even when dependency skipped           */
/* -------------------------------------------------------------------------- */

const alwaysYaml = `name: Always Test

on:
  push:
  pull_request:

jobs:
  conditional:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    steps:
      - run: echo conditional

  always-notifier:
    runs-on: ubuntu-latest
    needs: [conditional]
    if: always()
    steps:
      - run: echo always runs
`;

describe("always() propagation", () => {
  const { ir, ok } = parseWorkflow(alwaysYaml, {
    path: ".github/workflows/always.yml",
  });
  expect(ok).toBe(true);

  it("on pull_request: conditional skips, always-notifier still runs", () => {
    const result = simulateEvent(ir, {
      event: "pull_request",
      ref: "refs/heads/feature/x",
    });
    expect(result.triggered).toBe(true);
    expect(result.jobs["conditional"]?.decision).toBe("skip");
    expect(result.jobs["always-notifier"]?.decision).toBe("run");
  });

  it("on push: both jobs run", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/heads/main",
    });
    expect(result.triggered).toBe(true);
    expect(result.jobs["conditional"]?.decision).toBe("run");
    expect(result.jobs["always-notifier"]?.decision).toBe("run");
  });
});

/* -------------------------------------------------------------------------- */
/* pull_request with activity type filter                                       */
/* -------------------------------------------------------------------------- */

const typedYaml = `name: Typed PR

on:
  pull_request:
    types: [opened, reopened]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: echo check
`;

describe("pull_request with types filter", () => {
  const { ir, ok } = parseWorkflow(typedYaml, {
    path: ".github/workflows/typed-pr.yml",
  });
  expect(ok).toBe(true);

  it("triggers on 'opened'", () => {
    const result = simulateEvent(ir, { event: "pull_request", action: "opened" });
    expect(result.triggered).toBe(true);
  });

  it("does not trigger on 'synchronize'", () => {
    const result = simulateEvent(ir, {
      event: "pull_request",
      action: "synchronize",
    });
    expect(result.triggered).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* push with tag filter                                                         */
/* -------------------------------------------------------------------------- */

const tagYaml = `name: Release on tag

on:
  push:
    tags: ["v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
`;

describe("push with tags filter", () => {
  const { ir, ok } = parseWorkflow(tagYaml, {
    path: ".github/workflows/tag.yml",
  });
  expect(ok).toBe(true);

  it("triggers on a matching tag ref", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/tags/v1.2.3",
    });
    expect(result.triggered).toBe(true);
    expect(result.jobs["release"]?.decision).toBe("run");
  });

  it("does not trigger on a branch push", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/heads/main",
    });
    expect(result.triggered).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* paths filter                                                                 */
/* -------------------------------------------------------------------------- */

const pathsYaml = `name: Docs

on:
  push:
    paths: ["docs/**", "*.md"]

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - run: echo docs
`;

describe("push with paths filter", () => {
  const { ir, ok } = parseWorkflow(pathsYaml, {
    path: ".github/workflows/docs.yml",
  });
  expect(ok).toBe(true);

  it("triggers when a matching path changed", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/heads/main",
      changedPaths: ["docs/guide.md", "src/index.ts"],
    });
    expect(result.triggered).toBe(true);
  });

  it("triggers on a root markdown file", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/heads/main",
      changedPaths: ["README.md"],
    });
    expect(result.triggered).toBe(true);
  });

  it("does not trigger when no matching path changed", () => {
    const result = simulateEvent(ir, {
      event: "push",
      ref: "refs/heads/main",
      changedPaths: ["src/index.ts", "test/foo.test.ts"],
    });
    expect(result.triggered).toBe(false);
  });
});
