import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "mtg-rules-guru.md");

export const registerMtgRulesGuruPrompt = (server: McpServer) => {
  server.registerPrompt(
    "mtg-rules-guru",
    {
      title: "MTG Rules Guru",
      description:
        "Answer Magic: The Gathering rules questions, card interactions, priority and stack mechanics, combat, triggers, state-based actions, keywords, and Commander-specific rules.",
    },
    () => asUserMessage(BODY),
  );
};
