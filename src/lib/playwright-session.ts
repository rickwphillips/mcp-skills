// playwright-session.ts — in-process Playwright session management.
//
// Ported from the newsbank-mcp playwright_prepare/playwright_execute model,
// with one deliberate change: sessions PERSIST across execute calls. A session
// lives until playwright_close or 15 minutes of inactivity (the TTL resets on
// every use), so one logged-in browser profile can serve a whole multi-step
// verification flow instead of being consumed by the first script.
//
// Auth strategies (per playwright target in config):
//   jwt  — mint an HS256 token locally from the credential's secret and inject
//          it into localStorage before first navigation (the shared-auth model
//          used by commander/portfolio/grandkid).
//   form — fill a generic login form with username + secret.
//   none — no auth (e.g. fbiconstructioninc).
//
// Secrets are resolved at prepare time from the macOS Keychain or an env var,
// per the credential's config entry. They are never persisted or returned.

import { execSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { loadChromium, type PlaywrightChromium } from "./playwright-loader.js";
import {
  getCredentialConfig,
  getPlaywrightTarget,
  listPlaywrightTargets,
  type CredentialConfig,
  type PlaywrightTargetConfig,
} from "../config/connections.js";
import { logger } from "./logger.js";

// ── Minimal Playwright types (loaded dynamically from the global install) ───

interface PWLocator {
  count(): Promise<number>;
  fill(v: string): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
  press(key: string): Promise<void>;
  first(): PWLocator;
}

export interface PWPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  locator(selector: string): PWLocator;
  addInitScript(fn: (arg: string) => void, arg: string): Promise<void>;
  waitForURL(predicate: (u: { toString(): string }) => boolean, options?: { timeout?: number }): Promise<void>;
  waitForLoadState(state: string): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  url(): string;
}

export interface PWBrowser {
  newPage(options?: { viewport?: { width: number; height: number }; ignoreHTTPSErrors?: boolean }): Promise<PWPage>;
  close(): Promise<void>;
}

// ── Session map ──────────────────────────────────────────────────────────────

export const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes idle

