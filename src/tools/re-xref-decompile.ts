import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reJson, resolveTargetPath } from "../lib/re-exec.js";
import { parseXrefDecompileOutput, runGhidraHeadless } from "../lib/ghidra-headless.js";

const SCRIPT = "XrefDecompile.java";
const MAX_FUNCTIONS = 20;

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary."),
  string: z
    .string()
    .min(1)
    .describe(
      "Case-sensitive substring of a string literal in the binary, e.g. a log or error message. " +
        "Distinctive text works best; common words match many strings.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_FUNCTIONS)
    .optional()
    .describe(`Max functions to decompile. Default 5, cap ${MAX_FUNCTIONS}.`),
};

export const registerBinXrefDecompileTool = (server: McpServer) => {
  server.registerTool(
    "bin_xref_decompile",
    {
      title: "Binary String Xref Decompile",
      description:
        "Find the functions whose CODE references a string, and decompile them (Ghidra headless). " +
        "The fastest way to locate an unexported function: search for a log/error message it prints " +
        "(find candidates with bin_strings first), and get back its pseudocode plus the exact " +
        "instruction addresses that use the string. Only code references count: a string referenced " +
        "solely from data (a name field in a registration table, say) yields no functions; use " +
        "bin_data_xref for that case. Slow (full auto-analysis first). Read-only.",
      inputSchema,
    },
    async ({ input, string: needle, limit }) => {
      const abs = resolveTargetPath(input);
      const result = await runGhidraHeadless(abs, SCRIPT, [needle, String(limit ?? 5)], { timeoutMs: 300_000 });
      if (!result.ok) {
        return reJson({ status: "ERROR", input: abs, string: needle, message: result.error }, true);
      }

      const out = parseXrefDecompileOutput(result.stdout);
      if (out.error || out.referencingFunctionsTotal === null) {
        return reJson(
          {
            status: "ERROR",
            input: abs,
            string: needle,
            message: out.error ?? `${SCRIPT} produced no summary; the analysis may have been cut short.`,
            raw_log: result.stdout.slice(-4000),
          },
          true,
        );
      }

      let note: string | null = null;
      if (out.strings.length === 0) {
        note = "No defined string contains this text. Ghidra only defines strings its analyzer recognized; confirm with bin_strings.";
      } else if (out.referencingFunctionsTotal === 0) {
        note = "Matching strings exist but no code references them. They may be referenced only from data: try bin_data_xref.";
      } else if (out.referencingFunctionsTotal > out.functions.length) {
        note = `${out.referencingFunctionsTotal} functions reference these strings; returned ${out.functions.length}. Raise limit or narrow the substring.`;
      }

      return reJson({
        status: "OK",
        input: abs,
        string: needle,
        matched_strings: out.strings,
        referencing_functions_total: out.referencingFunctionsTotal,
        functions: out.functions,
        note,
      });
    },
  );
};
