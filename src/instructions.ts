export const SERVER_INSTRUCTIONS = `# mcp-skills

Reusable skills for Rick Phillips's projects, exposed as MCP tools. Workspace-agnostic.

## Verification mindset

When figuring out behavior, reproducing a bug, or sanity-checking a fix: verify rather than guess. Cheap verification means more verification gets done. Two browser-driven surfaces are wired in alongside this server:

- **\`mcp__playwright__browser_*\`** — \`@playwright/mcp\` runs as a separate user-scoped MCP plugin, headless. Tool schemas are deferred; load via \`ToolSearch\` with \`query: "playwright"\`. Use for one-shot browser interactions.
- **Per-project Playwright scratch specs** — for multi-step or repeatable flows, write a throwaway spec instead of chaining MCP browser calls. Currently wired in \`commander-collector/apps/core/e2e/scratch/\` (gitignored, excluded from the default suite via \`testIgnore: ['**/scratch/**']\`). Auth setup mints a JWT locally; \`e2e/helpers.ts\` exposes \`goto\`, \`apiCall\`, \`expectToast\`, \`dismissDialog\`.

Reach for the scratch spec when a flow has more than 2-3 steps or you'll run it twice. Pass/fail with an exit code beats per-step snapshots and round-trips.

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

## Adjacent capabilities (not in this server)

- **\`mcp__computer-use__*\`** — native Mac apps only. Browsers are tier-restricted ("read" tier: visible but not clickable); never use computer-use for browser interaction. For a browser, use Playwright MCP or claude-in-chrome MCP instead.
`;
