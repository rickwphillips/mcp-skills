import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

const inputSchema = {
  input: PathSchema,
  output: PathSchema,
  password: z.string().min(1),
};

export const registerPdfDecryptTool = (server: McpServer) => {
  server.registerTool(
    "pdf_decrypt",
    {
      title: "PDF Decrypt",
      description:
        "Load a PDF with ignoreEncryption and re-save without password. " +
        "Note: pdf-lib does not validate the supplied password.",
      inputSchema,
    },
    async ({ input, output }) => {
      const bytes = await readFile(resolve(input));
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const out = await doc.save();
      await writeFile(resolve(output), out);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "OK",
                message:
                  "Loaded with ignoreEncryption=true and re-saved without password. " +
                  "Note: pdf-lib does not validate the supplied password.",
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
