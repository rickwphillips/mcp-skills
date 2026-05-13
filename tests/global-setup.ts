import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Vitest global setup. Runs once before all tests in the process.
// We allocate a fresh temp dir for MCP_SKILLS_HOME so audit/log writes
// from tests don't touch the real ~/.local/share/mcp-skills tree.
export default function () {
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
