import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRe, RE_TOOLS, toolExists } from "./re-exec.js";

/**
 * Pulls every START..END block a GhidraScript printed, with the headless
 * logger's decoration removed. The logger wraps a println() CALL, not each
 * line: a multi-line call only gets the "INFO  <Script>.java> " prefix once at
 * its start and " (GhidraScript)" once at its end, so both are stripped
 * globally rather than per line.
 */
export function extractMarkedBlocks(stdout: string, scriptName: string, start: string, end: string): string[] {
  const prefix = new RegExp(`(^|\\n)INFO\\s+${scriptName.replace(/\./g, "\\.")}>\\s?`, "g");
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const s = stdout.indexOf(start, from);
    if (s === -1) break;
    const e = stdout.indexOf(end, s + start.length);
    if (e === -1) break;
    blocks.push(
      stdout
        .slice(s + start.length, e)
        .replace(prefix, "\n")
        .replace(/\s*\(GhidraScript\)\s*(\n|$)/g, "$1")
        .trim(),
    );
    from = e + end.length;
  }
  return blocks;
}

/** Single-line println() values a script emitted with the given tag, e.g. "STRING: ". */
export function scriptLines(stdout: string, scriptName: string, tag: string): string[] {
  const marker = `${scriptName}> ${tag}`;
  return stdout
    .split("\n")
    .filter((l) => l.includes(marker))
    .map((l) => l.slice(l.indexOf(marker) + marker.length).replace(/\s*\(GhidraScript\)\s*$/, ""));
}

/**
 * Runs Ghidra's headless analyzer against a single binary with one
 * post-script, in a throwaway project directory that is always cleaned up.
 *
 * Ghidra's own `-deleteProject` flag handles the project itself; we still
 * create and remove a dedicated tmp dir per call so concurrent calls never
 * collide and nothing lingers on disk if Ghidra crashes mid-run.
 */
export async function runGhidraHeadless(
  target: string,
  scriptName: string,
  scriptArgs: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: true; stdout: string } | { ok: false; error: string; stdout: string }> {
  if (!toolExists(RE_TOOLS.ghidraHeadless)) {
    return {
      ok: false,
      stdout: "",
      error: `Ghidra not found at ${RE_TOOLS.ghidraHeadless}. Expected an extracted Ghidra install under ~/tools/ghidra.`,
    };
  }
  // The scripts ship with this package, so a missing one means a broken or
  // partial install rather than anything about the target binary.
  const scriptPath = join(RE_TOOLS.ghidraScriptsDir, scriptName);
  if (!toolExists(scriptPath)) {
    return { ok: false, stdout: "", error: `Bundled Ghidra script missing: ${scriptPath}` };
  }

  const projectDir = await mkdtemp(join(tmpdir(), "mcp-skills-ghidra-"));
  try {
    const result = await runRe(
      RE_TOOLS.ghidraHeadless,
      [
        projectDir,
        "mcp_skills_proj",
        "-import",
        target,
        "-scriptPath",
        RE_TOOLS.ghidraScriptsDir,
        "-postScript",
        scriptName,
        ...scriptArgs,
        "-deleteProject",
      ],
      {
        timeoutMs: opts.timeoutMs ?? 120_000,
        env: { JAVA_HOME: RE_TOOLS.ghidraJavaHome },
      },
    );

    if (result.timed_out) {
      return { ok: false, stdout: result.stdout, error: `Ghidra headless run timed out (${opts.timeoutMs ?? 120_000}ms)` };
    }
    if (result.exit_code !== 0) {
      return { ok: false, stdout: result.stdout, error: result.stderr.trim() || `analyzeHeadless exit ${result.exit_code}` };
    }
    return { ok: true, stdout: result.stdout };
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

export type XrefDecompileOutput = {
  error: string | null;
  strings: { address: string; value: string }[];
  functions: { function: string | null; entry: string | null; referencing_instructions: string[]; pseudocode: string }[];
  referencingFunctionsTotal: number | null;
};

/** Parses XrefDecompile.java's output. `referencingFunctionsTotal` is null when the run never finished. */
export function parseXrefDecompileOutput(stdout: string): XrefDecompileOutput {
  const script = "XrefDecompile.java";
  const error = scriptLines(stdout, script, "ERROR: ")[0] ?? null;
  const summary = scriptLines(stdout, script, "SUMMARY: ")[0];
  const total = summary ? Number(/functions=(\d+)/.exec(summary)?.[1]) : null;
  const strings = scriptLines(stdout, script, "STRING: ").map((l) => {
    const sp = l.indexOf(" ");
    return sp === -1 ? { address: l, value: "" } : { address: l.slice(0, sp), value: l.slice(sp + 1) };
  });
  const functions = extractMarkedBlocks(stdout, script, "===MCP_SKILLS_XREF_START===", "===MCP_SKILLS_XREF_END===").map(
    (block) => {
      const name = /^FUNCTION:\s*(.+?)\s*@\s*(\S+)/m.exec(block);
      const refs = /^REFS:\s*(.*)$/m.exec(block);
      return {
        function: name?.[1] ?? null,
        entry: name?.[2] ?? null,
        referencing_instructions: refs?.[1] ? refs[1].split(",") : [],
        pseudocode: block.replace(/^FUNCTION:.*\n?/m, "").replace(/^REFS:.*\n?/m, "").trim(),
      };
    },
  );
  return { error, strings, functions, referencingFunctionsTotal: total === null || Number.isNaN(total) ? null : total };
}
