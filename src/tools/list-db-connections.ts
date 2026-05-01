import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConnection, listConnections } from "../config/connections.js";

function listAvailableConnections(): string {
  const names = listConnections();
  if (names.length === 0) {
    return JSON.stringify(
      {
        connections: [],
        message:
          "No connections configured. Create ~/.config/mcp-skills/config.json — see README.",
      },
      null,
      2,
    );
  }
  const detail = names.map((n) => {
    const c = getConnection(n);
    return {
      name: n,
      env: c.env ?? "dev",
      database: c.database,
      host: c.host,
      description: c.description ?? null,
    };
  });
  return JSON.stringify({ connections: detail }, null, 2);
}

export const registerListDbConnectionsTool = (server: McpServer) => {
  server.registerTool(
    "list_db_connections",
    {
      title: "List DB Connections",
      description:
        "List the database connections currently configured on the server. " +
        "Use this before db_read or db_write to know what connection names are valid.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: listAvailableConnections() }],
    }),
  );
};
