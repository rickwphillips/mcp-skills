# mcp-skills

Agent-agnostic [MCP](https://modelcontextprotocol.io/) server exposing reusable database, PDF, and workflow skills as Tools and Prompts. Works with Claude Code, Claude Desktop, Cursor, Cline, and any other MCP-compatible client.

## What it does

Replaces single-agent "skills" (which are really instruction documents read by the agent) with a real MCP server. Tools execute against external systems (MySQL, PDF files); Prompts are reusable instruction templates with arguments.

The big win: **no shell layer, no double-escape bug.** The agent sends raw SQL as a JSON string; the server passes it to the native MySQL driver byte-for-byte. The query you wrote is the query that hits the database.

## Tools

| Name | Purpose |
|---|---|
| `get_version` | Server version + recent CHANGELOG entries — call at session start to detect when to reload |
| `list_db_connections` | List configured MySQL connections |
| `db_read` | Run read-only SQL; returns rows as JSON; supports `?`-bound params |
| `db_write` | Run write SQL; prod connections require `confirm: "CONFIRM"`; audits to JSONL with 30-day prune |
| `pdf_merge` | Merge multiple PDFs in order |
| `pdf_split` | Split a PDF by page ranges into multiple outputs |
| `pdf_extract_text` | Extract text content per page |
| `pdf_rotate` | Rotate pages by 90/180/270 |
| `pdf_watermark` | Stamp diagonal text watermark |
| `pdf_encrypt` | (stub in 0.1.0 — see CHANGELOG) |
| `pdf_decrypt` | Load with `ignoreEncryption` + re-save |

## Prompts

| Name | Purpose |
|---|---|
| `mtg-rules-guru` | MTG rules expert with CR citations |
| `bump-version` | Semver bump + CHANGELOG entry workflow |
| `save-chat` | Distill conversation to durable session note |
| `add-journal-entry` | Guided one-question-at-a-time journaling |
| `canvas-design` | Design philosophy companion for visual work |

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

You should see something like:
```json
{
  "name": "mcp-skills",
  "version": "0.1.0",
  "changelog_recent": [...]
}
```

If you've upgraded the server (`git pull` + `npm run build`), the version on the next `get_version` call will reflect the new value — that's your signal to reload your client config.

## Versioning + CHANGELOG

`get_version` returns the last 5 CHANGELOG entries. When the version on disk differs from what your client cached at startup, restart the client.

Releases follow [Semver](https://semver.org/):
- **patch**: bugfix, no API change
- **minor**: new tools/prompts, additive
- **major**: breaking changes to tool signatures

## Architecture

```
src/
├── server.ts              # MCP server entry; tool + prompt registration
├── version.ts             # reads package.json + CHANGELOG.md
├── config/
│   └── connections.ts     # config loader with env/path precedence
├── tools/
│   ├── db.ts              # db_read, db_write
│   └── pdf.ts             # all pdf_* tools
└── prompts/
    └── loader.ts          # markdown frontmatter parser

prompts/                   # markdown prompt files (loaded at startup)
examples/                  # example config
scripts/                   # setup.sh
```

## License

MIT — see [LICENSE](./LICENSE).
