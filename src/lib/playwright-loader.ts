// playwright-loader.ts — resolve chromium from the ACTIVE Node's GLOBAL
// @playwright/test install, self-healing on a miss (ported from newsbank-mcp).
//
// Global installs are per-Node under nvm, so the global folder is empty on any
// Node that never had `npm install -g @playwright/test` run against it. On a
// resolution miss, install it once for the current Node (reusing the shared
// ms-playwright browser cache), then retry.
//
// Excluded from coverage alongside db-pool.ts: it is a thin shell around
// execSync/createRequire side effects with no branchable logic worth mocking.

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { logger } from "./logger.js";
import type { PWBrowser } from "./playwright-session.js";

export interface PlaywrightChromium {
  launch(options?: { headless?: boolean }): Promise<PWBrowser>;
}

function resolveGlobalChromium(): PlaywrightChromium {
  const globalRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
  const pwPath = path.join(globalRoot, "@playwright", "test");
  const req = createRequire(import.meta.url);
  const pw = req(pwPath) as { chromium?: PlaywrightChromium };
  if (!pw?.chromium) throw new Error(`resolved ${pwPath} but it has no chromium export`);
  return pw.chromium;
}

export function loadChromium(): PlaywrightChromium {
  try {
    return resolveGlobalChromium();
  } catch (firstErr) {
    logger.warn({
      msg: "playwright-session: global @playwright/test missing for current Node — self-healing",
      err: String(firstErr),
    });
    try {
      execSync("npm install -g @playwright/test", { encoding: "utf-8", stdio: "pipe" });
      try {
        execSync("npx --yes playwright install chromium", { encoding: "utf-8", stdio: "pipe" });
      } catch (browserErr) {
        logger.warn({ msg: "playwright-session: chromium ensure step failed (cache may already cover it)", err: String(browserErr) });
      }
    } catch (installErr) {
      throw new Error(
        `Global @playwright/test was missing and auto-install failed: ${String(installErr)}. ` +
          `Run \`npm install -g @playwright/test && npx playwright install chromium\` for the active Node.`,
      );
    }
    return resolveGlobalChromium();
  }
}
