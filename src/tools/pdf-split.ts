import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { parsePageRange } from "../lib/pdf-pages.js";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

const inputSchema = {
  input: PathSchema.describe("Path of the PDF to split."),
  ranges: z
    .array(
      z.object({
        pages: z
          .string()
          .describe(
            "Page range, 1-indexed inclusive. Examples: '1-3', '5', '7-10'. " +
              "Each range becomes one output PDF.",
          ),
        output: PathSchema,
      }),
    )
    .min(1),
};

export const registerPdfSplitTool = (server: McpServer) => {
  server.registerTool(
    "pdf_split",
    {
      title: "PDF Split",
      description:
        "Split a PDF into one or more output PDFs by page range. Each range becomes a separate output file.",
      inputSchema,
    },
    async ({ input, ranges }) => {
      const bytes = await readFile(resolve(input));
      const src = await PDFDocument.load(bytes);
      const total = src.getPageCount();
      const outputs: { output: string; page_count: number }[] = [];

      for (const range of ranges) {
        const pages = parsePageRange(range.pages, total);
        const dest = await PDFDocument.create();
        const copied = await dest.copyPages(
          src,
          pages.map((p) => p - 1),
        );
        copied.forEach((p) => dest.addPage(p));
        const out = await dest.save();
        await writeFile(resolve(range.output), out);
        outputs.push({ output: resolve(range.output), page_count: pages.length });
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ status: "OK", outputs }, null, 2) },
        ],
      };
    },
  );
};
