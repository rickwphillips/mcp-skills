import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRe, resolveTargetPath } from "../lib/re-exec.js";

const MAX_LIMIT = 2000;

const inputSchema = {
  input_a: z.string().min(1).describe("Absolute or relative path to the first binary (e.g. the original)."),
  input_b: z.string().min(1).describe("Absolute or relative path to the second binary (e.g. a patched or newer build)."),
  only_changed: z
    .boolean()
    .optional()
    .describe("Return only functions that don't MATCH between the two binaries. Default true."),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Max functions returned. Default 200, cap ${MAX_LIMIT}.`),
};

type RadiffEntry = {
  addr?: number;
  name?: string;
  size?: number;
  diff_addr?: number;
  diff_name?: string;
  diff_size?: number;
  match?: string;
  dist?: number;
};

export const registerBinDiffTool = (server: McpServer) => {
  server.registerTool(
    "bin_diff",
    {
      title: "Binary Diff",
      description:
        "Function-level diff between two binaries via radare2's radiff2 (-AC: analyze both, graph-diff " +
        "every function, report MATCH/UNMATCH + a similarity score). Read-only, never executes either " +
        "target. The core patch-diffing tool: confirm a patch changed exactly the function you intended " +
        "and nothing else, or spot what changed between two builds. Slow on large binaries since both " +
        "sides get full analysis first.",
      inputSchema,
    },
    async ({ input_a, input_b, only_changed, limit }) => {
      const absA = resolveTargetPath(input_a);
      const absB = resolveTargetPath(input_b);
      const cap = limit ?? 200;
      const onlyChanged = only_changed ?? true;

      const result = await runRe("radiff2", ["-AC", "-j", absA, absB], { timeoutMs: 120_000 });

      if (result.exit_code !== 0 || !result.stdout.trim()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  input_a: absA,
                  input_b: absB,
                  message: result.timed_out
                    ? "radiff2 timed out (120s)"
                    : result.stderr.trim() || `radiff2 exit ${result.exit_code}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      let entries: RadiffEntry[];
      try {
        entries = JSON.parse(result.stdout);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  input_a: absA,
                  input_b: absB,
                  message: `Failed to parse radiff2 JSON: ${err instanceof Error ? err.message : String(err)}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const totalFunctions = entries.length;
      const filtered = onlyChanged ? entries.filter((e) => e.match !== "MATCH") : entries;
      const totalMatched = filtered.length;
      const truncated = totalMatched > cap;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "OK",
                input_a: absA,
                input_b: absB,
                only_changed: onlyChanged,
                total_functions: totalFunctions,
                changed_functions: entries.filter((e) => e.match !== "MATCH").length,
                returned: Math.min(totalMatched, cap),
                truncated,
                diffs: filtered.slice(0, cap).map((e) => ({
                  name_a: e.name,
                  addr_a: e.addr,
                  size_a: e.size,
                  name_b: e.diff_name,
                  addr_b: e.diff_addr,
                  size_b: e.diff_size,
                  match: e.match,
                  similarity: e.dist,
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
