# Changelog

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
