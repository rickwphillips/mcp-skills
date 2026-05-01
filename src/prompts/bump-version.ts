import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asUserMessage, interpolate, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "bump-version.md");

const argsSchema = {
  project_path: z
    .string()
    .describe("Filesystem path to the project root (containing package.json or similar manifest)."),
  level: z.enum(["patch", "minor", "major"]),
  summary: z.string().describe("One-line description of what changed in this version."),
};

export const registerBumpVersionPrompt = (server: McpServer) => {
  server.registerPrompt(
    "bump-version",
    {
      title: "Bump Version",
      description:
        "Bump a project's semver version number, append a CHANGELOG entry, commit, and push.",
      argsSchema,
    },
    (args) => {
      const ctx = `Arguments — project_path: ${args.project_path}, level: ${args.level}, summary: ${args.summary}\n\n`;
      return asUserMessage(ctx + interpolate(BODY, args));
    },
  );
};
