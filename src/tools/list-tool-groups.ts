import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALWAYS_ON, GROUPS, TOOL_GROUPS } from "../tool-groups.js";
import type { Selector } from "../tool-select.js";

// Always-on introspection for the slicing system. registeredNames is the live
// array applySliceFilter appends to as tools register; by the time this tool's
// callback runs (request time) startup registration is complete, so it reflects
// exactly what this process exposes, not just what was requested.
export function registerListToolGroupsTool(
  server: McpServer,
  selector: Selector,
  registeredNames: string[],
): void {
  server.registerTool(
    "list_tool_groups",
    {
      title: "List Tool Groups",
      description:
        "Introspection for the MCP_SKILLS_SELECT tool-slicing system. Reports the " +
        "available groups and their tools, the always-on tools, the active selector, " +
        "any unrecognized selector tokens, and the tool names that actually registered " +
        "in this process. Available in every slice.",
      inputSchema: {},
    },
    async () => {
      const byGroup: Record<string, string[]> = {};
      for (const g of GROUPS) byGroup[g] = [];
      for (const [name, g] of Object.entries(TOOL_GROUPS)) {
        (byGroup[g] ??= []).push(name);
      }
      const payload = {
        selector: selector.matchAll ? "ALL" : selector.raw,
        unknownTokens: selector.unknown,
        alwaysOn: ALWAYS_ON,
        groups: byGroup,
        registered: [...registeredNames].sort(),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
