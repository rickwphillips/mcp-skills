import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "canvas-design.md");

export const registerCanvasDesignPrompt = (server: McpServer) => {
  server.registerPrompt(
    "canvas-design",
    {
      title: "Canvas Design Philosophy",
      description:
        "Design philosophy and principles for creating original visual art — posters, illustrations, layouts — when generating PNG/PDF assets.",
    },
    () => asUserMessage(BODY),
  );
};
