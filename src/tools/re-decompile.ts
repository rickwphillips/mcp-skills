import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveTargetPath } from "../lib/re-exec.js";
import { runGhidraHeadless } from "../lib/ghidra-headless.js";

const START = "===MCP_SKILLS_DECOMPILE_START===";
const END = "===MCP_SKILLS_DECOMPILE_END===";

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary."),
  function: z
    .string()
    .min(1)
    .describe(
      "Function to decompile: its name, the name of a label/symbol at its entry point (Ghidra " +
        "sometimes auto-names the entry-point function 'entry' while e.g. '_main' survives only as a " +
        "label — pass either), or a hex address like '0x1000'.",
    ),
};

export const registerBinDecompileTool = (server: McpServer) => {
  server.registerTool(
    "bin_decompile",
    {
      title: "Binary Decompile",
      description:
        "Decompile one function to C-like pseudocode via a headless Ghidra run (full auto-analysis of " +
        "the whole binary, then one function's output). Read-only, never executes the target. Slow " +
        "(seconds to a couple minutes depending on binary size) — call bin_functions first to pick a " +
        "target rather than guessing. Best used after bin_disassemble raises a specific question raw " +
        "assembly doesn't answer.",
      inputSchema,
    },
    async ({ input, function: fn }) => {
      const abs = resolveTargetPath(input);
      const result = await runGhidraHeadless(abs, "DecompileFunction.java", [fn], { timeoutMs: 180_000 });

      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "ERROR", input: abs, function: fn, message: result.error }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const startIdx = result.stdout.indexOf(START);
      const endIdx = result.stdout.indexOf(END);

      if (startIdx === -1 || endIdx === -1) {
        const errLine = result.stdout
          .split("\n")
          .find((l) => l.includes("DecompileFunction.java>") && l.includes("ERROR:"))
          ?.replace(/^.*DecompileFunction\.java>\s?/, "")
          .replace(/\s*\(GhidraScript\)\s*$/, "");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  input: abs,
                  function: fn,
                  message: errLine?.trim() ?? "Decompiler produced no output; see raw_log for details.",
                  raw_log: result.stdout.slice(-4000),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      // Ghidra's headless logger wraps a println() CALL, not each line it
      // prints: a multi-line call (the decompiled C itself) only gets the
      // "INFO  DecompileFunction.java> " prefix once at its start and the
      // " (GhidraScript)" suffix once at its end, with the real content's
      // own newlines passed through untouched in between. Strip both marker
      // patterns globally rather than per-line.
      let block = result.stdout.slice(startIdx + START.length, endIdx);
      block = block.replace(/(^|\n)INFO\s+DecompileFunction\.java>\s?/g, "\n");
      block = block.replace(/\s*\(GhidraScript\)\s*(\n|$)/g, "$1");
      block = block.trim();

      const nameLine = block.match(/^FUNCTION:\s*(.+)/);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "OK",
                input: abs,
                requested: fn,
                resolved_function: nameLine?.[1]?.trim() ?? null,
                pseudocode: block.replace(/^FUNCTION:.*\n?/, "").trim(),
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
