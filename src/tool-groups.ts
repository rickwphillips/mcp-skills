// Single source of truth for which slice each tool / resource belongs to.
// Consumed by tool-select.ts to filter registrations when MCP_SKILLS_SELECT is
// set. The headline payoff is in clients without ToolSearch deferral (Claude
// Desktop, Cursor), where every tool schema loads eagerly into context: pointing
// a config entry at this binary with e.g. MCP_SKILLS_SELECT=db loads only that
// slice. Unset selector => full server (current behavior, unchanged).

// Always registers regardless of selector. Keep this to genuine cross-cutting
// introspection / version tools so every slice can report itself.
export const ALWAYS_ON: readonly string[] = [
  "get_version",
  "check_for_updates",
  "list_tool_groups",
];

// toolName -> group. Every tool registered by registerTools (except the
// ALWAYS_ON set) MUST appear here exactly once; tests/tool-select.test.ts
// asserts full coverage so a newly added tool can't silently fall out of every
// slice.
export const TOOL_GROUPS: Readonly<Record<string, string>> = {
  // db: the only sanctioned MySQL path
  list_db_connections: "db",
  db_read: "db",
  db_write: "db",
  // pdf
  pdf_merge: "pdf",
  pdf_split: "pdf",
  pdf_extract_text: "pdf",
  pdf_rotate: "pdf",
  pdf_watermark: "pdf",
  pdf_encrypt: "pdf",
  pdf_decrypt: "pdf",
  // audio capture
  record_audio: "audio",
  stop_recording: "audio",
  // durable notes / journal
  save_journal_entry: "notes",
  save_session_note: "notes",
  // ship lifecycle
  bump_version: "release",
  deploy: "release",
  cc_status: "release",
  // browser: persistent in-process Playwright sessions
  playwright_prepare: "browser",
  playwright_execute: "browser",
  playwright_close: "browser",
  playwright_sessions: "browser",
  // diagnostics, skill-getters, and the self-healing audit loop
  get_boot: "health",
  get_health_agent_skill: "health",
  get_worktree_skill: "health",
  summarize_mcp_errors: "health",
  mark_mcp_pattern_resolved: "health",
  record_pattern_note: "health",
  mark_pattern_note: "health",
};

// Resource registrars are group-granular too (resource descriptors also load
// eagerly in clients without deferral). All project resources live in one group.
export const RESOURCE_GROUP = "resources";

// Recognized group tokens for MCP_SKILLS_SELECT. Derived from TOOL_GROUPS plus
// the resource group, so adding a tool group here is unnecessary if you add a
// tool with that group above (kept explicit for the unknown-token warning).
export const GROUPS: readonly string[] = [
  "db",
  "browser",
  "pdf",
  "audio",
  "notes",
  "release",
  "health",
  RESOURCE_GROUP,
];
