import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(pkgDir, "src", "cli.ts");

const BAD = `name: bad
on: pull_request_target
jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
      - run: echo "\${{ github.event.pull_request.title }}"
`;

const GOOD = `name: good
on: push
permissions:
  contents: read
jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - run: echo hi
`;

let root: string;
let badFile: string;
let goodFile: string;

function cli(...args: string[]) {
  const res = spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd: pkgDir, // so `--import tsx` resolves from the package
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: res.status, out: res.stdout, err: res.stderr, all: res.stdout + res.stderr };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "daggler-cli-"));
  const wf = path.join(root, ".github", "workflows");
  fs.mkdirSync(wf, { recursive: true });
  badFile = path.join(wf, "bad.yml");
  goodFile = path.join(wf, "good.yml");
  fs.writeFileSync(badFile, BAD);
  fs.writeFileSync(goodFile, GOOD);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("daggler cli", () => {
  it("prints the version", () => {
    const r = cli("--version");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/daggler v\d+\.\d+\.\d+/);
  });

  it("rejects unknown commands", () => {
    const r = cli("bogus");
    expect(r.code).toBe(1);
    expect(r.all).toContain("Unknown command: bogus");
  });

  it("lint exits 1 and reports policy findings for an unsafe workflow", () => {
    const r = cli("lint", "--no-color", badFile);
    expect(r.code).toBe(1);
    expect(r.out).toContain("POL007");
    expect(r.out).toContain("POL008");
  });

  it("lint --json is machine readable and clean for a safe workflow", () => {
    const r = cli("lint", "--json", goodFile);
    expect(r.code).toBe(0);
    const [report] = JSON.parse(r.out);
    expect(report.security.grade).toBe("A");
    expect(report.counts.total).toBe(0);
  });

  it("lint discovers .github/workflows in a directory", () => {
    const r = cli("lint", "--json", root);
    const files = JSON.parse(r.out).map((f: { file: string }) => path.basename(f.file));
    expect(files.sort()).toEqual(["bad.yml", "good.yml"]);
    expect(r.code).toBe(1);
  });

  it("verify --json reports the daggler section", () => {
    const r = cli("verify", "--json", goodFile);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)[0].daggler.security.grade).toBe("A");
  });

  it("map lists every workflow with triggers and grade", () => {
    const r = cli("map", root);
    expect(r.out).toContain(".github/workflows/bad.yml");
    expect(r.out).toContain("pull_request_target");
    expect(r.out).toContain(".github/workflows/good.yml");
  });

  it("search without a query prints usage", () => {
    const r = cli("search");
    expect(r.code).toBe(1);
    expect(r.all).toContain("Usage: daggler search");
  });

  it("logs without a run id prints usage", () => {
    const r = cli("logs");
    expect(r.code).not.toBe(0);
    expect(r.all).toContain("Usage: daggler logs");
  });

  it("run without a file prints usage", () => {
    const r = cli("run");
    expect(r.code).toBe(1);
    expect(r.all).toContain("Usage: daggler run");
  });
});

describe("run: flag values are not mistaken for the workflow file", () => {
  it("reports the real file when --repo precedes it", async () => {
    const { runRun } = await import("../src/run.js");
    let err = "";
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      err += String(c);
      return true;
    });
    try {
      expect(await runRun(["--repo", "o/r", "does-not-exist.yml"])).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(err).toContain("does-not-exist.yml");
    expect(err).not.toContain("o/r:");
  });
});
