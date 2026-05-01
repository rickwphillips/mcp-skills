import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "cc-status.md");

const argsSchema = {
  scope: z
    .enum(["latest", "all"])
    .optional()
    .describe("latest (default — single newest release) or all (last 3 releases)."),
};

export const registerCcStatusPrompt = (server: McpServer) => {
  server.registerPrompt(
    "cc-status",
    {
      title: "Commander Collector Status",
      description:
        "Show Commander Collector version and changelog status from both dev and production databases.",
      argsSchema,
    },
    (args) => {
      const scope = args?.scope ?? "latest";
      return asUserMessage(`Scope: ${scope}\n\n` + BODY);
    },
  );
};
