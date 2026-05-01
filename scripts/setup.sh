#!/usr/bin/env bash
set -euo pipefail

# mcp-skills setup helper
# - Builds the server
# - Creates ~/.config/mcp-skills/ with a starter config.json (chmod 600) if absent
# - Prints the JSON block to add to your Claude Code .mcp.json or Claude Desktop config

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="$HOME/.config/mcp-skills"
CONFIG_PATH="$CONFIG_DIR/config.json"

echo "→ Building mcp-skills..."
cd "$ROOT_DIR"
npm install --silent
npm run build

if [ ! -f "$CONFIG_PATH" ]; then
  echo "→ Creating starter config at $CONFIG_PATH"
  mkdir -p "$CONFIG_DIR"
  cp "$ROOT_DIR/examples/config.example.json" "$CONFIG_PATH"
  chmod 600 "$CONFIG_PATH"
  echo "  ⚠  Edit $CONFIG_PATH and replace REPLACE_ME values before using prod connections."
else
  echo "→ Config already exists at $CONFIG_PATH (left alone)"
fi

DIST="$ROOT_DIR/dist/server.js"

cat <<EOF

✅ Setup complete.

Add this block to your Claude Code config (.mcp.json in a project root,
or ~/.claude/settings.json for user-scope):

{
  "mcpServers": {
    "skills": {
      "command": "node",
      "args": ["$DIST"],
      "env": {
        "MCP_SKILLS_CONFIG": "$CONFIG_PATH"
      }
    }
  }
}

For Claude Desktop, the same block goes in:
  ~/Library/Application Support/Claude/claude_desktop_config.json

After editing config, reload Claude (or restart Claude Desktop).
Run get_version through your client to confirm it's wired up.
EOF
