import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveTargetPath } from "../lib/re-exec.js";
import { extractMarkedBlocks, runGhidraHeadless, scriptLines } from "../lib/ghidra-headless.js";

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

      const [block] = extractMarkedBlocks(result.stdout, "DecompileFunction.java", START, END);

      if (block === undefined) {
        const errLine = scriptLines(result.stdout, "DecompileFunction.java", "ERROR: ")[0];
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
