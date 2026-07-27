export const SERVER_INSTRUCTIONS = `# mcp-skills

Reusable skills for Rick Phillips's projects, exposed as MCP tools. Workspace-agnostic.

## Verification mindset

When figuring out behavior, reproducing a bug, or sanity-checking a fix: verify rather than guess. Cheap verification means more verification gets done. Browser-driven surfaces, in preference order:

- **Playwright sessions (this server, agent-guarded)** — for authenticated, multi-step verification against a named target (commander/portfolio/grandkid dev+prod, fbi-prod). The live session tools (\`playwright_prepare/execute/close/sessions\`) are NOT on the default surface; they live in the opt-in \`browser\` slice so their schemas and verbose page output stay out of the main context. Fetch \`get_playwright_skill\` for the workflow — it explains how to reach the tools via a forked sub-agent or a \`MCP_SKILLS_SELECT=browser\` server entry, and embeds the prepare→execute→close steps, target list, and credential-safety rules.
- **\`mcp__playwright__browser_*\`** — \`@playwright/mcp\` runs as a separate user-scoped MCP plugin, headless. Tool schemas are deferred; load via \`ToolSearch\` with \`query: "playwright"\`. Use for one-shot unauthenticated browser interactions.
- **Per-project Playwright scratch specs** — for repeatable flows worth keeping as a file. Currently wired in \`commander-collector/apps/core/e2e/scratch/\` (gitignored, excluded from the default suite via \`testIgnore: ['**/scratch/**']\`). Auth setup mints a JWT locally; \`e2e/helpers.ts\` exposes \`goto\`, \`apiCall\`, \`expectToast\`, \`dismissDialog\`.

For authenticated multi-step verification, fetch \`get_playwright_skill\` and run the browser tools inside the guard: prepare once, execute stepwise, close when done.

## Database safety (db_read, db_write, list_db_connections)

These tools are the only sanctioned path for MySQL access. Direct \`mysql\` commands are blocked by user hooks.

\`db_write\` against prod connections requires:
1. First call returns \`REQUIRES_CONFIRMATION\`.
2. Surface the SQL and a read-before snapshot to the user.
3. Re-call with \`confirm: 'CONFIRM'\`.
4. The write is audited for 30 days in a JSONL log with rollback hints.

Read-before-write is mandatory for prod. Never bypass the CONFIRM gate.

## Deploy safety (deploy)

Preflight gates run by default: git-tree-clean check + commander migration file location check. Pass \`skip_preflight: true\` only after explicit user acknowledgment of dirty state or missing migration.

Commander migration files MUST live in \`commander-collector/migrations/v{version}.sql\` at the repo root. Wrong location (e.g., \`apps/core/migrations/\`) = silently skipped by the deploy script, no error. The preflight gate catches this before the deploy runs.

## Error handling and self-healing audit

This server runs every tool call through a telemetry wrapper that detects swallowed-error envelopes (\`{error}\`, \`{errors}\`, \`{status:'error'}\`, \`{ok:false}\`, \`isError:true\`) and records them to a durable audit sink. When a normalized error signature recurs (count >= 2 or any \`reopen_count > 0\`), the wrapper injects a \`_steering\` payload into the response:

\`\`\`
_steering: {
  pattern_id, count, reopen_count, severity,
  active_notes: [{ id, ts, body }, ...],
  superseded_count,
  recommendation: 'apply_active_notes' | 'fresh_triage' | 'first_occurrence'
}
\`\`\`

**Reactive trigger:** when you see a \`_steering\` payload in a tool response, or when a tool errors and you suspect it may have been seen before, fetch \`get_health_agent_skill\` for the canonical triage workflow. Don't loop on the same pattern within a session. Use \`summarize_mcp_errors\` to see all open patterns, \`record_pattern_note\` to leave triage findings for the next agent, and \`mark_mcp_pattern_resolved\` after shipping a fix.

## Worktree proposals on context switches

When the operator describes a context switch ("while X is still in flight", "hotfix on top of Y", "compare old vs new"), or when you are about to start source changes on a repo that has uncommitted work, fetch \`get_worktree_skill\` for the canonical worktree-proposal workflow. The skill covers trigger heuristics, proposal phrasing, soft/hard decline behavior, and embeds a repo-agnostic \`scripts/worktree.sh\` helper. Stay silent when the repo is clean on main, edits are docs-only, or the operator has previously declined for similar triggers.

## Adjacent capabilities (not in this server)

- **\`mcp__computer-use__*\`** — native Mac apps only. Browsers are tier-restricted ("read" tier: visible but not clickable); never use computer-use for browser interaction. For a browser, use Playwright MCP or claude-in-chrome MCP instead.
`;
