import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "write-record.md");

export const registerWriteRecordPrompt = (server: McpServer) => {
  server.registerPrompt(
    "write-record",
    {
      title: "Write Record (DB Write)",
      description:
        "DB write connector with baked-in connections for dev and prod across all four project databases. Discovers schema live. Accepts natural language or raw SQL. Enforces prod safety: read-before-write, CONFIRM prompt, 30-day audit log with rollback hints. Use whenever you need to write data to the database — do not construct your own connection.",
    },
    () => asUserMessage(BODY),
  );
};
