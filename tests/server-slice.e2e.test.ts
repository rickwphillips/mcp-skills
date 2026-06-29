import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// End-to-end: boots the compiled server over stdio and asserts tools/list per
// MCP_SKILLS_SELECT slice. This is the only test that exercises the real
// StdioServerTransport wiring (the unit tests in tool-select.test.ts cover the
// parser and filter in isolation). Requires a build, so beforeAll runs it.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(repoRoot, "dist", "server.js");

const ALWAYS_ON = ["get_version", "check_for_updates", "list_tool_groups"];
const DB_TOOLS = ["list_db_connections", "db_read", "db_write"];
const PDF_TOOLS = [
  "pdf_merge",
  "pdf_split",
  "pdf_extract_text",
  "pdf_rotate",
  "pdf_watermark",
  "pdf_encrypt",
  "pdf_decrypt",
];

// Spawn the built server with the given selector and return its advertised tool
// names. select === null => MCP_SKILLS_SELECT deleted from the child env.
function listTools(select: string | null): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (select === null) delete env.MCP_SKILLS_SELECT;
    else env.MCP_SKILLS_SELECT = select;

    const child = spawn(process.execPath, [serverEntry], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let out = "";
    let stderr = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);

    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1" },
      },
    });
    setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list" }), 300);

    setTimeout(() => {
      const names: string[] = [];
      for (const line of out.split("\n")) {
        try {
          const m = JSON.parse(line);
          if (m.id === 2 && m.result?.tools) {
            names.push(...m.result.tools.map((t: { name: string }) => t.name));
          }
        } catch {
          /* non-JSON log line */
        }
      }
      child.kill();
      if (names.length === 0) {
        reject(new Error(`no tools/list response. stderr:\n${stderr}`));
        return;
      }
      resolve(names.sort());
    }, 1200);
  });
}

describe("server slice (e2e over stdio)", () => {
  beforeAll(() => {
    const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, encoding: "utf8" });
    if (build.status !== 0) {
      throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);
    }
  }, 120_000);

  it("MCP_SKILLS_SELECT=db exposes only the db slice plus always-on", async () => {
    const names = await listTools("db");
    expect(names).toEqual([...ALWAYS_ON, ...DB_TOOLS].sort());
  });

  it("MCP_SKILLS_SELECT=db,pdf exposes both slices plus always-on", async () => {
    const names = await listTools("db, pdf");
    expect(names).toEqual([...ALWAYS_ON, ...DB_TOOLS, ...PDF_TOOLS].sort());
  });

  it("unset selector exposes the full server (superset of every slice)", async () => {
    const names = await listTools(null);
    for (const t of [...ALWAYS_ON, ...DB_TOOLS, ...PDF_TOOLS]) {
      expect(names).toContain(t);
    }
    // representatives from every remaining group
    for (const t of [
      "record_audio",
      "save_journal_entry",
      "deploy",
      "summarize_mcp_errors",
      "get_boot",
    ]) {
      expect(names).toContain(t);
    }
    // full server is strictly larger than the db slice
    expect(names.length).toBeGreaterThan(DB_TOOLS.length + ALWAYS_ON.length);
  });

  it("unknown selector tokens are ignored, valid ones still apply", async () => {
    const names = await listTools("db, bogus");
    expect(names).toEqual([...ALWAYS_ON, ...DB_TOOLS].sort());
  });
});
