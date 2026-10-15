import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readSections, reJson, resolveTargetPath, runRe, toolExists } from "../src/lib/re-exec.js";

const hasRabin2 = spawnSync("rabin2", ["-v"]).status === 0;

describe("runRe", () => {
  it("captures stdout and exit code", async () => {
    const r = await runRe("sh", ["-c", "printf hi"]);
    expect(r).toEqual({ exit_code: 0, signal: null, stdout: "hi", stderr: "", timed_out: false });
  });
  it("captures stderr and a non-zero exit", async () => {
    const r = await runRe("sh", ["-c", "printf err >&2; exit 3"]);
    expect(r).toMatchObject({ exit_code: 3, stderr: "err" });
  });
  it("passes env and cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-exec-"));
    try {
      const r = await runRe("sh", ["-c", 'printf "%s %s" "$RE_TEST" "$(basename "$PWD")"'], { env: { RE_TEST: "ok" }, cwd: dir });
      expect(r.stdout).toBe(`ok ${dir.split("/").pop()}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("kills a process that outlives the timeout", async () => {
    const r = await runRe("sleep", ["5"], { timeoutMs: 100 });
    expect(r).toMatchObject({ timed_out: true, signal: "SIGKILL" });
  });
  it("reports a binary that cannot be spawned", async () => {
    const r = await runRe("/nonexistent/re-bin", []);
    expect(r).toMatchObject({ exit_code: null, timed_out: false });
    expect(r.stderr).toMatch(/Failed to spawn \/nonexistent\/re-bin/);
  });
});

describe("resolveTargetPath / toolExists", () => {
  let dir: string;
  let file: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "re-target-"));
    file = join(dir, "t.bin");
    writeFileSync(file, Buffer.alloc(16));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts a regular file", () => {
    expect(resolveTargetPath(file)).toBe(file);
    expect(toolExists(file)).toBe(true);
    expect(toolExists(join(dir, "nope"))).toBe(false);
  });
  it("rejects missing paths, directories and oversized files", () => {
    expect(() => resolveTargetPath(join(dir, "nope"))).toThrow(/File not found/);
    expect(() => resolveTargetPath(dir)).toThrow(/Not a regular file/);
    expect(() => resolveTargetPath(file, 8)).toThrow(/File too large \(16 bytes, cap 8\)/);
  });
});

describe("reJson", () => {
  it("wraps a body as pretty JSON text, flagging errors only when asked", () => {
    expect(reJson({ a: 1 })).toEqual({ content: [{ type: "text", text: '{\n  "a": 1\n}' }] });
    expect(reJson({ a: 1 }, true)).toMatchObject({ isError: true });
  });
});

describe("readSections", () => {
  it("returns [] for a file that is not a binary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-sec-"));
    try {
      const f = join(dir, "plain.txt");
      writeFileSync(f, "just text\n");
      expect(await readSections(f)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(!hasRabin2)("reads sections of a real executable", async () => {
    const secs = await readSections(process.execPath);
    expect(secs.length).toBeGreaterThan(0);
    expect(secs.some((s) => s.perm.includes("x"))).toBe(true);
  });
});
