import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "portfolio.md");

export const registerPortfolioPrompt = (server: McpServer) => {
  server.registerPrompt(
    "portfolio",
    {
      title: "Portfolio (rickwphillips.com) — Project Context",
      description:
        "Working on the rickwphillips.com personal portfolio — blog, chihuahua carousel, resume page, dark mode, ThemeProvider, autumn theme, knowledge graph. Loads project context.",
    },
    () => asUserMessage(BODY),
  );
};
