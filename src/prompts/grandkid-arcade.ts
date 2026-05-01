import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "grandkid-arcade.md");

export const registerGrandkidArcadePrompt = (server: McpServer) => {
  server.registerPrompt(
    "grandkid-arcade",
    {
      title: "Grandkid Arcade — Project Context",
      description:
        "Working on the Grandkid Arcade kids' games app — WinBadge, Connect 4, jigsaw, hangman, word search, slide puzzle, picture matcher, math flash cards, simon says, whack-a-mole, game registry, floating love messages, admin pages. Loads project context.",
    },
    () => asUserMessage(BODY),
  );
};
