import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { parsePageRange } from "../lib/pdf-pages.js";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

const inputSchema = {
  input: PathSchema,
  pages: z
    .string()
    .optional()
    .describe(
      "Optional 1-indexed page selection. Examples: '1', '1-3', '1,3,5'. Omit for all pages.",
    ),
};

export const registerPdfExtractTextTool = (server: McpServer) => {
  server.registerTool(
    "pdf_extract_text",
    {
      title: "PDF Extract Text",
      description: "Extract text content from a PDF, page by page. Optional page selection.",
      inputSchema,
    },
    async ({ input, pages }) => {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const data = new Uint8Array(await readFile(resolve(input)));
      const doc = await getDocument({ data, useSystemFonts: true }).promise;
      const total = doc.numPages;
      const targetPages = pages
        ? parsePageRange(pages, total)
        : Array.from({ length: total }, (_, i) => i + 1);

      const result: { page: number; text: string }[] = [];
      for (const p of targetPages) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .filter(Boolean)
          .join(" ");
        result.push({ page: p, text });
      }
      await doc.destroy();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { status: "OK", input: resolve(input), total_pages: total, pages: result },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};
