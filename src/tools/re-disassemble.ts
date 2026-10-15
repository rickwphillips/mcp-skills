import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRe, resolveTargetPath } from "../lib/re-exec.js";

const MAX_INSTRUCTIONS = 1000;

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary."),
  at: z
    .string()
    .min(1)
    .describe("Address (e.g. '0x1000') or symbol/function name (e.g. 'main') to start disassembling from."),
  count: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSTRUCTIONS)
    .optional()
    .describe(`Number of instructions to disassemble. Default 50, cap ${MAX_INSTRUCTIONS}.`),
};

export const registerBinDisassembleTool = (server: McpServer) => {
  server.registerTool(
    "bin_disassemble",
    {
      title: "Binary Disassemble",
      description:
        "Disassemble N instructions starting at an address or symbol name, via radare2. Read-only, never " +
        "executes the target. Bounded by `count` so one call can't dump the whole binary — call " +
        "bin_functions first to find a target, then zoom in here.",
      inputSchema,
    },
    async ({ input, at, count }) => {
      const abs = resolveTargetPath(input);
      const n = count ?? 50;
      const safeAt = at.replace(/[;`$|&><]/g, ""); // defense-in-depth; r2 command string, not a shell string

      const result = await runRe("r2", ["-q", "-c", `aa; s ${safeAt}; pdj ${n}`, abs], {
        timeoutMs: 60_000,
      });

      if (result.exit_code !== 0 || !result.stdout.trim()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  input: abs,
                  at: safeAt,
                  message: result.timed_out
                    ? "radare2 disassembly timed out (60s)"
                    : result.stderr.trim() || `r2 exit ${result.exit_code}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      let instructions: Array<Record<string, unknown>>;
      try {
        instructions = JSON.parse(result.stdout);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  input: abs,
                  at: safeAt,
                  message: `Failed to parse r2 JSON: ${err instanceof Error ? err.message : String(err)}`,
                  raw: result.stdout.slice(0, 2000),
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
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "OK",
                input: abs,
                at: safeAt,
                count: instructions.length,
                instructions: instructions.map((i) => ({
                  offset: i.offset,
                  opcode: i.opcode,
                  disasm: i.disasm,
                  bytes: i.bytes,
                  type: i.type,
                  jump: i.jump,
                  fail: i.fail,
                })),
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
