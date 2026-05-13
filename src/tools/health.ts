import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const HEALTH_AGENT_SKILL = `# MCP Health Agent — error-triage workflow

A reactive triage workflow. Fires when an mcp-skills tool errors mid-session, when a tool response contains an \`_steering\` payload with prior triage notes, or when the operator explicitly asks ("look into the MCP errors").

The goal is **steering, not auto-fixing**. Investigate, propose, hand back to the operator. Never edit code, never run destructive actions, never block the operator's current task unless the issue is security-classified.

## When to engage

Engage on any of:

- A tool you just called returned an error envelope or threw, AND the response includes a \`_steering\` payload (means the same signature has been seen before).
- A tool response includes \`_steering.recommendation: 'apply_active_notes'\` — read the notes and try them first.
- A tool response includes \`_steering.severity: 'security'\` — engage immediately, even on first sight.
- A tool response includes \`_steering.reopen_count > 0\` — engage; reopened patterns mean a prior fix didn't hold.
- The operator asks for it.

Skip on:

- Single transient errors with no prior history (network blips, rate-limit recoveries). These return no \`_steering\` payload.
- Patterns already triaged in the current session — don't loop on the same one.
- Patterns whose \`status\` is \`resolved\` and \`reopen_count\` is 0.

## Triage steps

### Step 1 — Pull the data

Call \`summarize_mcp_errors\` (no \`clear\`) with appropriate filters:

- New session, general check: \`{ days: 30, top: 10, status: "open" }\`
- Specific tool flagged: \`{ tool: "<name>", days: 30, top: 5 }\`
- Regression hunt: \`{ status: "all", top: 10 }\` and look for \`reopen_count > 0\`

Pick the top one or two patterns to investigate. Don't try to triage all of them in one pass.

### Step 2 — Investigate

For each pattern, you need three things:

1. **The pattern record itself** — \`tool\`, \`normalized_message\`, \`samples[]\`, \`severity\`, \`reopen_count\`.
2. **The source for the failing tool** — read \`src/tools/<tool>.ts\` (or \`src/lib/\` for shared infrastructure). Look at the failure paths: thrown errors, \`logger.error\` calls, returned error envelopes.
3. **Recent changes** — \`git log --oneline -20 src/tools/<tool>.ts\` to see if anything plausible landed near the \`first_seen\` date.

If your client supports forking sub-agents (Claude Code: the Agent tool), fork the investigation with a scoped prompt:

> "Tool \`<name>\` is failing with normalized message \`<msg>\`. Read \`src/tools/<name>.ts\`, check the failure paths, look at recent commits touching it, and propose a fix. Report under 200 words. Do not edit files."

The fork keeps tool output out of the main conversation. If your client doesn't fork, do it inline but stay scoped.

### Step 3 — Report back

Surface the finding to the operator as a casual aside, not a blocking question. Tone scales with severity:

- **\`severity: normal\`, count moderate** — single line at a natural break: "Heads up, \`<tool>\` keeps failing with \`<msg>\` (N times). Looks like \`<root cause guess>\` in \`<file>:<line>\`. Want me to draft a fix?"
- **\`severity: normal\`, count high or regression** — slightly louder, still non-blocking: lead with the finding before continuing the current task. "Before we move on, this one's reopened twice now..."
- **\`severity: security\`** — surface immediately at the next response boundary. Lead with it. Push back if the operator tries to skip past, but if they say "later" you drop it. Never block.

Always include:

- Pattern \`id\` (so the operator can reference it).
- The tool name and a one-line description of what it does.
- Best guess at root cause, citing \`file:line\`.
- Proposed change, kept small and focused.
- Whether you want to draft it now or leave it.

### Step 4 — On approval

When the operator approves a fix, edit the source, run \`npm run build\` from the mcp-skills repo root, and (per the project's commit/push approval rule) stage + show the diff + wait for explicit go-ahead before committing. Never commit without approval.

### Step 5 — After the fix lands

Call \`mark_mcp_pattern_resolved\` with the \`pattern_id\` and \`notes\` (commit hash or PR ref). The pattern stays on disk. If the same signature recurs, the next rollup will reopen it and \`reopen_count\` will increment, surfacing it as a regression.

## Steering payload — inline help on recurring failures

When a tool fails and the same signature has been seen before, the dispatch wrapper injects a \`_steering\` payload into the swallowed-error response. Shape:

\`\`\`
_steering: {
  pattern_id, count, reopen_count, severity,
  active_notes: [{ id, ts, body }, ...],
  superseded_count,
  recommendation: 'apply_active_notes' | 'fresh_triage' | 'first_occurrence'
}
\`\`\`

How to react:

- \`recommendation: 'apply_active_notes'\` — read the \`active_notes\` bodies and try them first. They were recorded by a prior agent that hit the same signature. If they don't resolve it, call \`mark_pattern_note\` with \`status: 'wrong'\` and a \`reason\` explaining what failed, then fork triage.
- \`recommendation: 'fresh_triage'\` — earlier notes were auto-demoted to 'stale' because the pattern kept recurring after them. Don't re-apply; fork a fresh investigation. After you learn something new, call \`record_pattern_note\` to persist it.
- \`recommendation: 'first_occurrence'\` — no notes yet. Standard triage path. Use \`record_pattern_note\` to leave the next agent a starting point.

## Mid-investigation notes vs resolved notes

- \`record_pattern_note\` — for *open* patterns. Use during triage to leave a partial finding, a "tried X, didn't work" breadcrumb, or a confirmed root cause that isn't fixed yet.
- \`mark_mcp_pattern_resolved\` — for closing a pattern after the fix ships. Appends a final note (does not overwrite prior notes).
- \`mark_pattern_note\` — for updating an existing note's status. Use \`superseded\` when a newer note replaces it, \`wrong\` when it led nowhere (reason required), or \`stale\` when it no longer applies (reason required).

Notes are durable: they survive across sessions and the audit retention purge applies to the pattern as a whole, not individual notes.

## mcp-skills tool surfaces likely to surface in patterns

When triaging, common candidates by tool:

- **\`db_read\` / \`db_write\`** — connection errors (mysql down, REPLACE_ME creds, SSH tunnel failure), syntax errors, prepared-statement issues. For prod connections, the path goes through the SSH-shellout adapter (\`src/lib/ssh-mysql.ts\`) so look there too.
- **\`deploy\`** — preflight gate trips (dirty git tree, migration file in wrong location), rsync failures, npm build errors.
- **\`cc_status\`** — same DB connection paths as db_read.
- **\`save_journal_entry\` / \`save_session_note\`** — filesystem errors, frontmatter validation.
- **PDF tools** — pdf-lib errors, missing files, password issues.

## Things this workflow does NOT do

- Auto-edit files. Always propose; let the operator approve.
- Auto-commit or auto-push. Stage + show diff + wait, every time.
- Triage every single error. The whole point of the audit pipeline is to ignore noise and focus on patterns.
- Loop on the same pattern within a single session. Triage once, move on, revisit next session if still open.
- Block the current task. Only security-classified items get loud surfacing, and even those don't force a halt.

## Cross-client notes

- **Claude Code** — fork via the Agent tool to keep raw output out of the main context.
- **Cursor / Copilot / Claude Desktop** — no fork; investigate inline but stay scoped to the named tool's source.
- **Headless** — return the proposal as text; let the calling system decide.
`;

export function registerHealthAgentSkillTool(server: McpServer): void {
  server.registerTool(
    "get_health_agent_skill",
    {
      title: "Get MCP Health Agent Skill",
      description:
        "Returns the canonical error-triage workflow as prose. Fetch this reactively when an mcp-skills tool errors, " +
        "when a tool response includes an `_steering` payload, or when the operator references MCP errors. " +
        "Steering only, never auto-fix. Includes guidance on the `_steering` payload shape, recommendation values, " +
        "and when to use record_pattern_note vs mark_pattern_note vs mark_mcp_pattern_resolved.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: HEALTH_AGENT_SKILL }],
    }),
  );
}
