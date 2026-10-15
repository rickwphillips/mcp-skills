import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRe, RE_TOOLS, toolExists } from "./re-exec.js";

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
