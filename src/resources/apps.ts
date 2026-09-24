import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OPS_CONSOLE_HTML } from "../generated/ops-console-html.js";
import { OPS_CONSOLE_URI, APP_HTML_MIME } from "../config/apps.js";

// ui:// resources for the MCP Apps slice. Registered from server.ts behind the
// `apps` group gate (NOT part of registerResources / the "resources" group, and
// NOT inside registerTools — the tool-select test stub only implements
// registerTool).
export const registerAppResources = (server: McpServer) => {
  server.registerResource(
    "ops-console",
    OPS_CONSOLE_URI,
    {
      title: "Ops Console UI",
      description:
        "Self-contained HTML app rendered by MCP Apps hosts for the ops_console tool.",
      mimeType: APP_HTML_MIME,
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: APP_HTML_MIME, text: OPS_CONSOLE_HTML },
      ],
    }),
  );
};
