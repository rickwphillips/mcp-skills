# Changelog

## [1.3.0] - 2026-07-16

- Add persistent Playwright browser session tools (playwright_prepare/execute/close/sessions) with keychain-backed credentials and named targets

## [1.2.1] - 2026-07-15

- Reduce MCP health audit noise: commander deploy e2e-only failures return `DEPLOY_OK_E2E_FAILED` without `isError`; steering injection logs at `info` instead of polluting the warn audit sink; `db_read` tool description adds `SHOW TABLES` / `DESCRIBE` schema-discovery guidance. Adds `deploy-run` classifier, steering log test, and logger env-config coverage.

## [1.2.0] - 2026-07-14

- Harden db_read (reject non-read-only and stacked statements) and db_write (enforce two-step CONFIRM, fix audit-order duplicate-write hazard); use execFileSync in bump_version to prevent shell injection.

## [1.1.1] - 2026-07-09

- Test coverage: audit-patterns message extraction/normalization + legacy notes migration, and dispatch-wrapper steering-injection-on-recurrence edge cases. No source or API changes; 156 tests passing.

## [1.1.0] - 2026-06-29

- Opt-in tool slicing via MCP_SKILLS_SELECT. A single binary can register only a named subset of tools (group tokens db/pdf/audio/notes/release/health/resources or exact tool names), so clients without ToolSearch deferral (Claude Desktop, Cursor) can run several lightweight entries from one server instead of loading every schema. New tool-groups.ts manifest (single source of truth, coverage-tested), tool-select.ts selector parser + registerTool name filter applied after the telemetry wrap, and an always-on list_tool_groups introspection tool. Resources gate on the same selector. Unset selector means the full server, unchanged. Added unit tests for the parser/filter and an e2e stdio test asserting tools/list per slice, plus GitHub Actions CI (npm ci + build + test on Node 20/22).

## [1.0.1] - 2026-05-16

- Audit: confirm directives on deploy/bump_version/record_audio, extract today() util, close coverage gaps (dispatch-wrapper 52→78%, logger 41→89%, pdf-pages/date-utils 0→100%)

## [1.0.0] - 2026-05-13

- v1.0.0 release: API stability commitment. Full README rewrite covering the v0.6-v0.9 trajectory (audit pipeline, self-healing _steering, health-agent skill, get_boot, worktree skill, SSH-shellout adapter for prod, testing). Documents which tool signatures + JSON shapes are now frozen (signature changes require major bump) and which surfaces remain internal. Example config now includes ssh: blocks on prod connections so new users see the shellout path out of the box. No new tools or behavior changes from v0.9.0; this release is the API stability commitment + docs polish.

## [0.9.0] - 2026-05-13

- Worktree skill + helper script. New get_worktree_skill tool returns the canonical proposal workflow (when to propose, when to skip, how to phrase the 2-3 line ask, soft/hard decline handling, on-approval steps). Embeds the repo-agnostic scripts/worktree.sh helper that auto-detects the current repo via git rev-parse and creates worktrees in a sibling <repo>-wt/ directory with npm ci + npm run build for Node projects. SERVER_INSTRUCTIONS gets a reactive-trigger sentence so honoring clients fetch the skill on context-switch language. Ported from newsbank-mcp v3.11.0.

## [0.8.0] - 2026-05-13

- get_boot aggregator tool: returns server name+version, log/audit paths, all configured DB connections (with env + via_ssh flag), and the 3 most recent CHANGELOG entries. Quietly attaches an mcp_health block only when there are open error patterns (quiet-by-default per newsbank's pattern). Establishes the canonical fresh-agent context surface that future quiet-by-default annotations can hang off of.

## [0.7.0] - 2026-05-13

- Reactive get_health_agent_skill tool returning the canonical error-triage workflow as prose: when to engage, triage steps (pull data, investigate, report, approve, resolve), how to react to each _steering recommendation value, mid-investigation vs resolved-note distinction, and mcp-skills-specific tool surfaces (db_read/db_write/deploy/cc_status/save_*/PDF). SERVER_INSTRUCTIONS gets a reactive-trigger sentence so honoring clients (Claude Code / Desktop / Cursor) fetch the skill automatically when they see a _steering payload. Ported from newsbank-mcp v3.9.0's get_health_agent_skill.

## [0.6.0] - 2026-05-13

- Audit foundation: structured JSON-line logger (stderr + per-PID file + 7-day prune + secret redaction), per-tool telemetry via registerTool wrapper, swallowed-error capture for {error}/{errors}/{status:'error'}/{ok:false} envelopes, durable audit sink at ~/.local/share/mcp-skills/audit/errors.jsonl, summarize_mcp_errors with signature normalization (tickets/numbers/paths/URLs/hashes stripped) and pattern rollup to patterns.json with age-based retention, mark_mcp_pattern_resolved with regression detection via reopen_count, self-healing _steering payload that injects prior triage notes inline on recurrence, record_pattern_note and mark_pattern_note tools, and auto-demotion of stale notes after 3 further recurrences. Ported from newsbank-mcp's v3.8-v3.12 audit architecture (Rick's self-healing design).

