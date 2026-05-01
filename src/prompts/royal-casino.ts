import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "royal-casino.md");

export const registerRoyalCasinoPrompt = (server: McpServer) => {
  server.registerPrompt(
    "royal-casino",
    {
      title: "Royal Casino — Project Context",
      description:
        "Working on Royal Casino — Unity card game (Casino fishing-family variant). Capture mechanics, build system, AI opponents, scoring variants, rule configuration, C# scripts, Conn-Casino tutorial reference. Loads project context.",
    },
    () => asUserMessage(BODY),
  );
};
