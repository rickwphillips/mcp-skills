import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

const inputSchema = {
  inputs: z.array(PathSchema).min(2).describe("Paths of PDFs to merge in order."),
  output: PathSchema.describe("Output path for the merged PDF."),
};

export const registerPdfMergeTool = (server: McpServer) => {
  server.registerTool(
    "pdf_merge",
    {
      title: "PDF Merge",
      description: "Merge multiple PDFs into one in the order given.",
      inputSchema,
    },
    async ({ inputs, output }) => {
      const merged = await PDFDocument.create();
      for (const path of inputs) {
        const bytes = await readFile(resolve(path));
        const src = await PDFDocument.load(bytes);
        const copied = await merged.copyPages(src, src.getPageIndices());
        copied.forEach((p) => merged.addPage(p));
      }
      const out = await merged.save();
      await writeFile(resolve(output), out);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { status: "OK", output: resolve(output), page_count: merged.getPageCount() },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};