interface SessionEntry {
  browser: PWBrowser;
  page: PWPage;
  target: string;
  baseUrl: string;
  credentialName: string | null;
  consoleErrors: string[];
  createdAt: number;
  lastUsedAt: number;
  executeCount: number;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, SessionEntry>();

function randomHex(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

export function closeSession(sessionId: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  sessions.delete(sessionId);
  clearTimeout(entry.timer);
  entry.browser.close().catch((err: unknown) => {
    logger.warn({ msg: "playwright-session: browser.close() error", sessionId, err });
  });
  return true;
}

function resetTtl(sessionId: string, entry: SessionEntry): void {
  clearTimeout(entry.timer);
  entry.lastUsedAt = Date.now();
  entry.timer = setTimeout(() => {
    logger.info({ msg: "playwright-session: idle TTL expired", sessionId });
    closeSession(sessionId);
  }, SESSION_TTL_MS);
}

export interface SessionInfo {
  session_id: string;
  target: string;
  base_url: string;
  credential: string | null;
  current_url: string;
  execute_count: number;
  idle_seconds: number;
  age_seconds: number;
}

export function listSessions(): SessionInfo[] {
  const now = Date.now();
  return [...sessions.entries()].map(([id, s]) => ({
    session_id: id,
    target: s.target,
    base_url: s.baseUrl,
    credential: s.credentialName,
    current_url: safeUrl(s.page),
    execute_count: s.executeCount,
    idle_seconds: Math.round((now - s.lastUsedAt) / 1000),
    age_seconds: Math.round((now - s.createdAt) / 1000),
  }));
}

function safeUrl(page: PWPage): string {
  try {
    return page.url();
  } catch {
    return "(unavailable)";
  }
}

// ── Secret resolution ────────────────────────────────────────────────────────

/**
 * Fetch the credential's secret from wherever the config entry records it.
 * Never cached to disk; keychain reads go through `security` on demand.
 */
export function resolveSecret(cred: CredentialConfig, name: string): string {
  switch (cred.method) {
    case "keychain": {
      const secret = execSync(
        `security find-generic-password -s ${JSON.stringify(cred.keychain_service)} -a ${JSON.stringify(cred.keychain_account)} -w`,
        { encoding: "utf-8" },
      ).trim();
      if (!secret) throw new Error(`Keychain entry ${cred.keychain_service}/${cred.keychain_account} is empty.`);
      return secret;
    }
    case "env": {
      const secret = process.env[cred.secret_env];
      if (!secret) {
        throw new Error(`Credential "${name}" expects the secret in env var ${cred.secret_env}, which is not set.`);
      }
      return secret;
    }
    default: {
      const exhaustive: never = cred;
      throw new Error(`Credential "${name}" has an unknown method: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ── JWT minting (HS256, matches the PHP jwt_encode implementation) ──────────

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

export function mintJwt(secret: string, userId: string, username: string, ttlSeconds = 86400): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: userId, username, iat: now, exp: now + ttlSeconds }),
  );
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// ── Auth strategies ──────────────────────────────────────────────────────────

async function loginJwt(
  page: PWPage,
  target: PlaywrightTargetConfig,
  cred: CredentialConfig,
  credName: string,
): Promise<void> {
  if (cred.kind !== "jwt" || !cred.user_id || !cred.username) {
    throw new Error(
      `Credential "${credName}" is not a jwt credential (needs kind: "jwt", user_id, username).`,
    );
  }
  const secret = resolveSecret(cred, credName);
  const token = mintJwt(secret, cred.user_id, cred.username);
  const storageKey = target.storage_key ?? "auth_token";
  // Inject before first navigation so the app sees the token on first render.
  await page.addInitScript(
    (arg: string) => {
      const { key, value } = JSON.parse(arg) as { key: string; value: string };
      localStorage.setItem(key, value);
    },
    JSON.stringify({ key: storageKey, value: token }),
  );
  await page.goto(target.base_url + "/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function loginForm(
  page: PWPage,
  target: PlaywrightTargetConfig,
  cred: CredentialConfig,
  credName: string,
): Promise<void> {
  const username = cred.username;
  if (!username) throw new Error(`Credential "${credName}" has no username for a form login.`);
  const password = resolveSecret(cred, credName);
  const loginUrl = target.base_url + (target.login_path ?? "/login");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  const u = page.locator('#username, input[name="username"], input[type="text"], input[type="email"]').first();
  const p = page.locator('#password, input[name="password"], input[type="password"]').first();
  if (await p.count()) {
    await u.fill(username);
    await p.fill(password);
    const submit = page.locator('button[type="submit"], input[type="submit"]').first();
    if (await submit.count()) {
      await submit.click();
    } else {
      await p.press("Enter");
    }
    await page.waitForURL((u2) => !/\/login\b/i.test(u2.toString()), { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}

// ── prepare ──────────────────────────────────────────────────────────────────

export interface PrepareInput {
  target: string;
  credential?: string;
  viewport?: { width: number; height: number };
}

export interface PrepareResult {
  session_id: string;
  target: string;
  base_url: string;
  auth: string;
  credential_used: string | null;
  ready: boolean;
  error?: string;
}

// Injectable chromium loader for tests.
let chromiumLoader: () => PlaywrightChromium = loadChromium;
export function setChromiumLoaderForTests(loader: (() => PlaywrightChromium) | null): void {
  chromiumLoader = loader ?? loadChromium;
}

export async function prepareSession(input: PrepareInput): Promise<PrepareResult> {
  const targetName = input.target;
  let target: PlaywrightTargetConfig;
  try {
    target = getPlaywrightTarget(targetName);
  } catch (err) {
    return { session_id: "", target: targetName, base_url: "", auth: "", credential_used: null, ready: false, error: String(err instanceof Error ? err.message : err) };
  }

  const auth = target.auth ?? "none";
  const credName = input.credential ?? target.credential ?? null;
  const fail = (error: string): PrepareResult => ({
    session_id: "",
    target: targetName,
    base_url: target.base_url,
    auth,
    credential_used: credName,
    ready: false,
    error,
  });

  let cred: CredentialConfig | null = null;
  if (auth !== "none") {
    if (!credName) return fail(`Target "${targetName}" uses auth "${auth}" but no credential is named (config or input).`);
    try {
      cred = getCredentialConfig(credName);
    } catch (err) {
      return fail(String(err instanceof Error ? err.message : err));
    }
  }

  let chromium: PlaywrightChromium;
  try {
    chromium = chromiumLoader();
  } catch (err) {
    return fail(`Failed to load global @playwright/test: ${String(err instanceof Error ? err.message : err)}`);
  }

  let browser: PWBrowser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    return fail(`Browser launch failed: ${String(err instanceof Error ? err.message : err)}`);
  }

  const consoleErrors: string[] = [];
  let page: PWPage;
  try {
    page = await browser.newPage({
      viewport: input.viewport ?? { width: 1440, height: 900 },
      ignoreHTTPSErrors: target.base_url.startsWith("https://"),
    });
    page.on("console", (m: unknown) => {
      const msg = m as { type(): string; text(): string };
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    if (auth === "jwt" && cred && credName) {
      await loginJwt(page, target, cred, credName);
    } else if (auth === "form" && cred && credName) {
      await loginForm(page, target, cred, credName);
    } else {
      await page.goto(target.base_url + "/", { waitUntil: "domcontentloaded" });
    }
  } catch (err) {
    await browser.close().catch(() => {});
    return fail(`Login/navigation failed: ${String(err instanceof Error ? err.message : err)}`);
  }

  const sessionId = randomHex();
  const now = Date.now();
  const timer = setTimeout(() => closeSession(sessionId), SESSION_TTL_MS);
  sessions.set(sessionId, {
    browser,
    page,
    target: targetName,
    baseUrl: target.base_url,
    credentialName: credName,
    consoleErrors,
    createdAt: now,
    lastUsedAt: now,
    executeCount: 0,
    timer,
  });

  logger.info({ msg: "playwright-session: ready", sessionId, target: targetName, auth, credName });
  return { session_id: sessionId, target: targetName, base_url: target.base_url, auth, credential_used: credName, ready: true };
}

// ── execute ──────────────────────────────────────────────────────────────────

export interface ExecuteInput {
  session_id: string;
  script: string;
}

export interface ExecuteResult {
  result?: unknown;
  console_errors: string[];
  session_alive: boolean;
  error?: string;
}

/**
 * Run an agent-supplied async function body against the live session's page.
 * The session SURVIVES the call (success or script error) — it is only torn
 * down by closeSession or the idle TTL. Console errors are drained per call.
 */
export async function executeInSession(input: ExecuteInput): Promise<ExecuteResult> {
  const entry = sessions.get(input.session_id);
  if (!entry) {
    const active = [...sessions.keys()];
    return {
      console_errors: [],
      session_alive: false,
      error:
        `No active session for id "${input.session_id}". ` +
        (active.length ? `Active sessions: ${active.join(", ")}.` : "Call playwright_prepare first."),
    };
  }

  resetTtl(input.session_id, entry);
  entry.executeCount += 1;
  const { page, baseUrl, consoleErrors } = entry;

  let result: unknown;
  try {
    // new Function is appropriate here: the script comes from our own agent.
    const fn = new Function("page", "baseUrl", `return (async () => { ${input.script} })()`);
    result = await (fn(page, baseUrl) as Promise<unknown>);
  } catch (err) {
    const drained = consoleErrors.splice(0);
    return {
      console_errors: drained,
      session_alive: true,
      error: `Script execution error: ${String(err instanceof Error ? err.message : err)}`,
    };
  }

  const drained = consoleErrors.splice(0);
  return { result, console_errors: drained, session_alive: true };
}

export function availableTargets(): string[] {
  return listPlaywrightTargets();
}
