import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { runRe, resolveTargetPath, RE_TOOLS } from "../lib/re-exec.js";

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary to patch."),
  output: z
    .string()
    .min(1)
    .describe(
      "Path for the patched copy. Must not already exist and must differ from `input` — this tool " +
        "never overwrites the original.",
    ),
  offset: z
    .string()
    .min(1)
    .describe("Raw file offset to patch, as decimal or hex ('0x10'). This is a byte offset into the file, not a virtual address."),
  hex_bytes: z.string().min(2).describe("Replacement bytes as a hex string, e.g. '9000' for two NOPs on x86."),
};

export const registerBinPatchBytesTool = (server: McpServer) => {
  server.registerTool(
    "bin_patch_bytes",
    {
      title: "Binary Patch Bytes",
      description:
        "Patch raw bytes at a file offset in a COPY of a binary (ELF/PE/Mach-O), written to a new " +
        "`output` path, then validates with LIEF that the result still parses. For fix-verification and " +
        "patch-diffing: confirm a one-byte/one-instruction change behaves differently, not for " +
        "constructing payloads. Never overwrites `input`. Pair with bin_disassemble to find the exact " +
        "offset and bytes you want to change, and a debugger session to confirm the effect afterward.",
      inputSchema,
    },
    async ({ input, output, offset, hex_bytes }) => {
      const abs = resolveTargetPath(input);
      const absOutput = resolve(output);

      if (absOutput === abs) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ status: "ERROR", message: "output must differ from input" }, null, 2) },
          ],
          isError: true,
        };
      }
      if (existsSync(absOutput)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "ERROR", message: `output already exists, refusing to overwrite: ${absOutput}` },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const result = await runRe("python3", [RE_TOOLS.patchBytesScript, abs, absOutput, offset, hex_bytes]);

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout.trim());
      } catch {
        parsed = null;
      }

      if (!parsed || (parsed as { ok?: boolean }).ok !== true) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  message:
                    (parsed as { error?: string } | null)?.error ??
                    result.stderr.trim() ??
                    `patch_bytes.py exit ${result.exit_code}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ status: "OK", ...(parsed as object) }, null, 2) }],
      };
    },
  );
};
