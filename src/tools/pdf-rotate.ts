import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument, degrees } from "pdf-lib";
import { z } from "zod";
import { parsePageRange } from "../lib/pdf-pages.js";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

const inputSchema = {
  input: PathSchema,
  output: PathSchema,
  degrees: z
    .union([
      z.literal(90),
      z.literal(180),
      z.literal(270),
      z.literal(-90),
      z.literal(-180),
      z.literal(-270),
    ])
    .describe("Rotation in degrees clockwise. Must be a multiple of 90."),
  pages: z
    .string()
    .optional()
    .describe("Optional 1-indexed page selection. Omit to rotate all pages."),
};

export const registerPdfRotateTool = (server: McpServer) => {
  server.registerTool(
    "pdf_rotate",
    {
      title: "PDF Rotate",
      description: "Rotate pages of a PDF by 90/180/270 degrees. Optional page selection.",
      inputSchema,
    },
    async ({ input, output, degrees: rotateBy, pages }) => {
      const bytes = await readFile(resolve(input));
      const doc = await PDFDocument.load(bytes);
      const total = doc.getPageCount();
      const target = pages
        ? parsePageRange(pages, total)
        : Array.from({ length: total }, (_, i) => i + 1);

      for (const p of target) {
        const page = doc.getPage(p - 1);
        const current = page.getRotation().angle;
        page.setRotation(degrees((current + rotateBy) % 360));
      }
      const out = await doc.save();
      await writeFile(resolve(output), out);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { status: "OK", output: resolve(output), pages_rotated: target },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};
