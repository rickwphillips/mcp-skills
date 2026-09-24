import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Vitest global setup. Runs once before all tests in the process.
// We allocate a fresh temp dir for MCP_SKILLS_HOME so audit/log writes
// from tests don't touch the real ~/.local/share/mcp-skills tree.
export default function () {
  // Emit src/generated/ops-console-html.ts (gitignored) so tests that import
  // the app resource registrar work on a fresh clone. Sub-second esbuild run.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const bundle = spawnSync(process.execPath, ["scripts/build-apps.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (bundle.status !== 0) {
    throw new Error(`build-apps failed:\n${bundle.stdout}\n${bundle.stderr}`);
  }

  const root = mkdtempSync(join(tmpdir(), "mcp-skills-test-"));
  process.env.MCP_SKILLS_HOME = root;

  return () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };
}
