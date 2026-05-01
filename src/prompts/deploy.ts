import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "deploy.md");

const argsSchema = {
  target: z
    .string()
    .describe("Project to deploy: commander|portfolio|grandkid|all (or aliases c|p|g|a)."),
  flags: z
    .string()
    .optional()
    .describe(
      "Optional flags. --static-only|-s skips PHP/migrations. --php-only|-p PHP only. " +
        "--decks-only|-d commander decks only. --guru-only|-r commander rules-guru only.",
    ),
};

export const registerDeployPrompt = (server: McpServer) => {
  server.registerPrompt(
    "deploy",
    {
      title: "Deploy",
      description: "Deploy one or all FreddyRhetorick projects (commander, portfolio, grandkid) to production.",
      argsSchema,
    },
    (args) => {
      const ctx = `Arguments — target: ${args.target}${args.flags ? `, flags: ${args.flags}` : ""}\n\n`;
      return asUserMessage(ctx + BODY);
    },
  );
};
