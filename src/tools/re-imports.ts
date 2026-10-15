import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRe, resolveTargetPath } from "../lib/re-exec.js";

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary."),
};

const parseJsonSafe = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const registerBinImportsExportsTool = (server: McpServer) => {
  server.registerTool(
    "bin_imports_exports",
    {
      title: "Binary Imports/Exports",
      description:
        "List a binary's imported symbols, exported symbols, and linked libraries (works across " +
        "ELF/PE/Mach-O via rabin2). Read-only. Good second step after bin_identify to see what the " +
        "binary calls out to.",
      inputSchema,
    },
    async ({ input }) => {
      const abs = resolveTargetPath(input);

      const [importsOut, exportsOut, libsOut] = await Promise.all([
        runRe("rabin2", ["-ij", abs]),
        runRe("rabin2", ["-Ej", abs]),
        runRe("rabin2", ["-lj", abs]),
      ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "OK",
                input: abs,
                imports: parseJsonSafe(importsOut.stdout) ?? { error: importsOut.stderr.trim() },
                exports: parseJsonSafe(exportsOut.stdout) ?? { error: exportsOut.stderr.trim() },
                libraries: parseJsonSafe(libsOut.stdout) ?? { error: libsOut.stderr.trim() },
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
