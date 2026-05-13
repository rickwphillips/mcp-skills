import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  summarizeMcpErrors,
  markMcpPatternResolved,
  recordPatternNote,
  markPatternNote,
} from "../lib/audit-patterns.js";

export function registerAuditTools(server: McpServer): void {
  server.registerTool(
    "summarize_mcp_errors",
    {
      title: "Summarize MCP Errors",
      description:
        "Roll the durable error-audit sink (~/.local/share/mcp-skills/audit/errors.jsonl) into normalized patterns. " +
        "Signatures strip ticket IDs, numbers, paths, URLs, and hashes so the same underlying error buckets together " +
        "regardless of which input triggered it. Returns top-N open patterns by default; filter with `status`, `tool`, or `days`. " +
        "Pass `clear=true` to truncate the raw sink after rollup (patterns.json becomes the durable record). " +
        "Security-classified patterns (auth/credential keywords) are flagged via `severity: \"security\"`.",
      inputSchema: {
        days: z.number().int().positive().optional().describe("Look back N days from now. Default 30."),
        top: z.number().int().min(0).optional().describe("Max patterns to return. Default 10."),
        tool: z.string().optional().describe("Filter to a specific tool name."),
        status: z.enum(["open", "resolved", "all"]).optional().describe("Filter by status. Default 'open'."),
        clear: z.boolean().optional().describe("Truncate errors.jsonl after rollup. Default false."),
      },
    },
    async (args) => {
      const result = summarizeMcpErrors(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "mark_mcp_pattern_resolved",
    {
      title: "Mark MCP Error Pattern Resolved",
      description:
        "Mark an error pattern as resolved after shipping a fix. The pattern stays on disk so future occurrences " +
        "with the same normalized signature auto-reopen it and increment `reopen_count` (regression detection). " +
        "Optional `notes` appends a resolution note that future agents can see if the pattern recurs.",
      inputSchema: {
        pattern_id: z.string().describe("Pattern id from summarize_mcp_errors."),
        notes: z.string().optional().describe("Optional resolution note (what was the fix, what to watch for)."),
      },
    },
    async (args) => {
      const result = markMcpPatternResolved(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "record_pattern_note",
    {
      title: "Record Pattern Triage Note",
      description:
        "Append a steering note to an open error pattern mid-investigation. Notes carry forward via the `_steering` " +
        "payload so the next agent that hits this signature inherits prior findings inline (no separate tool call needed). " +
        "Distinct from mark_mcp_pattern_resolved (which closes the pattern). Notes are status='active' by default. " +
        "After three further recurrences without resolution, active notes auto-demote to 'stale' so calcified guidance can't loop. " +
        "Use mark_pattern_note to manually flip a note to superseded/wrong/stale.",
      inputSchema: {
        pattern_id: z.string().describe("Pattern id from summarize_mcp_errors or a steering payload."),
        body: z.string().describe("Triage note body. Max 2048 chars."),
      },
    },
    async (args) => {
      const result = recordPatternNote(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "mark_pattern_note",
    {
      title: "Update Pattern Note Status",
      description:
        "Update the status of a specific note on an error pattern. 'superseded' = newer note replaces it cleanly. " +
        "'wrong' = guidance led to a dead end (reason required). 'stale' = no longer applies (reason required). " +
        "Active notes drive _steering; non-active notes stay on disk for audit history but stop surfacing.",
      inputSchema: {
        pattern_id: z.string().describe("Pattern id."),
        note_id: z.string().describe("Note id from record_pattern_note or summarize output."),
        status: z.enum(["active", "superseded", "wrong", "stale"]).describe("New note status."),
        reason: z.string().optional().describe("Required when status is 'wrong' or 'stale'."),
      },
    },
    async (args) => {
      const result = markPatternNote(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
