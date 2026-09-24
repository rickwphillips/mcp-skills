import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { z } from "zod";
import { PROJECTS, type ProjectDef } from "../config/projects.js";
import { OPS_CONSOLE_TOOL_META } from "../config/apps.js";
import {
  listConnections,
  listPlaywrightTargets,
  getPlaywrightTarget,
} from "../config/connections.js";
import { fetchLatestChangelogVersion } from "../lib/changelog.js";
import {
  buildFleetPayload,
  parseGitStatus,
  summarizeFleet,
  type FleetProjectInput,
} from "../lib/fleet.js";
import { getVersionInfo } from "../version.js";

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const gitStatusAsync = (cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn("git", ["status", "--porcelain=v1", "-b"], { cwd });
    let out = "";
    let errOut = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (errOut += d.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(errOut.trim() || `git exited ${code}`)),
    );
  });

const gatherProject = async (project: ProjectDef): Promise<FleetProjectInput> => {
  const notes: string[] = [];
  const input: FleetProjectInput = {
    name: project.name,
    localVersion: null,
    git: null,
    notes,
  };

  if (!existsSync(project.repoDir)) {
    notes.push(`repo not present on this machine (${project.repoDir})`);
    return input;
  }

  try {
    const pkg = JSON.parse(readFileSync(project.packageJsonPath, "utf8"));
    input.localVersion = pkg.version ?? null;
    if (!input.localVersion) notes.push("package.json has no version field");
  } catch (err) {
    notes.push(`failed to read package.json: ${errMsg(err)}`);
  }

  try {
    input.git = parseGitStatus(await gitStatusAsync(project.repoDir));
  } catch (err) {
    notes.push(`git status failed: ${errMsg(err)}`);
  }

  if (project.changelogConnections) {
    const configured = new Set(listConnections());
    const { dev, prod } = project.changelogConnections;
    if (configured.has(dev) || configured.has(prod)) {
      const fetchOne = async (conn: string): Promise<string | null> => {
        if (!configured.has(conn)) return null;
        try {
          return await fetchLatestChangelogVersion(conn);
        } catch (err) {
          notes.push(`changelog lookup on ${conn} failed: ${errMsg(err)}`);
          return null;
        }
      };
      input.changelog = {
        dev: await fetchOne(dev),
        prod: await fetchOne(prod),
      };
    } else {
      notes.push("changelog connections not configured on this machine");
    }
  }

  if (project.playwrightTargets) {
    const configured = new Set(listPlaywrightTargets());
    const resolve = (name?: string): string | undefined =>
      name && configured.has(name) ? getPlaywrightTarget(name).base_url : undefined;
    const urls = {
      dev: resolve(project.playwrightTargets.dev),
      prod: resolve(project.playwrightTargets.prod),
    };
    if (urls.dev || urls.prod) input.urls = urls;
  }

  return input;
};

export const gatherFleet = async () => {
  const inputs = await Promise.all(PROJECTS.map((p) => gatherProject(p)));
  return buildFleetPayload(
    getVersionInfo().version,
    new Date().toISOString(),
    inputs,
  );
};

export const registerOpsConsoleTool = (server: McpServer) => {
  server.registerTool(
    "ops_console",
    {
      title: "Ops Console",
      description:
        "Interactive fleet console (MCP Apps). In hosts that support MCP Apps this renders an in-conversation " +
        "UI; everywhere it returns the same fleet status as text plus structuredContent: per-project local " +
        "version, git branch and dirty state, commander dev/prod changelog versions with gaps, and target URLs.",
      inputSchema: {},
      outputSchema: {
        generatedAt: z.string(),
        serverVersion: z.string(),
        projects: z.array(z.object({ name: z.string() }).passthrough()),
      },
      _meta: OPS_CONSOLE_TOOL_META,
    },
    async () => {
      const payload = await gatherFleet();
      return {
        content: [{ type: "text", text: summarizeFleet(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
};
