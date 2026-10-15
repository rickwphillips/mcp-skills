import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { readSections, resolveTargetPath, runRe } from "../lib/re-exec.js";
import { diffByteRanges, offsetToVaddr } from "../lib/re-binary.js";

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
        "sides get full analysis first. Also reports a BYTE-level diff, which matters because " +
        "radare2's function detection is sparse on some binaries: a change outside every function it " +
        "found yields zero changed functions even though bytes differ, so check changed_bytes before " +
        "reading a clean function diff as proof a patch was isolated.",
      inputSchema,
    },
    async ({ input_a, input_b, only_changed, limit }) => {
      const absA = resolveTargetPath(input_a);
      const absB = resolveTargetPath(input_b);
      const cap = limit ?? 200;
      const onlyChanged = only_changed ?? true;

      const [result, bufA, bufB, sectionsA] = await Promise.all([
        runRe("radiff2", ["-AC", "-j", absA, absB], { timeoutMs: 120_000 }),
        readFile(absA),
        readFile(absB),
        readSections(absA),
      ]);

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

      const byteDiff = diffByteRanges(bufA, bufB);
      // Does each changed byte range fall inside a function radiff2 actually
      // compared? If not, a clean function diff says nothing about that change.
      const ranges = byteDiff.ranges.map((r) => {
        const m = offsetToVaddr(sectionsA, r.start);
        const fn = m
          ? entries.find(
              (e) => e.addr !== undefined && e.size !== undefined && m.vaddr >= e.addr && m.vaddr < e.addr + e.size,
            )
          : undefined;
        return {
          file_offset: `0x${r.start.toString(16)}`,
          length: r.length,
          section: m?.section ?? null,
          vaddr: m ? `0x${m.vaddr.toString(16)}` : null,
          in_analyzed_function: fn?.name ?? null,
        };
      });
      const unanalyzed = ranges.filter((r) => r.in_analyzed_function === null).length;

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
                bytes: {
                  identical: byteDiff.identical,
                  size_a: byteDiff.size_a,
                  size_b: byteDiff.size_b,
                  changed_bytes: byteDiff.changed_bytes,
                  tail_bytes: byteDiff.tail_bytes,
                  changed_ranges_total: byteDiff.ranges_total,
                  changed_ranges: ranges,
                },
                note:
                  byteDiff.changed_bytes > 0 && entries.every((e) => e.match === "MATCH")
                    ? `${byteDiff.changed_bytes} byte(s) differ but every analyzed function MATCHes` +
                      (unanalyzed > 0
                        ? `: ${unanalyzed} of ${ranges.length} changed range(s) lie outside any function radare2 found, so the function diff cannot speak to them.`
                        : ", so the changes fall between functions (padding, headers, data).")
                    : null,
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
