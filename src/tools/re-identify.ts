import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { runRe, resolveTargetPath } from "../lib/re-exec.js";

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary to identify."),
};

export const registerBinIdentifyTool = (server: McpServer) => {
  server.registerTool(
    "bin_identify",
    {
      title: "Binary Identify",
      description:
        "Static triage of a binary: format (ELF/PE/Mach-O/other), architecture, bitness, entry point, " +
        "hashes (sha256/md5), and signing info. Read-only — never executes the target. Run this first on " +
        "any unfamiliar binary.",
      inputSchema,
    },
    async ({ input }) => {
      const abs = resolveTargetPath(input);

      const [fileOut, rabinOut, bytes] = await Promise.all([
        runRe("file", ["-b", abs]),
        runRe("rabin2", ["-Ij", abs]),
        readFile(abs),
      ]);

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const md5 = createHash("md5").update(bytes).digest("hex");

      let rabinInfo: unknown = null;
      let rabinError: string | null = null;
      if (rabinOut.exit_code === 0 && rabinOut.stdout.trim()) {
        try {
          rabinInfo = JSON.parse(rabinOut.stdout).info ?? JSON.parse(rabinOut.stdout);
        } catch (err) {
          rabinError = `Failed to parse rabin2 JSON: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        rabinError = rabinOut.stderr.trim() || `rabin2 exit ${rabinOut.exit_code}`;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "OK",
                input: abs,
                size_bytes: bytes.length,
                sha256,
                md5,
                file_type: fileOut.stdout.trim() || fileOut.stderr.trim(),
                rabin2: rabinInfo,
                rabin2_error: rabinError,
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
