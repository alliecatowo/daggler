import { describe, expect, it } from "vitest";
import { GhCliAdapter } from "../src/gh-cli.js";
import {
  InvalidArgumentError,
  assertInputKey,
  assertRef,
  assertRepoPath,
  assertRepoRef,
  assertSha,
} from "../src/validate.js";

describe("argument validation", () => {
  it("accepts normal repo refs", () => {
    expect(() => assertRepoRef({ owner: "alliecatowo", repo: "daggler" })).not.toThrow();
    expect(() => assertRepoRef({ owner: "a-b_c", repo: "x.y" })).not.toThrow();
  });
  it.each([
    ["..", "x"],
    ["a", "."],
    ["a/b", "c"],
    ["a", "b?x=1"],
    ["-rf", "x"],
    ["", "x"],
  ])("rejects owner=%j repo=%j", (owner, repo) => {
    expect(() => assertRepoRef({ owner, repo })).toThrow(InvalidArgumentError);
  });
  it("rejects traversal and flag-like paths", () => {
    for (const p of ["../x", "a/../b", "/abs", "-flag", "a//b", "a?b=1", "a#b", ""]) {
      expect(() => assertRepoPath(p), p).toThrow(InvalidArgumentError);
    }
    expect(() => assertRepoPath(".github/workflows/ci.yml")).not.toThrow();
  });
  it("rejects bad refs and shas", () => {
    for (const r of ["--upload-pack=x", "a..b", "x y", "a/", "foo.lock", ""]) {
      expect(() => assertRef(r), r).toThrow(InvalidArgumentError);
    }
    expect(() => assertRef("feature/foo-1")).not.toThrow();
    expect(() => assertSha("zzz")).toThrow(InvalidArgumentError);
    expect(() => assertSha("abc1234")).not.toThrow();
    expect(() => assertInputKey("bad key")).toThrow(InvalidArgumentError);
  });
  it("GhCliAdapter rejects hostile arguments before spawning gh", async () => {
    const gh = new GhCliAdapter();
    const bad = { owner: "a/b/../../orgs/x?foo=", repo: "r" };
    await expect(gh.getFile(bad, "x.yml")).rejects.toThrow(/INVALID_ARGUMENT/);
    await expect(gh.listWorkflowFiles(bad)).rejects.toThrow(/INVALID_ARGUMENT/);
    await expect(
      gh.getFile({ owner: "a", repo: "b" }, "../../etc/passwd"),
    ).rejects.toThrow(/INVALID_ARGUMENT/);
    await expect(
      gh.dispatchWorkflow({ owner: "a", repo: "b" }, "ci.yml", "--help"),
    ).rejects.toThrow(/INVALID_ARGUMENT/);
  });
});
