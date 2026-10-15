import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readSections, reJson, resolveTargetPath, runRe } from "../lib/re-exec.js";
import { findDataXrefs, locateStringVaddrs, parseLayout } from "../lib/re-binary.js";

const MAX_HITS = 500;

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary."),
  string: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Exact string to look for (matched as a whole NUL-terminated string, so 'CloneForm' does not " +
        "match inside 'TempCloneForm'). Its address is what gets searched for. Give this or vaddr.",
    ),
  vaddr: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .optional()
    .describe("Virtual address to search for as a stored pointer, e.g. '0x1011abec'. Give this or string."),
  layout: z
    .string()
    .optional()
    .describe(
      "Optional struct layout to decode around each hit: comma-separated <type>:<name>, types u8 u16 u32 " +
        "u64 i8 i16 i32 i64 f32 f64 ptr, packed back to back (add explicit padding fields where the real " +
        "struct has them). Example: 'ptr:name,ptr:alt,u32:opcode,ptr:help,u16:refRequired,u16:numParams," +
        "ptr:params,ptr:execute,ptr:parse,ptr:eval,u32:flags'. Pointer fields are resolved to their " +
        "section and, when readable, the string they point at.",
    ),
  pointer_field: z
    .string()
    .optional()
    .describe("Name of the layout's ptr field that holds the found pointer. Default: the first field."),
  pointer_size: z
    .union([z.literal(4), z.literal(8)])
    .optional()
    .describe("Pointer width in bytes. Default: taken from the binary (32-bit = 4, 64-bit = 8)."),
  limit: z.number().int().min(1).max(MAX_HITS).optional().describe(`Max hits returned. Default 50, cap ${MAX_HITS}.`),
};

export const registerBinDataXrefTool = (server: McpServer) => {
  server.registerTool(
    "bin_data_xref",
    {
      title: "Binary Data Xref",
      description:
        "Find where an address is stored as a POINTER in the file's data, and optionally decode the " +
        "struct around each hit. Use it when a function is reachable only through a table: command or " +
        "handler registrations, vtables, plugin descriptors. Search for the entry's name string, decode " +
        "the record with a layout, and read the handler pointer straight out of it (then bin_decompile " +
        "that address). Complements bin_xref_decompile, which only sees CODE references. Pure byte " +
        "parsing, fast, no Ghidra, little-endian only. Read-only.",
      inputSchema,
    },
    async ({ input, string: text, vaddr, layout, pointer_field, pointer_size, limit }) => {
      const abs = resolveTargetPath(input);
      if ((text === undefined) === (vaddr === undefined)) {
        return reJson({ status: "ERROR", input: abs, message: "Give exactly one of string or vaddr." }, true);
      }

      const [buf, sections, info] = await Promise.all([readFile(abs), readSections(abs), runRe("rabin2", ["-Ij", abs])]);
      if (sections.length === 0) {
        return reJson({ status: "ERROR", input: abs, message: "No section table parsed; addresses can't be mapped." }, true);
      }
      let bits = 32;
      try {
        bits = Number(JSON.parse(info.stdout).info?.bits) || 32;
      } catch {
        // fall back to 32-bit
      }
      const ptrSize = pointer_size ?? (bits === 64 ? 8 : 4);

      let fields;
      try {
        fields = layout ? parseLayout(layout, ptrSize) : undefined;
      } catch (err) {
        return reJson({ status: "ERROR", input: abs, message: err instanceof Error ? err.message : String(err) }, true);
      }

      const targets =
        text !== undefined
          ? locateStringVaddrs(buf, sections, text)
          : [{ offset: null, vaddr: Number.parseInt(vaddr as string, 16), section: null }];
      if (targets.length === 0) {
        return reJson({
          status: "OK",
          input: abs,
          string: text,
          targets: [],
          note: "String not found as a standalone NUL-terminated string in any section.",
        });
      }

      try {
        const results = targets.map((t) => {
          const { hits, total } = findDataXrefs(buf, sections, t.vaddr, {
            pointerSize: ptrSize,
            layout: fields,
            pointerField: pointer_field ?? fields?.[0]?.name,
            limit: limit ?? 50,
          });
          return {
            target_vaddr: `0x${t.vaddr.toString(16)}`,
            target_section: t.section,
            pointer_hits_total: total,
            truncated: total > hits.length,
            hits,
          };
        });
        return reJson({ status: "OK", input: abs, string: text ?? null, pointer_size: ptrSize, targets: results });
      } catch (err) {
        return reJson({ status: "ERROR", input: abs, message: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );
};
