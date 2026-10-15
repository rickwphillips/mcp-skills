import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readSections, reJson, resolveTargetPath } from "../lib/re-exec.js";
import { classifyEntropy, shannonEntropy } from "../lib/re-binary.js";

const inputSchema = {
  input: z.string().min(1).describe("Absolute or relative path to the binary."),
};

const round = (e: number | null) => (e === null ? null : Math.round(e * 10000) / 10000);

export const registerBinEntropyTool = (server: McpServer) => {
  server.registerTool(
    "bin_entropy",
    {
      title: "Binary Entropy",
      description:
        "Shannon entropy (bits/byte, 0-8) for the whole file and for each section, with a rough " +
        "classification. The per-section view is the point: an EXECUTABLE section near 8.0 strongly " +
        "suggests packed or encrypted code (static analysis of it will find nothing useful until it is " +
        "unpacked), while low entropy in a DATA section is normal (constant tables, zero padding) and not " +
        "suspicious. Whole-file entropy alone mixes the two and can mislead. Read-only.",
      inputSchema,
    },
    async ({ input }) => {
      const abs = resolveTargetPath(input);
      const [buf, sections] = await Promise.all([readFile(abs), readSections(abs)]);
      const whole = shannonEntropy(buf);

      const perSection = sections.map((s) => {
        const raw = buf.subarray(s.paddr, Math.min(buf.length, s.paddr + s.size));
        const e = shannonEntropy(raw);
        return {
          name: s.name,
          perm: s.perm,
          executable: s.perm.includes("x"),
          file_offset: `0x${s.paddr.toString(16)}`,
          vaddr: `0x${s.vaddr.toString(16)}`,
          size: raw.length,
          entropy: round(e),
          class: classifyEntropy(e),
        };
      });

      const suspicious = perSection
        .filter((s) => s.executable && s.class === "encrypted_or_compressed")
        .map((s) => s.name);

      return reJson({
        status: "OK",
        input: abs,
        file_size: buf.length,
        entropy: round(whole),
        class: classifyEntropy(whole),
        sections: perSection,
        packed_or_encrypted_code_sections: suspicious,
        note:
          sections.length === 0
            ? "No section table parsed (raw blob or unsupported format); only whole-file entropy is reported."
            : "Classes are heuristics: code ~5.5-6.8, encrypted/compressed >=7.5, tables/padding <4.5.",
      });
    },
  );
};
