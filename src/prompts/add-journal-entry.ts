import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asUserMessage, interpolate, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "add-journal-entry.md");

const argsSchema = {
  journal_dir: z.string().describe("Directory where journal entries are stored. One file per day."),
};

export const registerAddJournalEntryPrompt = (server: McpServer) => {
  server.registerPrompt(
    "add-journal-entry",
    {
      title: "Add Journal Entry",
      description:
        "Conduct a journaling session by asking thoughtful, open-ended questions and saving the resulting entry as a markdown file.",
      argsSchema,
    },
    (args) => asUserMessage(interpolate(BODY, args)),
  );
};
