import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRe, resolveTargetPath } from "../lib/re-exec.js";

const MAX_LIMIT = 2000;

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary."),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Max functions returned. Default 200, cap ${MAX_LIMIT}.`),
  name_filter: z
    .string()
    .optional()
    .describe("Optional case-insensitive substring filter on function names."),
};

export const registerBinFunctionsTool = (server: McpServer) => {
  server.registerTool(
    "bin_functions",
    {
      title: "Binary Function List",
      description:
        "List a binary's functions via radare2's analysis (name, address, size, xref counts). Read-only, " +
        "never executes the target. Runs `aa` (fast analysis) rather than `aaa` (slow, full analysis) — if " +
        "coverage looks thin, that's the tradeoff; bin_disassemble can still target any address directly. " +
        "Use this to pick targets before bin_disassemble or bin_decompile, rather than dumping the whole binary.",
      inputSchema,
    },
    async ({ input, limit, name_filter }) => {
      const abs = resolveTargetPath(input);
      const cap = limit ?? 200;

      const result = await runRe("r2", ["-q", "-c", "aa; aflj", abs], { timeoutMs: 60_000 });

      if (result.exit_code !== 0 || !result.stdout.trim()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  input: abs,
                  message: result.timed_out
                    ? "radare2 analysis timed out (60s)"
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

      let functions: Array<Record<string, unknown>>;
      try {
        functions = JSON.parse(result.stdout);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  input: abs,
                  message: `Failed to parse r2 JSON: ${err instanceof Error ? err.message : String(err)}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      if (name_filter) {
        const needle = name_filter.toLowerCase();
        functions = functions.filter((f) =>
          String(f.name ?? "").toLowerCase().includes(needle),
        );
      }

      const total = functions.length;
      const truncated = total > cap;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "OK",
                input: abs,
                total_functions: total,
                returned: Math.min(total, cap),
                truncated,
                functions: functions.slice(0, cap).map((f) => ({
                  name: f.name,
                  offset: f.offset,
                  size: f.size,
                  nbbs: f.nbbs,
                  calltype: f.calltype,
                  cost: f.cost,
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
