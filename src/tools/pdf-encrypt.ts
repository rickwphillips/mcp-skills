import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

const inputSchema = {
  input: PathSchema,
  output: PathSchema,
  user_password: z.string().min(1),
  owner_password: z.string().optional(),
};

export const registerPdfEncryptTool = (server: McpServer) => {
  server.registerTool(
    "pdf_encrypt",
    {
      title: "PDF Encrypt",
      description:
        "(v0.1.x stub) Save the PDF — pdf-lib does not yet implement password encryption. " +
        "Returns PARTIAL status. Real encryption coming via qpdf shell-out.",
      inputSchema,
    },
    async ({ input, output }) => {
      const bytes = await readFile(resolve(input));
      const doc = await PDFDocument.load(bytes);
      const out = await doc.save({ useObjectStreams: false });
      await writeFile(resolve(output), out);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "PARTIAL",
                message:
                  "pdf-lib does not yet implement password encryption. Output written without encryption. " +
                  "For real encryption, install qpdf and shell out, or wait for the upgrade.",
                output: resolve(output),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};
