import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getVersionInfo } from "../version.js";
import { listConnections, getConnection } from "../config/connections.js";
import { getMcpHealth } from "../lib/audit-patterns.js";
import { logger, AUDIT_DIR } from "../lib/logger.js";

interface BootResponse {
  name: string;
  version: string;
  log: {
    level: string;
    file: string | null;
    file_enabled: boolean;
  };
  audit: {
    enabled: boolean;
    dir: string;
  };
  connections: Array<{ name: string; env: string; database: string; via_ssh: boolean }>;
  recent_changelog: Array<{ version: string; date: string }>;
  mcp_health?: NonNullable<ReturnType<typeof getMcpHealth>>;
}

function buildBoot(): BootResponse {
  const version = getVersionInfo();
  const conns = listConnections().map((name) => {
    const c = getConnection(name);
    return {
      name,
      env: c.env ?? "dev",
      database: c.database,
      via_ssh: Boolean(c.ssh),
    };
  });

  const response: BootResponse = {
    name: version.name,
    version: version.version,
    log: {
      level: logger.level,
      file: logger.fileEnabled ? logger.filePath : null,
      file_enabled: logger.fileEnabled,
    },
    audit: {
      enabled: logger.auditEnabled,
      dir: AUDIT_DIR,
    },
    connections: conns,
    recent_changelog: version.changelog_recent.slice(0, 3).map((c) => ({
      version: c.version,
      date: c.date,
    })),
  };

  // Quiet by default: only attach mcp_health when there are open patterns
  const health = getMcpHealth();
  if (health) response.mcp_health = health;

  return response;
}

export function registerGetBootTool(server: McpServer): void {
  server.registerTool(
    "get_boot",
    {
      title: "Boot Aggregate",
      description:
        "Returns the canonical fresh-agent context for mcp-skills: server name+version, log + audit paths, " +
        "configured DB connection names (dev + prod, with ssh-tunnel flag), and the 3 most recent CHANGELOG entries. " +
        "Quietly attaches an `mcp_health` block when there are open error patterns (omitted entirely when nothing is wrong). " +
        "Call this once per session at the start to surface anything an agent should know up front.",
      inputSchema: {},
    },
    async () => {
      const data = buildBoot();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
