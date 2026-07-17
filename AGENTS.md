# AGENTS.md — mcp-skills

Agent-agnostic [MCP](https://modelcontextprotocol.io/) server exposing reusable
database, PDF, deploy, and workflow skills as Tools and Resources. Works with Claude
Code, Claude Desktop, Cursor, Cline, and any MCP client. Canonical agent guide;
`CLAUDE.md` is a symlink to it.

## Stack
- TypeScript + Node, `tsc` build, `vitest` tests. Native `mysql2` driver (no shell).
- Shipped & stable: semver + CHANGELOG + GitHub releases; API-stability commitment
  since v1.0.0. It is a **published npm package**, not a web app.

## Run it (local dev)
```bash
npm run dev          # tsc --watch
npm test             # vitest run   (npm run test:watch for watch mode)
npm run build        # tsc -> dist/ ;  npm start = node dist/server.js
```

## Architecture (what makes it distinct)
- **Native MySQL, no shell layer.** Raw SQL in as a JSON string, passed byte-for-byte
  to mysql2. Prod connections route through an **SSH-shellout adapter**
  (`ssh host mysql --batch`, PREPARE/EXECUTE, base64 params) — cPanel blocks port
  forwarding, so do NOT tunnel.
- **Self-healing audit pipeline.** Every tool call is wrapped; errors feed a durable
  audit sink; recurring failures inject a `_steering` payload for the next agent.
- `db_write` on prod requires the REQUIRES_CONFIRMATION → CONFIRM flow (30-day audit
  log with rollback hints). Read-before-write is mandatory.

## Versioning / release
- Bump via the `bump-version` skill; check current with the `get_version` tool.

## Conventions
- Agent-agnostic: expose **Tools and Resources, ZERO prompts**.
- Full reference: `README.md`, `CHANGELOG.md`.
