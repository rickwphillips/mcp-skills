# mcp-skills

Agent-agnostic [MCP](https://modelcontextprotocol.io/) server exposing reusable database, PDF, deploy, and workflow skills as Tools and Resources. Works with Claude Code, Claude Desktop, Cursor, Cline, and any other MCP-compatible client.

## What it does

Replaces single-agent "skills" (which are really instruction documents read by the agent) with a real MCP server. Tools execute against external systems (MySQL, PDF files, deploy scripts, audio devices); Resources are static reference content the agent reads on demand.

Three architectural features set this server apart:

1. **Native MySQL driver, no shell layer.** The agent sends raw SQL as a JSON string; the server passes it byte-for-byte to mysql2. The query you wrote is the query that hits the database. Prod connections route through an SSH-shellout adapter that uses `ssh host mysql --batch` with `PREPARE`/`EXECUTE` and base64-encoded params, so shell escaping is moot.
2. **Self-healing audit pipeline.** Every tool call is wrapped at registration time. Errors (including swallowed `{error: ...}` envelopes that don't throw) feed a durable audit sink. Recurring failures get a `_steering` payload injected into the response so the next agent that hits the same signature inherits prior triage notes inline. Stale guidance auto-demotes after 3 further recurrences.
3. **Server-instructions auto-injection.** The server publishes an instructions block at connect time. Honoring clients (Claude Code, Claude Desktop, Cursor) inject it at the top of agent context, advertising safety patterns, the audit-pipeline conventions, and reactive trigger sentences for the workflow skills. No tool call required.

## Tools

### Core

| Name | Purpose |
|---|---|
| `get_boot` | Canonical fresh-agent context: name, version, log/audit paths, configured DB connections (env + via_ssh), 3 most recent CHANGELOG entries. Quietly attaches `mcp_health` when there are open error patterns. |
| `get_version` | Server version + recent CHANGELOG entries |
| `check_for_updates` | Force a fresh GitHub release check (bypasses the 1-hour cache) |
| `bump_version` | Detect manifest, bump semver, prepend dated CHANGELOG entry, git-commit (no push) |

### Database

| Name | Purpose |
|---|---|
| `list_db_connections` | List configured MySQL connections (dev + prod) |
| `db_read` | Read-only SQL; returns rows as JSON; supports `?`-bound params. Auto-routes to SSH-shellout for prod connections. |
| `db_write` | Write SQL; prod connections require `confirm: "CONFIRM"`; audits to JSONL with 30-day prune |
| `cc_status` | Compare local Commander Collector version against dev and prod DB changelog tables |

### Audit + self-healing

| Name | Purpose |
|---|---|
| `summarize_mcp_errors` | Roll the durable error sink into normalized patterns; filter by status/tool/days |
| `mark_mcp_pattern_resolved` | Close a pattern after shipping a fix; future recurrences reopen with `reopen_count` |
| `record_pattern_note` | Append a triage note that future agents see inline via `_steering` on recurrence |
| `mark_pattern_note` | Flip a note to `superseded` / `wrong` / `stale` (reason required for wrong/stale) |
| `get_health_agent_skill` | Returns the canonical error-triage workflow as prose. Reactive: fetch when you see a `_steering` payload. |

### Workflow

| Name | Purpose |
|---|---|
| `deploy` | Deploy commander / portfolio / grandkid; preflight gates for git-clean and commander migration location |
| `get_worktree_skill` | Returns the worktree proposal workflow. Reactive: fetch on context-switch language. Embeds `scripts/worktree.sh` (repo-agnostic). |
| `save_journal_entry` | Persist a journal entry to a dated markdown file |
| `save_session_note` | Persist a distilled session note with frontmatter |

### PDF

| Name | Purpose |
|---|---|
| `pdf_merge` / `pdf_split` / `pdf_extract_text` / `pdf_rotate` / `pdf_watermark` / `pdf_encrypt` / `pdf_decrypt` | PDF operations (encrypt is a stub pending qpdf shell-out) |

### Media

| Name | Purpose |
|---|---|
| `record_audio` / `stop_recording` | Mac system audio capture via BlackHole 2ch + ffmpeg |

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

## Self-healing audit pipeline (v0.6.0+)

Every tool registration runs through a wrapper that emits per-call telemetry and detects errors in two forms:

- **Thrown exceptions** (logged on throw, then re-thrown)
- **Swallowed-error envelopes** in the tool's return value (`{error: ...}`, `{errors: [...]}`, `{errors: {field: msg}}` Jira-style, `{status: 'error'}`, `{ok: false}`, `isError: true`)

Both paths feed `~/.local/share/mcp-skills/audit/errors.jsonl`. A `summarize_mcp_errors` rollup normalizes signatures (tickets, numbers, paths, URLs, hashes stripped) and stores patterns at `~/.local/share/mcp-skills/audit/patterns.json` with age-based retention (resolved: 7d, open: 30d, tunable via env).

When a normalized signature recurs (count >= 2 or any `reopen_count`), the wrapper injects a `_steering` payload into the response:

```json
{
  "error": "connect ECONNREFUSED 127.0.0.1:3306",
  "_steering": {
    "pattern_id": "0e17822c6f9b",
    "count": 4,
    "reopen_count": 0,
    "severity": "normal",
    "active_notes": [
      { "id": "n_28a1", "body": "Start local MySQL with `brew services start mysql`" }
    ],
    "superseded_count": 0,
    "recommendation": "apply_active_notes"
  }
}
```

`recommendation` is one of:
- `first_occurrence`: no prior notes; standard triage
- `apply_active_notes`: prior agent left findings; try them first
- `fresh_triage`: prior notes auto-demoted to `stale` after 3 further recurrences without resolution; investigate fresh

`record_pattern_note` and `mark_pattern_note` are the writer side. `mark_mcp_pattern_resolved` closes a pattern (future recurrences reopen it with `reopen_count` incremented, surfacing regressions). For the canonical triage workflow as prose, call `get_health_agent_skill`.

## SSH-shellout for prod databases (v0.5.0+)

Some hosting environments restrict direct TCP access to mysql. To keep prod connections working without exposing any new prod-side service, connections marked with an `ssh:` block route through `src/lib/ssh-mysql.ts`:

```jsonc
{
  "connections": {
    "portfolio_prod": {
      "host": "127.0.0.1",
      "user": "real_user",
      "password": "real_password",
      "database": "rickwphi_app_portfolio",
      "env": "prod",
      "ssh": {
        "host": "162.241.218.40",
        "port": 22,
        "user": "ssh_user",
        "privateKey": "~/.ssh/id_rsa_server",
        "remoteHost": "127.0.0.1",
        "remotePort": 3306
      }
    }
  }
}
```

Per-query, the server spawns `ssh host mysql --batch ...` and pipes a `SET @p = CONVERT(FROM_BASE64('...') USING utf8mb4); PREPARE stmt FROM @sql_stmt; EXECUTE stmt USING @p0, @p1, ...; DEALLOCATE PREPARE stmt;` script through stdin. Base64-encoding params (and the SQL itself) sidesteps shell escaping entirely. For writes, a trailing `SELECT ROW_COUNT(), LAST_INSERT_ID()` populates `affected_rows` and `insert_id`.

Trade-off: prod returns scalar columns as strings (mysql `--batch` is text mode, no type info). Dev (direct mysql2) returns native types. Code consuming `rows` from prod must tolerate string-typed scalars.

## Server instructions (v0.4.0+)

On client connect, the server publishes an instructions block covering:

- **Verification mindset**: when to reach for `mcp__playwright__browser_*` (one-shot interactions) vs per-project Playwright scratch specs (multi-step / repeatable)
- **Database safety**: the prod-write CONFIRM gate, audit log, read-before-write requirement
- **Deploy safety**: the preflight gates (git-clean, commander migration location)
- **Self-healing audit**: documents the `_steering` payload shape and the reactive trigger to fetch `get_health_agent_skill`
- **Worktree proposals**: reactive trigger to fetch `get_worktree_skill` on context-switch language
- **Adjacent capabilities**: claims about computer-use tier rules and which surface owns browser interaction

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
      "host": "127.0.0.1",
      "user": "...",
      "password": "...",
      "database": "...",
      "env": "prod",
      "ssh": {
        "host": "prod.example.com",
        "user": "deploy",
        "privateKey": "~/.ssh/id_rsa"
      }
    }
  }
}
```

Connections marked `"env": "prod"` require `confirm: "CONFIRM"` on every write. Connections with an `ssh:` block route through the SSH-shellout adapter.

Config file is found in this order:
1. `MCP_SKILLS_CONFIG` env var
2. `~/.config/mcp-skills/config.json`
3. `./mcp-skills.config.json`

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `MCP_SKILLS_CONFIG` | `~/.config/mcp-skills/config.json` | Path to config file |
| `MCP_SKILLS_HOME` | `~/.local/share/mcp-skills` | Root for logs + audit |
| `MCP_SKILLS_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `MCP_SKILLS_LOG_FILE` | `<MCP_SKILLS_HOME>/logs/server-<pid>.log` | Override path; `off` disables |
| `MCP_SKILLS_AUDIT` | enabled | `off` disables the durable audit sink |
| `MCP_SKILLS_AUDIT_RETAIN_RESOLVED_DAYS` | `7` | Resolved-pattern retention |
| `MCP_SKILLS_AUDIT_RETAIN_OPEN_DAYS` | `30` | Open-pattern retention |

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

