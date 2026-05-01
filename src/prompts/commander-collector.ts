import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "commander-collector.md");

export const registerCommanderCollectorPrompt = (server: McpServer) => {
  server.registerPrompt(
    "commander-collector",
    {
      title: "Commander Collector — Project Context",
      description:
        "Working on the Commander Collector MTG game tracking app — decks, commanders, stats, mana symbols, comparison panels, PHP endpoints. Loads project context.",
    },
    () => asUserMessage(BODY),
  );
};
