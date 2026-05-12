import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { getConnection } from "../config/connections.js";
import { getPool } from "../lib/db-pool.js";

const inputSchema = {
  package_json_path: z
    .string()
    .describe(
      "Absolute path to the Commander Collector package.json (e.g. /Users/.../commander-collector/apps/core/package.json).",
    ),
  scope: z
    .enum(["latest", "all"])
    .optional()
    .describe("'latest' (default — newest release only) or 'all' (last 3 releases)."),
};

interface ReleaseRow {
  version: string;
  date: string;
  title: string;
}

interface ChangeRow {
  release_version: string;
  type: string;
  text: string;
}

const fetchEnv = async (connectionName: string, scope: "latest" | "all") => {
  const releaseLimit = scope === "all" ? 3 : 1;
  const changeLimit = scope === "all" ? 60 : 20;
  const pool = await getPool(connectionName);
  const conn = getConnection(connectionName);

  const [releaseRows] = await pool.query(
    `SELECT version, DATE_FORMAT(date, '%Y-%m-%d') AS date, title
     FROM changelog_releases
     ORDER BY sort_order DESC
     LIMIT ?`,
    [releaseLimit],
  );
  const [changeRows] = await pool.query(
    `SELECT r.version AS release_version, c.type, c.text
     FROM changelog_changes c
     JOIN changelog_releases r ON c.release_id = r.id
     ORDER BY r.sort_order DESC, c.sort_order ASC
     LIMIT ?`,
    [changeLimit],
  );

  return {
    env: conn.env ?? "dev",
    database: conn.database,
    releases: (releaseRows as ReleaseRow[]) ?? [],
    changes: (changeRows as ChangeRow[]) ?? [],
  };
};

export const registerCcStatusTool = (server: McpServer) => {
  server.registerTool(
    "cc_status",
    {
      title: "Commander Collector Status",
      description:
        "Compare Commander Collector's local package.json version with what's recorded in the dev and prod " +
        "changelog tables. Returns the latest release(s), changes, and any version-gap between local and DBs.",
      inputSchema,
    },
    async ({ package_json_path, scope }) => {
      const effectiveScope = scope ?? "latest";
      const errors: string[] = [];

      let local_version: string | null = null;
      try {
        const pkg = JSON.parse(readFileSync(package_json_path, "utf8"));
        local_version = pkg.version ?? null;
      } catch (err) {
        errors.push(
          `Failed to read package.json at ${package_json_path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const envs: Record<string, unknown> = {};
      for (const conn of ["commander_dev", "commander_prod"] as const) {
        try {
          envs[conn] = await fetchEnv(conn, effectiveScope);
        } catch (err) {
          envs[conn] = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      const devLatest = (envs.commander_dev as { releases?: ReleaseRow[] })?.releases?.[0]?.version ?? null;
      const prodLatest = (envs.commander_prod as { releases?: ReleaseRow[] })?.releases?.[0]?.version ?? null;

      const gap = {
        package_vs_dev:
          local_version && devLatest && local_version !== devLatest
            ? `package.json (${local_version}) differs from dev DB latest (${devLatest})`
            : null,
        package_vs_prod:
          local_version && prodLatest && local_version !== prodLatest
            ? `package.json (${local_version}) differs from prod DB latest (${prodLatest})`
            : null,
        dev_vs_prod:
          devLatest && prodLatest && devLatest !== prodLatest
            ? `dev DB (${devLatest}) differs from prod DB (${prodLatest})`
            : null,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                scope: effectiveScope,
                local_version,
                envs,
                gap,
                errors: errors.length ? errors : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};
