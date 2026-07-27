import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PLAYWRIGHT_SKILL = `# Playwright verification skill (agent-guarded)

Authenticated, multi-step browser verification against a named target. The live
tools that drive the browser — \`playwright_prepare\`, \`playwright_execute\`,
\`playwright_close\`, \`playwright_sessions\` — do NOT load into the default
context. They live in the opt-in **\`browser\`** slice so their schemas and the
verbose page I/O they return stay out of the main conversation. This getter is
the only Playwright surface in the default context; run the actual driving inside
a guard (a forked sub-agent or a slice-scoped server), then keep just the verdict.

## When to engage

- You need to reproduce a bug, sanity-check a fix, or confirm behavior end-to-end
  on one of the configured surfaces (commander/portfolio/grandkid dev+prod,
  fbi-prod), and the check needs auth or more than one step.
- The operator asks to "drive the app", "check it in the browser", "screenshot
  the page", or "verify the flow".

Skip for one-shot *unauthenticated* browser pokes — those go to the separate
\`mcp__playwright__browser_*\` plugin (load its schemas via ToolSearch
\`query: "playwright"\`). Skip entirely when a unit/e2e test already proves the
behavior without a live browser.

## Reaching the live tools (the guard)

The four session tools are not registered on the default server. Two sanctioned
ways to get at them, in preference order:

1. **Fork a sub-agent (Claude Code: the Agent tool).** Hand the sub-agent the
   task plus this workflow, and let it call the browser tools. Its context holds
   the tool schemas and the raw page output; your main thread gets back only the
   short verdict. This is the default and the reason the skill is "agent-guarded".
2. **A slice-scoped server entry.** If a client needs the tools directly, add a
   sibling MCP entry pointing at this same binary with
   \`env: { "MCP_SKILLS_SELECT": "browser" }\` (name it e.g. \`mcp-skills-browser\`).
   That entry exposes only the four playwright tools; the default \`mcp-skills\`
   entry stays lean. Restart the client after adding it.

If neither the Agent tool nor a browser slice is available, say so and fall back
to \`mcp__playwright__browser_*\` or a per-project scratch spec — do not attempt
to call \`playwright_prepare\` from the default surface; it is not there.

## The workflow (what the guard runs)

Prepare once, execute stepwise, close when done. Sessions persist across executes
(15-min idle TTL, reset on every execute), even when a script throws.

### 1 — Prepare

\`playwright_prepare({ target })\` launches a headless Chromium (global
\`@playwright/test\` install, self-healing) against a named target from config,
completes that target's auth (JWT localStorage injection / form login / none),
and returns a \`session_id\`. Optional: \`credential\` to override the target's
default credential name; \`viewport\` (default 1440x900, use 390x844 for mobile).
If the target name is unknown the result lists \`available_targets\`; call
\`playwright_sessions\` to see configured names and anything already live.

**Secrets** resolve at prepare time from the macOS Keychain
(\`security find-generic-password\`) or an env var per the credential's config —
never inline a credential in a script.

### 2 — Execute

\`playwright_execute({ session_id, script })\` runs an async JS **function body**
against the live \`page\`. In scope: \`page\` (Playwright Page) and \`baseUrl\`
(the target's base URL). Return a JSON-serializable value with \`return\`. Console
errors captured since the last call come back with the result. Host-filesystem
writes work — \`await page.screenshot({ path: '/abs/path.png' })\` saves straight
to disk. Chain as many executes as the check needs.

Example script:
\`await page.goto(baseUrl + '/dashboard'); return await page.title();\`

### 3 — Close

\`playwright_close({ session_id })\` tears down the browser. Always close when the
check is done rather than leaning on the idle TTL.

## Reporting back

From the guard, return a short verdict to the main thread: what was checked, the
observed result (pass/fail + the concrete signal — title, text, screenshot path,
console error), and nothing else. Do not echo raw DOM dumps or full page HTML
into the main conversation — that is the whole point of guarding this slice.

## Adjacent surfaces (not this slice)

- **\`mcp__playwright__browser_*\`** — \`@playwright/mcp\`, separate user-scoped
  plugin, headless. One-shot unauthenticated interactions. Schemas deferred; load
  via ToolSearch \`query: "playwright"\`.
- **Per-project scratch specs** — repeatable flows worth keeping as a file (e.g.
  \`commander-collector/apps/core/e2e/scratch/\`, gitignored, excluded from the
  default suite). Auth setup mints a JWT locally; \`e2e/helpers.ts\` exposes
  \`goto\`, \`apiCall\`, \`expectToast\`, \`dismissDialog\`.
- **\`mcp__computer-use__*\`** — native Mac apps only; browsers are tier-restricted.
  Never use computer-use for browser interaction.
`;

export function registerPlaywrightSkillTool(server: McpServer): void {
  server.registerTool(
    "get_playwright_skill",
    {
      title: "Get Playwright Verification Skill",
      description:
        "Returns the agent-guarded browser-verification workflow as prose. Fetch this when you need " +
        "authenticated, multi-step browser verification (reproduce a bug, sanity-check a fix, screenshot a " +
        "flow) on a configured target (commander/portfolio/grandkid dev+prod, fbi-prod). The live session " +
        "tools (playwright_prepare/execute/close/sessions) are NOT on the default surface — they live in the " +
        "opt-in `browser` slice; this skill explains how to reach them via a forked sub-agent or a " +
        "MCP_SKILLS_SELECT=browser server entry, and embeds the prepare→execute→close workflow so the guard " +
        "needs no pre-loaded schemas.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: PLAYWRIGHT_SKILL }],
    }),
  );
}
