import { describe, it, expect, vi, beforeEach } from "vitest";

const runRe = vi.fn();
const toolExists = vi.fn();
vi.mock("../src/lib/re-exec.js", () => ({
  runRe: (...a: unknown[]) => runRe(...a),
  toolExists: (...a: unknown[]) => toolExists(...a),
  RE_TOOLS: { ghidraHeadless: "/fake/analyzeHeadless", ghidraScriptsDir: "/fake/scripts", ghidraJavaHome: "/fake/jdk" },
}));

const { extractMarkedBlocks, scriptLines, parseXrefDecompileOutput, runGhidraHeadless } = await import(
  "../src/lib/ghidra-headless.js"
);

// What Ghidra's headless logger actually prints: one prefix/suffix per println()
// call, so the multi-line C body only carries them at its first and last line.
const log = [
  "INFO  Opening project (HeadlessProject)  ",
  "INFO  XrefDecompile.java> STRING: 10008bd8 InstallHook: thread = %d (GhidraScript)  ",
  "INFO  XrefDecompile.java> STRING: 10008c00 lone (GhidraScript)  ",
  "INFO  XrefDecompile.java> ===MCP_SKILLS_XREF_START=== (GhidraScript)  ",
  "INFO  XrefDecompile.java> FUNCTION: FUN_100026f0 @ 100026f0 (GhidraScript)  ",
  "INFO  XrefDecompile.java> REFS: 10002751,10002790 (GhidraScript)  ",
  "INFO  XrefDecompile.java> ",
  "void FUN_100026f0(void)",
  "{",
  "  return;",
  "}",
  " (GhidraScript)  ",
  "INFO  XrefDecompile.java> ===MCP_SKILLS_XREF_END=== (GhidraScript)  ",
  "INFO  XrefDecompile.java> ===MCP_SKILLS_XREF_START=== (GhidraScript)  ",
  "INFO  XrefDecompile.java> FUNCTION: weird name @ 0x42 (GhidraScript)  ",
  "INFO  XrefDecompile.java> int f(void) { return 1; } (GhidraScript)  ",
  "INFO  XrefDecompile.java> ===MCP_SKILLS_XREF_END=== (GhidraScript)  ",
  "INFO  XrefDecompile.java> SUMMARY: strings=2 functions=3 decompiled=2 (GhidraScript)  ",
].join("\n");

describe("extractMarkedBlocks / scriptLines", () => {
  it("returns every block with logger decoration stripped", () => {
    const blocks = extractMarkedBlocks(log, "XrefDecompile.java", "===MCP_SKILLS_XREF_START===", "===MCP_SKILLS_XREF_END===");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe(
      "FUNCTION: FUN_100026f0 @ 100026f0\nREFS: 10002751,10002790\nvoid FUN_100026f0(void)\n{\n  return;\n}",
    );
  });
  it("stops at an unterminated block", () => {
    expect(extractMarkedBlocks("A x B A y", "S.java", "A", "B")).toEqual(["x"]);
    expect(extractMarkedBlocks("nothing here", "S.java", "A", "B")).toEqual([]);
  });
  it("collects tagged single-line values", () => {
    expect(scriptLines(log, "XrefDecompile.java", "SUMMARY: ")).toEqual(["strings=2 functions=3 decompiled=2"]);
    expect(scriptLines(log, "XrefDecompile.java", "ERROR: ")).toEqual([]);
  });
});

describe("parseXrefDecompileOutput", () => {
  it("parses strings, functions, refs and the total", () => {
    const out = parseXrefDecompileOutput(log);
    expect(out.error).toBeNull();
    expect(out.referencingFunctionsTotal).toBe(3);
    expect(out.strings).toEqual([
      { address: "10008bd8", value: "InstallHook: thread = %d" },
      { address: "10008c00", value: "lone" },
    ]);
    expect(out.functions[0]).toEqual({
      function: "FUN_100026f0",
      entry: "100026f0",
      referencing_instructions: ["10002751", "10002790"],
      pseudocode: "void FUN_100026f0(void)\n{\n  return;\n}",
    });
    expect(out.functions[1]).toMatchObject({ function: "weird name", entry: "0x42", referencing_instructions: [] });
  });
  it("handles a string line with no value, an error, and a run that never finished", () => {
    const out = parseXrefDecompileOutput(
      "INFO  XrefDecompile.java> STRING: 1000 (GhidraScript)\nINFO  XrefDecompile.java> ERROR: missing substring argument (GhidraScript)",
    );
    expect(out.strings).toEqual([{ address: "1000", value: "" }]);
    expect(out.error).toBe("missing substring argument");
    expect(out.referencingFunctionsTotal).toBeNull();
    expect(parseXrefDecompileOutput("INFO  XrefDecompile.java> SUMMARY: garbled (GhidraScript)").referencingFunctionsTotal).toBeNull();
  });
});

describe("runGhidraHeadless", () => {
  beforeEach(() => {
    runRe.mockReset();
    toolExists.mockReset().mockReturnValue(true);
  });

  it("reports a missing Ghidra install without spawning", async () => {
    toolExists.mockReturnValue(false);
    const r = await runGhidraHeadless("/t", "S.java", []);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Ghidra not found/) });
    expect(runRe).not.toHaveBeenCalled();
  });

  it("passes the script, args and JAVA_HOME through and returns stdout", async () => {
    runRe.mockResolvedValue({ exit_code: 0, signal: null, stdout: "out", stderr: "", timed_out: false });
    const r = await runGhidraHeadless("/t", "S.java", ["a", "b"], { timeoutMs: 5 });
    expect(r).toEqual({ ok: true, stdout: "out" });
    const [bin, args, opts] = runRe.mock.calls[0];
    expect(bin).toBe("/fake/analyzeHeadless");
    expect(args).toEqual(expect.arrayContaining(["-import", "/t", "-postScript", "S.java", "a", "b", "-deleteProject"]));
    expect(opts).toEqual({ timeoutMs: 5, env: { JAVA_HOME: "/fake/jdk" } });
  });

  it("reports timeouts and non-zero exits", async () => {
    runRe.mockResolvedValueOnce({ exit_code: null, signal: "SIGKILL", stdout: "", stderr: "", timed_out: true });
    expect(await runGhidraHeadless("/t", "S.java", [])).toMatchObject({ ok: false, error: expect.stringMatching(/timed out \(120000ms\)/) });
    runRe.mockResolvedValueOnce({ exit_code: 1, signal: null, stdout: "", stderr: "  boom  ", timed_out: false });
    expect(await runGhidraHeadless("/t", "S.java", [])).toMatchObject({ ok: false, error: "boom" });
    runRe.mockResolvedValueOnce({ exit_code: 2, signal: null, stdout: "", stderr: "", timed_out: false });
    expect(await runGhidraHeadless("/t", "S.java", [])).toMatchObject({ ok: false, error: "analyzeHeadless exit 2" });
  });
});