## [0.5.0] - 2026-05-12

- Route prod db_read/db_write through SSH-shellout (ssh host mysql --batch). Detected via the `ssh:` field on a connection. Adds src/lib/ssh-mysql.ts with prepared-statement param binding via SET @p = FROM_BASE64(...) + PREPARE/EXECUTE for safe scalar passthrough. db-pool.ts now returns a unified QueryRunner; mysql2 pool for dev, ssh shellout for prod. Resolves the cPanel-blocks-forwarded-mysql constraint without exposing any new PHP or service on prod.

## [0.4.0] - 2026-05-07

- Add MCP server-instructions block (auto-injected at connect) advertising verification mindset, db_write/deploy safety patterns, and adjacent browser surfaces (Playwright MCP, scratch specs, computer-use tier rules). README cleaned up to remove stale Prompts framing and document the new instructions feature.

All notable changes to mcp-skills will be documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [Semver](https://semver.org/).

## [0.3.0] - 2026-05-01

### Changed
- **Eliminated all prompts in favor of tools and resources.** Per MCP best practice for agent-agnostic, slash-discoverable servers: deterministic workflows belong as tools (the agent calls them, predictable code runs); static reference material belongs as resources (the agent reads them on demand). Prompts only earn their keep when they inject content the agent doesn't already have — none of the v0.2.0 prompts qualified.
- Total inventory: **19 tools + 6 resources + 0 prompts** (was 12 tools + 16 prompts).

### Added — Tools
- `cc_status` — version-gap check between local `package.json`, dev DB, and prod DB for Commander Collector. Native MySQL queries, structured JSON output.
- `record_audio` — start ffmpeg recording of Mac system audio via BlackHole 2ch. Refuses if a recording is already in progress.
- `stop_recording` — stop the active recording, finalize the m4a, return file size.
- `bump_version` — detect manifest (package.json / Cargo.toml / composer.json / pyproject.toml / VERSION), bump semver, prepend dated CHANGELOG entry, git-commit. Never pushes automatically.
- `deploy` — deploy commander/portfolio/grandkid/all via hardcoded deploy.sh paths. Preflight-checks git tree clean and commander migration file location; bypassable via `skip_preflight`.
- `save_journal_entry` — persist a journal entry to `<journal_dir>/<YYYY-MM-DD>.md`. Refuses to overwrite unless `append=true`.
- `save_session_note` — persist a distilled session note with standard frontmatter (`name`, `description`, `type`).

### Added — Resources
- `skills://project/commander-collector` — Commander Collector project context.
- `skills://project/grandkid-arcade` — Grandkid Arcade project context.
- `skills://project/portfolio` — rickwphillips.com portfolio project context.
- `skills://project/royal-casino` — Royal Casino Unity game project context.
- `skills://reference/canvas-design` — Design philosophy for original visual work.
- `skills://reference/mtg-rules-guru` — MTG rules-question methodology and answer format.

All resource bodies inlined as string literals in `src/resources/<name>.ts` (no `.md` sidecars; build no longer needs to copy markdown).

### Removed
- `src/prompts/` directory and all 16 prompt registrations.
- `scripts/copy-prompts.mjs` build step.
- `registerPrompts` import and call in `src/server.ts`.
- 5 prompts that became tools: `cc-status`, `record-audio`, `stop-recording`, `bump-version`, `deploy`.
- 4 prompts that became resources: `commander-collector`, `grandkid-arcade`, `portfolio`, `royal-casino`.
- 2 prompts converted to tools+resources combo: `add-journal-entry` → `save_journal_entry` tool; `save-chat` → `save_session_note` tool; their guidance moved into tool descriptions.
- 2 prompts converted to resources: `canvas-design`, `mtg-rules-guru`.
- 3 redundant wrappers: `pdf` (existing `pdf_*` tools cover it), `request-record` (existing `db_read`), `write-record` (existing `db_write`).

## [0.2.0] - 2026-05-01

### Changed
- **Refactored to canonical MCP server structure** matching `modelcontextprotocol/servers/src/everything/`. Switched from low-level `Server` API + hand-built `setRequestHandler` to high-level `McpServer` (`server.registerTool` / `server.registerPrompt`). One file per tool, one file per prompt, with `registerTools(server)` / `registerPrompts(server)` aggregators in `src/tools/index.ts` and `src/prompts/index.ts`. The result: agents (Copilot, Claude, etc.) recognize the structure on first read.
- `src/server.ts` shrunk from ~200 lines to 19. Removed the `TOOLS` registry array and the dynamic `prompts/loader.ts` markdown reader.
- Prompt bodies relocated from `prompts/*.md` (repo root) to `src/prompts/<name>.md` colocated with their TS module. The TS module loads its sibling at module init via `readFileSync`.
- Build now copies `src/prompts/*.md` into `dist/prompts/` via `scripts/copy-prompts.mjs` so runtime can find bodies.

### Added
- 11 new prompts ported from local Claude Code skills: `cc-status`, `commander-collector`, `deploy`, `grandkid-arcade`, `pdf`, `portfolio`, `record-audio`, `request-record`, `royal-casino`, `stop-recording`, `write-record`. Total prompts: 16.
- Shared lib modules: `src/lib/db-pool.ts` (pool management for db-read + db-write), `src/lib/pdf-pages.ts` (page-range parsing for split/extract/rotate).
- `src/prompts/_helpers.ts` — `loadBody`, `interpolate`, `asUserMessage` shared utilities.

### Removed
- `src/prompts/loader.ts` (replaced by per-module `loadBody()` calls).
- `src/tools/db.ts` and `src/tools/pdf.ts` (split into individual tool files).
- Top-level `prompts/` markdown directory (moved into `src/prompts/`).
- `prompts` entry from `package.json` `files` array (no longer published as a separate folder).

## [0.1.1] - 2026-05-01

### Added
- Online update check on boot (logged to stderr) and via `get_version` (cached 1 hour) and `check_for_updates` (forces a fresh check).
- Update check shells to `gh release view` → falls back to `gh api /tags` → `git ls-remote --tags`. Uses your existing `gh` auth — no token to manage.
- `get_version` response now includes an `update_check` block with `current_version`, `latest_version`, `update_status` (`current` | `behind` | `ahead` | `unknown` | `error`), and an `upgrade_command` when behind. Never runs the upgrade automatically.

## [0.1.0] - 2026-05-01

Initial release. Agent-agnostic MCP server consolidating reusable database, PDF, and workflow skills.

### Added
- **Tools**
  - `get_version` — returns server version + recent CHANGELOG entries
  - `list_db_connections` — enumerate configured connections
  - `db_read` — native MySQL driver, raw SQL or `?`-bound params, no shell layer (no double-escape bugs)
  - `db_write` — read-before-write, CONFIRM gate for prod, audit log with 30-day prune, rollback SQL echoed in response
  - `pdf_merge`, `pdf_split`, `pdf_extract_text`, `pdf_rotate`, `pdf_watermark` — full feature
  - `pdf_encrypt` — stub (pdf-lib lacks password encryption); returns PARTIAL status
  - `pdf_decrypt` — load with ignoreEncryption + re-save
- **Prompts**
  - `mtg-rules-guru` — MTG rules answers with CR citations
  - `bump-version` — semver bump + CHANGELOG entry workflow
  - `save-chat` — distill conversation to durable session note
  - `add-journal-entry` — guided one-question-at-a-time journaling
  - `canvas-design` — design philosophy companion for visual work
- Config loader with precedence: `MCP_SKILLS_CONFIG` env → `~/.config/mcp-skills/config.json` → `./mcp-skills.config.json`
- Example config at `examples/config.example.json`
- `scripts/setup.sh` — build + starter config + Claude registration block

### Deferred
- `canvas_render` — needs `node-canvas` native deps
- `pdf_ocr` — needs `tesseract` system dep
- `pdf_fill_form`, `pdf_extract_tables`
- Real `pdf_encrypt` (will shell to `qpdf`)
