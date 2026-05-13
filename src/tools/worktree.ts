import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const HELPER_SCRIPT = `#!/usr/bin/env bash
# worktree.sh - manage git worktrees for the current repo.
#
# Usage:
#   ./scripts/worktree.sh add <slug> [branch]   Create worktree at <repo>-wt/<slug>
#                                               If <branch> omitted, creates feat/<slug>
#                                               If branch already exists, checks it out instead
#   ./scripts/worktree.sh list                  List worktrees
#   ./scripts/worktree.sh rm <slug>             Remove worktree (must be clean)
#   ./scripts/worktree.sh build <slug>          npm ci + npm run build (if package.json present)
#   ./scripts/worktree.sh path <slug>           Print absolute path
#
# Auto-detects repo root via git rev-parse. Worktrees live in a sibling
# directory named <repo>-wt/ so they do not pollute the main checkout.

set -euo pipefail

REPO="\$(git rev-parse --show-toplevel)"
REPO_NAME="\$(basename "\$REPO")"
WT_ROOT="\$(dirname "\$REPO")/\${REPO_NAME}-wt"

usage() {
  sed -n '2,14p' "\$0" | sed 's/^# \\{0,1\\}//'
  exit "\${1:-1}"
}

cmd_add() {
  local slug="\${1:-}"
  [ -z "\$slug" ] && usage
  local branch="\${2:-feat/\$slug}"
  local target="\$WT_ROOT/\$slug"
  if [ -e "\$target" ]; then
    echo "error: \$target already exists" >&2
    exit 1
  fi
  mkdir -p "\$WT_ROOT"
  if git -C "\$REPO" show-ref --verify --quiet "refs/heads/\$branch"; then
    git -C "\$REPO" worktree add "\$target" "\$branch"
  else
    git -C "\$REPO" worktree add "\$target" -b "\$branch" main
  fi
  if [ -f "\$target/package.json" ]; then
    echo "-> npm ci in \$target"
    ( cd "\$target"; npm ci )
    echo "-> npm run build in \$target"
    ( cd "\$target"; npm run build )
  fi
  echo ""
  echo "Worktree ready: \$target"
}

cmd_list() { git -C "\$REPO" worktree list; }

cmd_rm() {
  local slug="\${1:-}"
  [ -z "\$slug" ] && usage
  local target="\$WT_ROOT/\$slug"
  if [ -d "\$target" ]; then
    git -C "\$REPO" worktree remove "\$target"
    echo "removed: \$target"
  else
    echo "no worktree dir at \$target; pruning stale entries"
    git -C "\$REPO" worktree prune
  fi
}

cmd_build() {
  local slug="\${1:-}"
  [ -z "\$slug" ] && usage
  local target="\$WT_ROOT/\$slug"
  [ ! -d "\$target" ] && { echo "no worktree: \$target" >&2; exit 1; }
  ( cd "\$target"; npm ci )
  ( cd "\$target"; npm run build )
}

cmd_path() {
  local slug="\${1:-}"
  [ -z "\$slug" ] && usage
  echo "\$WT_ROOT/\$slug"
}

case "\${1:-}" in
  add)   shift; cmd_add "\$@" ;;
  list)  shift; cmd_list ;;
  rm)    shift; cmd_rm "\$@" ;;
  build) shift; cmd_build "\$@" ;;
  path)  shift; cmd_path "\$@" ;;
  ""|-h|--help) usage 0 ;;
  *) usage ;;
esac
`;

const WORKTREE_SKILL = `# Worktree proposal skill

Propose a git worktree when the current task would benefit from working in isolation from the main checkout. Trigger on real context switches; stay silent on routine clean-repo work.

## When to propose

Propose a worktree when you are about to start source changes AND any of these apply:

- The repo has uncommitted changes OR is on a feature branch unrelated to the new task.
- The operator describes a context switch ("while X is still in flight", "before finishing Y", "real quick on top of Z").
- The task is a hotfix or patch on top of in-flight feature work.
- The task involves comparing behavior between two versions (run old + new side by side).
- The task involves a dependency bump or experimental install that could clobber the current node_modules.

## When NOT to propose (skip silently)

- Repo is clean and on main, no conflict to avoid.
- Edit is single-file docs only (README, CHANGELOG, comment-only).
- Already working inside a worktree (pwd contains -wt/).
- Operator declined a worktree suggestion earlier in this session for a similar trigger.

## How to propose

Keep it to 2-3 lines. State the trigger plainly, name the cost, name the benefit, then ask. Example:

> You are mid-v0.7 work on feat/v0.7-health-skill and asking for a v0.5 db-pool hotfix.
> Spin up a worktree (~30s, ~300MB) so the hotfix does not touch the in-flight branch? (y/n)

Do NOT lecture about what worktrees are. Do NOT re-pitch if declined.

## On approval

1. Pick a short slug from the task description (e.g. v0.5-db-hotfix, v0.6-dep-bump).
2. Run \`./scripts/worktree.sh add <slug> [branch]\` from the repo root. Branch defaults to feat/<slug>; for hotfixes use hotfix/<slug> or an existing branch name passed as the second arg.
3. If the repo is registered as an MCP server in any client, propose adding a sibling \`<server>-dev\` entry pointing at the worktree's built artifact (e.g. \`dist/server.js\` for mcp-skills). Before writing, grep each MCP config for the proposed key; if it exists pointing at a different worktree, ask whether to repoint or use a distinct key. Never silently clobber an existing entry.
4. Tell the operator to restart the MCP client(s) to pick up the new server.
5. cd into the worktree to begin the work.

## On decline

- **Soft decline** ("no", "not now", "just do it here"): acknowledge in one line ("ok, sticking with the main checkout") and proceed in the current checkout. Do not propose again this session for a substantially similar trigger.
- **Hard decline** ("stop asking", "do not suggest worktrees", "never propose this"): record the operator's opt-out in your persistence layer (e.g. memory file) and stay silent permanently until re-enabled.

## Helper script (if not present in the repo)

If the repo lacks \`scripts/worktree.sh\`, offer to create it. The canonical contents:

\`\`\`bash
${HELPER_SCRIPT}\`\`\`

The script auto-detects the current repo via \`git rev-parse --show-toplevel\` and creates worktrees in a sibling \`<repo>-wt/\` directory. It is repo-agnostic; the same script works for any Node-based project that uses \`npm ci\` + \`npm run build\`. For non-Node repos, omit the build step.
`;

export function registerWorktreeSkillTool(server: McpServer): void {
  server.registerTool(
    "get_worktree_skill",
    {
      title: "Get Worktree Proposal Skill",
      description:
        "Returns the canonical worktree-proposal workflow as prose. Fetch this reactively when the operator " +
        "describes a context switch (\"while X is still in flight\", \"hotfix on top of Y\", \"compare old vs new\"), " +
        "or when you are about to start source changes on a repo that has uncommitted work. Covers trigger heuristics, " +
        "proposal phrasing, soft/hard decline behavior, and embeds the canonical repo-agnostic scripts/worktree.sh helper.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: WORKTREE_SKILL }],
    }),
  );
}
