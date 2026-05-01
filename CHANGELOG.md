# Changelog

All notable changes to mcp-skills will be documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [Semver](https://semver.org/).

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
