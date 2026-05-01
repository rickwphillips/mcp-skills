# Changelog

All notable changes to mcp-skills will be documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [Semver](https://semver.org/).

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