After registering, ask your agent: *"Use get_boot on the skills server."*

You should see the version, log/audit paths, your configured connections, and (if anything's wrong) an `mcp_health` block.

## Versioning + API stability

Releases follow [Semver](https://semver.org/):
- **patch**: bugfix, no API change
- **minor**: new tools or resources, additive
- **major**: breaking changes to tool signatures

**Stable from v1.0.0** (signature changes require major bump):

| Surface | Stable |
|---|---|
| All registered tool names | yes |
| All registered tool input schemas | yes |
| Audit + steering JSON shape (`Pattern`, `PatternNote`, `SteeringPayload`) | yes |
| Connection config shape (`ConnectionConfig` including `ssh?`) | yes |
| Config file precedence (env > `~/.config/mcp-skills/config.json` > cwd) | yes |
| Resource `mcp://` URIs | yes |

**Internal (may change without major bump):**

- `src/lib/` module shapes (logger options, audit-pattern internals, dispatch-wrapper helpers)
- Exact text of skill-returning tools (`get_health_agent_skill`, `get_worktree_skill`)
- Skill tool text and instruction block text
- File paths under `~/.local/share/mcp-skills/` (consumers should use the env vars above, not hardcode paths)
- Test infrastructure under `tests/`

## Testing

```bash
npm test                # one-shot
npm run test:watch      # vitest watch mode
npm run test:coverage   # coverage report (text + html)
```

Tier-1 unit tests cover the four highest-risk pure-function surfaces (audit pattern normalization + recurrence + note lifecycle, swallowed-error envelope detection, SSH-mysql script generation + batch-output parsing, logger secret-redaction). 76 tests, ~30ms runtime. Integration tests against live MySQL/SSH are deferred (would need CI fixtures); the pure-function tests catch regressions in the parts most likely to break.

## Architecture

```
src/
├── server.ts              # MCP server entry; wraps registerTool, then registers tools + resources
├── instructions.ts        # SERVER_INSTRUCTIONS block (auto-injected at connect)
├── version.ts             # reads package.json + CHANGELOG.md
├── update-check.ts        # background GitHub release check
├── config/
│   └── connections.ts     # config loader with env/path precedence; ssh?: support
├── lib/                   # internal infrastructure
│   ├── logger.ts          # JSON-line logger, per-PID file sink, secret redaction
│   ├── audit-patterns.ts  # signature normalization, pattern store, _steering, auto-demotion
│   ├── dispatch-wrapper.ts# registerTool wrapper; extractSwallowedError + injectSteering
│   ├── db-pool.ts         # unified QueryRunner (mysql2 for dev, ssh-shellout for prod)
│   └── ssh-mysql.ts       # ssh host mysql --batch shellout with PREPARE/EXECUTE
├── tools/                 # one file per tool group
│   ├── audit.ts           # 4 audit tools (summarize/mark-resolved/record-note/mark-note)
│   ├── health.ts          # get_health_agent_skill
│   ├── boot.ts            # get_boot
│   ├── worktree.ts        # get_worktree_skill
│   ├── db-read.ts, db-write.ts, list-db-connections.ts
│   ├── deploy.ts, cc-status.ts, bump-version.ts
│   ├── pdf-*.ts           # 7 PDF tools
│   ├── record-audio.ts, stop-recording.ts
│   ├── save-journal-entry.ts, save-session-note.ts
│   └── get-version.ts, check-for-updates.ts
└── resources/             # one file per resource
    ├── canvas-design.ts, mtg-rules-guru.ts
    └── commander-collector.ts, grandkid-arcade.ts, portfolio.ts, royal-casino.ts

scripts/
├── setup.sh               # build + starter config + print MCP block
└── worktree.sh            # repo-agnostic git worktree helper

tests/
├── audit-patterns.test.ts
├── dispatch-wrapper.test.ts
├── ssh-mysql.test.ts
├── logger.test.ts
└── global-setup.ts        # per-process MCP_SKILLS_HOME temp dir

examples/                  # example config
```

## License

MIT, see [LICENSE](./LICENSE).
