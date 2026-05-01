import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "save-chat.md");

const argsSchema = {
  notes_dir: z.string().describe("Directory where session notes are stored."),
  title_hint: z
    .string()
    .optional()
    .describe("Optional short hint about what this session was about (used in filename)."),
};

export const registerSaveChatPrompt = (server: McpServer) => {
  server.registerPrompt(
    "save-chat",
    {
      title: "Save Chat",
      description:
        "Save the current conversation as a session note, distilled to durable signal — not a transcript.",
      argsSchema,
    },
    (args) => {
      const ctx = `Arguments — notes_dir: ${args.notes_dir}${args.title_hint ? `, title_hint: ${args.title_hint}` : ""}\n\n`;
      return asUserMessage(ctx + BODY);
    },
  );
};
