import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "request-record.md");

export const registerRequestRecordPrompt = (server: McpServer) => {
  server.registerPrompt(
    "request-record",
    {
      title: "Request Record (DB Read)",
      description:
        "DB read connector with baked-in connections for dev and prod across all four project databases. Discovers schema live. Accepts natural language or raw SQL — one query in, one result out in standard format. Use whenever you need to read data from the database — do not construct your own connection.",
    },
    () => asUserMessage(BODY),
  );
};
