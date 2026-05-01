import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { z } from "zod";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

const inputSchema = {
  input: PathSchema,
  output: PathSchema,
  text: z.string().min(1).describe("Watermark text."),
  opacity: z.number().min(0).max(1).default(0.2),
  font_size: z.number().int().positive().default(48),
};

export const registerPdfWatermarkTool = (server: McpServer) => {
  server.registerTool(
    "pdf_watermark",
    {
      title: "PDF Watermark",
      description: "Stamp text watermark across every page of a PDF, rotated 45° at configurable opacity.",
      inputSchema,
    },
    async ({ input, output, text, opacity, font_size }) => {
      const bytes = await readFile(resolve(input));
      const doc = await PDFDocument.load(bytes);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        page.drawText(text, {
          x: width / 2 - (text.length * font_size) / 4,
          y: height / 2,
          size: font_size,
          font,
          color: rgb(0.5, 0.5, 0.5),
          opacity,
          rotate: degrees(45),
        });
      }
      const out = await doc.save();
      await writeFile(resolve(output), out);
      return {
        content: [
          { type: "text", text: JSON.stringify({ status: "OK", output: resolve(output) }, null, 2) },
        ],
      };
    },
  );
};
