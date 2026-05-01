import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getVersionInfo } from "../version.js";
import { checkForUpdates } from "../update-check.js";

export const registerGetVersionTool = (server: McpServer) => {
  server.registerTool(
    "get_version",
    {
      title: "Get Version",
      description:
        "Returns the mcp-skills server version, recent CHANGELOG entries, and the result of the latest update check (cached up to 1 hour). " +
        "Call this at session start. If `update_status` is 'behind', surface the message to the user and ask before running `upgrade_command`.",
      inputSchema: {},
    },
    async () => {
      const info = getVersionInfo();
      const updateCheck = await checkForUpdates(false);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...info, update_check: updateCheck }, null, 2),
          },
        ],
      };
    },
  );
};
