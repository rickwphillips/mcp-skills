import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  availableTargets,
  closeSession,
  executeInSession,
  listSessions,
  prepareSession,
} from "../lib/playwright-session.js";

const json = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
});

export const registerPlaywrightSessionTools = (server: McpServer) => {
  server.registerTool(
    "playwright_prepare",
    {
      title: "Playwright Prepare",
      description:
        "Launch a headless Chromium (global @playwright/test install, self-healing) against a named " +
        "target from config, complete that target's auth (jwt localStorage injection, form login, or none), " +
        "and return a session_id. The session PERSISTS across playwright_execute calls until " +
        "playwright_close or 15 minutes idle. Secrets resolve from macOS Keychain / env per config — " +
        "never inline credentials.",
      inputSchema: {
        target: z
          .string()
          .describe(
            "Named playwright target from config (see error message or playwright_sessions for the list).",
          ),
        credential: z
          .string()
          .optional()
          .describe("Override the target's default credential name."),
        viewport: z
          .object({ width: z.number().int().positive(), height: z.number().int().positive() })
          .optional()
          .describe("Viewport, default 1440x900. Use 390x844 for mobile checks."),
      },
    },
    async ({ target, credential, viewport }) => {
      const result = await prepareSession({ target, credential, viewport });
      if (!result.ready && /Unknown playwright target/.test(result.error ?? "")) {
        return json({ ...result, available_targets: availableTargets() });
      }
      return json(result);
    },
  );

  server.registerTool(
    "playwright_execute",
    {
      title: "Playwright Execute",
      description:
        "Run an async JavaScript function body against a live playwright session's page. Variables in " +
        "scope: `page` (Playwright Page) and `baseUrl` (the target's base URL). Return a JSON-serializable " +
        "value with `return`. The session survives the call (even on script error) — chain as many " +
        "executes as needed, then playwright_close. Console errors captured since the last call are " +
        "included. Host-filesystem writes work: `await page.screenshot({ path: '/abs/path.png' })` saves " +
        "directly to disk. Example script: `await page.goto(baseUrl + '/dashboard'); return await page.title();`",
      inputSchema: {
        session_id: z.string().describe("Session id from playwright_prepare."),
        script: z
          .string()
          .describe("Async function body. `page` and `baseUrl` are in scope; use `return` for output."),
      },
    },
    async ({ session_id, script }) => json(await executeInSession({ session_id, script })),
  );

  server.registerTool(
    "playwright_close",
    {
      title: "Playwright Close",
      description: "Close a playwright session and its browser. Call when done with a prepared session.",
      inputSchema: {
        session_id: z.string().describe("Session id to close."),
      },
    },
    async ({ session_id }) => {
      const closed = closeSession(session_id);
      return json(
        closed
          ? { closed: true, session_id }
          : { closed: false, session_id, error: "No active session with that id." },
      );
    },
  );

  server.registerTool(
    "playwright_sessions",
    {
      title: "Playwright Sessions",
      description:
        "List active playwright sessions (target, current URL, idle time) and the configured target names.",
      inputSchema: {},
    },
    async () => json({ sessions: listSessions(), available_targets: availableTargets() }),
  );
};
