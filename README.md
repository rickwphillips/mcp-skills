# mcp-skills

Agent-agnostic [MCP](https://modelcontextprotocol.io/) server exposing reusable database, PDF, deploy, and workflow skills as Tools and Resources. Works with Claude Code, Claude Desktop, Cursor, Cline, and any other MCP-compatible client.

## What it does

Replaces single-agent "skills" (which are really instruction documents read by the agent) with a real MCP server. Tools execute against external systems (MySQL, PDF files, deploy scripts, audio devices); Resources are static reference content the agent reads on demand.

The server also publishes an **MCP server-instructions block** that auto-injects into the agent's context at connect time, advertising safety patterns and adjacent capabilities so they get used instead of forgotten. (Added in v0.4.0.)

The big DB win: **no shell layer, no double-escape bug.** The agent sends raw SQL as a JSON string; the server passes it to the native MySQL driver byte-for-byte. The query you wrote is the query that hits the database.

## Tools

| Name | Purpose |
|---|---|
| `get_version` | Server version + recent CHANGELOG entries; call at session start to detect when to reload |
| `check_for_updates` | Force a fresh GitHub release check (bypasses the 1-hour cache) |
| `list_db_connections` | List configured MySQL connections |
| `db_read` | Read-only SQL; returns rows as JSON; supports `?`-bound params |
| `db_write` | Write SQL; prod connections require `confirm: "CONFIRM"`; audits to JSONL with 30-day prune |
| `deploy` | Deploy commander / portfolio / grandkid; preflight gates for git-clean and commander migration location |
| `cc_status` | Compare local Commander Collector version against dev and prod DB changelog tables |
| `bump_version` | Detect manifest, bump semver, prepend dated CHANGELOG entry, git-commit (no push) |
| `pdf_merge` / `pdf_split` / `pdf_extract_text` / `pdf_rotate` / `pdf_watermark` / `pdf_encrypt` / `pdf_decrypt` | PDF operations (encrypt is a stub pending qpqf shell-out) |
| `record_audio` / `stop_recording` | Mac system audio capture via BlackHole 2ch + ffmpeg |
| `save_journal_entry` | Persist a journal entry to a dated markdown file |
| `save_session_note` | Persist a distilled session note with frontmatter |

## Resources

Static reference content addressable via `mcp://` URIs:

| Name | Content |
|---|---|
| `canvas-design` | Design philosophy companion for visual work |
| `commander-collector` | Commander Collector project context |
| `grandkid-arcade` | Grandkid Arcade project context |
| `mtg-rules-guru` | MTG rules expert with CR citations |
| `portfolio` | Portfolio project context |
| `royal-casino` | Royal Casino (Unity card game) project context |

## Server instructions (v0.4.0+)

On client connect, this server publishes an instructions block containing:

- **Verification mindset** — when to reach for `mcp__playwright__browser_*` (one-shot interactions) vs per-project Playwright scratch specs (multi-step / repeatable)
- **Database safety** — the prod-write CONFIRM gate, audit log, read-before-write requirement
- **Deploy safety** — the preflight gates (git-clean, commander migration location) and how to bypass safely
- **Adjacent capabilities** — claims about computer-use tier rules and which surface owns browser interaction

Clients that honor MCP server instructions (Claude Code, Claude Desktop, Cursor) inject this block automatically at the top of the agent's context. No tool call required.

The block is small and editorial; it does not replace tool descriptions. It adjudicates between competing surfaces and surfaces invariants the agent would otherwise have to discover.

## Install

```bash
git clone https://github.com/rickwphillips/mcp-skills.git
cd mcp-skills
./scripts/setup.sh
```

The setup script:
1. Runs `npm install` and `npm run build`
2. Copies `examples/config.example.json` to `~/.config/mcp-skills/config.json` (chmod 600) if missing
3. Prints the JSON block to add to your Claude config

## Configure

Edit `~/.config/mcp-skills/config.json`:

```json
{
  "connections": {
    "my_db": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "...",
      "password": "...",
      "database": "...",
      "env": "dev",
      "description": "Optional human label"
    },
    "my_db_prod": {
      "host": "...",
      "user": "...",
      "password": "...",
      "database": "...",
      "env": "prod"
    }
  },
  "auditLogPath": "~/.local/share/mcp-skills/write-audit.jsonl"
}
```

Connections marked `"env": "prod"` require `confirm: "CONFIRM"` on every write.

Config file is found in this order:
1. `MCP_SKILLS_CONFIG` env var
2. `~/.config/mcp-skills/config.json`
3. `./mcp-skills.config.json`

## Register with your agent

### Claude Code

Add to `.mcp.json` in your project root or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "skills": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-skills/dist/server.js"],
      "env": {
        "MCP_SKILLS_CONFIG": "/Users/you/.config/mcp-skills/config.json"
      }
    }
  }
}
```

### Claude Desktop

Same block in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

### Cursor / Cline / others

Any MCP client that speaks stdio. Run `node /path/to/dist/server.js`.

## Verify

After registering, ask your agent: *"Use get_version on the skills server."*

You should see the current version number along with recent CHANGELOG entries.

If you've upgraded the server (`git pull` + `npm run build`), the version on the next `get_version` call will reflect the new value; that's your signal to reload your client config.

## Versioning + CHANGELOG

`get_version` returns the last 5 CHANGELOG entries. When the version on disk differs from what your client cached at startup, restart the client.

Releases follow [Semver](https://semver.org/):
- **patch**: bugfix, no API change
- **minor**: new tools or resources, additive
- **major**: breaking changes to tool signatures

## Architecture

```
src/
├── server.ts              # MCP server entry; registers tools + resources + instructions
├── instructions.ts        # SERVER_INSTRUCTIONS block (auto-injected at connect)
├── version.ts             # reads package.json + CHANGELOG.md
├── update-check.ts        # background GitHub release check
├── config/
│   └── connections.ts     # config loader with env/path precedence
├── tools/                 # one file per tool
│   ├── db-read.ts, db-write.ts, list-db-connections.ts
│   ├── deploy.ts, cc-status.ts, bump-version.ts
│   ├── pdf-*.ts           # 7 PDF tools
│   ├── record-audio.ts, stop-recording.ts
│   ├── save-journal-entry.ts, save-session-note.ts
│   └── get-version.ts, check-for-updates.ts
└── resources/             # one file per resource
    ├── canvas-design.ts, mtg-rules-guru.ts
    └── commander-collector.ts, grandkid-arcade.ts, portfolio.ts, royal-casino.ts

examples/                  # example config
scripts/                   # setup.sh
```

## License

MIT — see [LICENSE](./LICENSE).
