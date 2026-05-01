import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "pdf.md");

export const registerPdfPrompt = (server: McpServer) => {
  server.registerPrompt(
    "pdf",
    {
      title: "PDF Processing Guide",
      description:
        "Use whenever the user wants to do anything with PDF files — read, extract text/tables, merge, split, rotate, watermark, create, fill forms, encrypt/decrypt, extract images, or OCR. Prefer the server's pdf_* tools first; fall back to Python/CLI when needed.",
    },
    () => asUserMessage(BODY),
  );
};
