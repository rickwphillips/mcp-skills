import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkForUpdates } from "../update-check.js";

export const registerCheckForUpdatesTool = (server: McpServer) => {
  server.registerTool(
    "check_for_updates",
    {
      title: "Check For Updates",
      description:
        "Force a fresh check of GitHub for a newer mcp-skills release (bypasses the 1-hour cache). " +
        "Returns the current version, latest tag/release, and an upgrade command if behind. Never runs the upgrade itself — ask the user first.",
      inputSchema: {},
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify(await checkForUpdates(true), null, 2) },
      ],
    }),
  );
};
