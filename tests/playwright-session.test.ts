// Tests for the persistent in-process Playwright session lib.
// Chromium is injected via setChromiumLoaderForTests — no real browser here.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Controllable execSync mock (keychain reads in resolveSecret).
const execSyncMock = vi.fn();
vi.mock("node:child_process", () => ({ execSync: (...args: unknown[]) => execSyncMock(...args) }));

// Config file must exist BEFORE the config module is imported.
const configDir = mkdtempSync(join(tmpdir(), "mcp-skills-pw-test-"));
const configPath = join(configDir, "config.json");
writeFileSync(
  configPath,
  JSON.stringify({
    connections: {},
    credentials: {
      jwt_env: {
        method: "env",
        secret_env: "PW_TEST_JWT_SECRET",
        kind: "jwt",
        user_id: "user-uuid-1",
        username: "rick",
      },
      jwt_keychain: {
        method: "keychain",
        keychain_service: "test-secrets",
        keychain_account: "JWT_SECRET",
        kind: "jwt",
        user_id: "user-uuid-1",
        username: "rick",
      },
      form_env: {
        method: "env",
        secret_env: "PW_TEST_FORM_PASS",
        username: "rick",
      },
      no_username_form: { method: "env", secret_env: "PW_TEST_FORM_PASS" },
      password_not_jwt: { method: "env", secret_env: "PW_TEST_FORM_PASS", username: "rick" },
    },
    playwrightTargets: {
      "app-jwt": { base_url: "http://localhost:3001", auth: "jwt", credential: "jwt_env" },
      "app-form": { base_url: "http://localhost:3000", auth: "form", credential: "form_env" },
      "no-auth": { base_url: "https://example.com" },
      "auth-no-cred": { base_url: "http://localhost:9", auth: "jwt" },
    },
  }),
);
process.env.MCP_SKILLS_CONFIG = configPath;

const lib = await import("../src/lib/playwright-session.js");
const {
  prepareSession,
  executeInSession,
  closeSession,
  listSessions,
  mintJwt,
  resolveSecret,
  setChromiumLoaderForTests,
  availableTargets,
  SESSION_TTL_MS,
} = lib;

// ── Fakes ────────────────────────────────────────────────────────────────────

function fakeLocator(overrides: Partial<Record<string, unknown>> = {}) {
  const locator: Record<string, unknown> = {
    count: vi.fn(async () => 1),
    fill: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    ...overrides,
  };
  locator.first = vi.fn(() => locator);
  return locator;
}

function fakePage() {
  const consoleHandlers: Array<(...args: unknown[]) => void> = [];
  const locator = fakeLocator();
  const page = {
    calls: { goto: [] as string[], initScripts: [] as string[] },
    locator: vi.fn(() => locator),
    _locator: locator,
    goto: vi.fn(async function (this: void, url: string) {
      page.calls.goto.push(url);
    }),
    addInitScript: vi.fn(async (_fn: unknown, arg: string) => {
      page.calls.initScripts.push(arg);
    }),
    waitForURL: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "console") consoleHandlers.push(handler);
    }),
    url: vi.fn(() => "http://localhost:3001/dashboard"),
    emitConsoleError(text: string) {
      for (const h of consoleHandlers) h({ type: () => "error", text: () => text });
    },
  };
  return page;
}

function fakeChromium(page = fakePage()) {
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  const chromium = { launch: vi.fn(async () => browser) };
  return { chromium, browser, page };
}

afterEach(() => {
  for (const s of listSessions()) closeSession(s.session_id);
  setChromiumLoaderForTests(null);
  execSyncMock.mockReset();
});

beforeAll(() => {
  process.env.PW_TEST_JWT_SECRET = "test-secret";
  process.env.PW_TEST_FORM_PASS = "form-pass";
});

afterAll(() => {
  delete process.env.PW_TEST_JWT_SECRET;
  delete process.env.PW_TEST_FORM_PASS;
  rmSync(configDir, { recursive: true, force: true });
});

// ── mintJwt ──────────────────────────────────────────────────────────────────

describe("mintJwt", () => {
  it("produces a valid HS256 token with sub/username/iat/exp claims", () => {
    const token = mintJwt("s3cret", "uuid-1", "rick", 3600);
    const [h, p, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload.sub).toBe("uuid-1");
    expect(payload.username).toBe("rick");
    expect(payload.exp - payload.iat).toBe(3600);
    const expected = createHmac("sha256", "s3cret").update(`${h}.${p}`).digest("base64url");
    expect(sig).toBe(expected);
  });
});

// ── resolveSecret ────────────────────────────────────────────────────────────

describe("resolveSecret", () => {
  it("reads env credentials", () => {
    expect(resolveSecret({ method: "env", secret_env: "PW_TEST_JWT_SECRET" }, "x")).toBe("test-secret");
  });

  it("throws when the env var is unset", () => {
    expect(() => resolveSecret({ method: "env", secret_env: "PW_TEST_MISSING" }, "x")).toThrow(/PW_TEST_MISSING/);
  });

  it("reads keychain credentials via security find-generic-password", () => {
    execSyncMock.mockReturnValueOnce("kc-secret\n");
    const cred = { method: "keychain" as const, keychain_service: "svc", keychain_account: "acct" };
    expect(resolveSecret(cred, "x")).toBe("kc-secret");
    expect(execSyncMock.mock.calls[0][0]).toContain('security find-generic-password -s "svc" -a "acct" -w');
  });

  it("throws when the keychain entry is empty", () => {
    execSyncMock.mockReturnValueOnce("\n");
    const cred = { method: "keychain" as const, keychain_service: "svc", keychain_account: "acct" };
    expect(() => resolveSecret(cred, "x")).toThrow(/empty/);
  });

  it("throws on an unknown credential method", () => {
    expect(() => resolveSecret({ method: "vault" } as never, "x")).toThrow(/unknown method/);
  });
});

// ── prepareSession ───────────────────────────────────────────────────────────

describe("prepareSession", () => {
  it("jwt target: injects the token into localStorage before first navigation", async () => {
    const { chromium, page } = fakeChromium();
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "app-jwt" });
    expect(res.ready).toBe(true);
    expect(res.session_id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.credential_used).toBe("jwt_env");
    const injected = JSON.parse(page.calls.initScripts[0]);
    expect(injected.key).toBe("auth_token");
    expect(injected.value.split(".")).toHaveLength(3);
    expect(page.calls.goto[0]).toBe("http://localhost:3001/");
  });

  it("form target: fills the login form with username + secret", async () => {
    const { chromium, page } = fakeChromium();
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "app-form" });
    expect(res.ready).toBe(true);
    expect(page.calls.goto[0]).toBe("http://localhost:3000/login");
    expect(page._locator.fill).toHaveBeenCalledWith("rick");
    expect(page._locator.fill).toHaveBeenCalledWith("form-pass");
    expect(page._locator.click).toHaveBeenCalled();
  });

  it("form target without a submit button presses Enter in the password field", async () => {
    const page = fakePage();
    // username/password fields exist; the submit locator reports 0 matches
    let call = 0;
    page._locator.count = vi.fn(async () => (++call <= 1 ? 1 : 0));
    const { chromium } = fakeChromium(page);
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "app-form" });
    expect(res.ready).toBe(true);
    expect(page._locator.press).toHaveBeenCalledWith("Enter");
  });

  it("form target with no login form fields skips the fill entirely", async () => {
    const page = fakePage();
    page._locator.count = vi.fn(async () => 0);
    const { chromium } = fakeChromium(page);
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "app-form" });
    expect(res.ready).toBe(true);
    expect(page._locator.fill).not.toHaveBeenCalled();
  });

  it("non-Error throws from launch/login are stringified", async () => {
    setChromiumLoaderForTests(() => ({ launch: async () => { throw "raw-string"; } }));
    const res = await prepareSession({ target: "no-auth" });
    expect(res.ready).toBe(false);
    expect(res.error).toMatch(/raw-string/);

    const page = fakePage();
    page.goto = vi.fn(async () => { throw "goto-string"; });
    const { chromium } = fakeChromium(page);
    setChromiumLoaderForTests(() => chromium);
    const res2 = await prepareSession({ target: "no-auth" });
    expect(res2.ready).toBe(false);
    expect(res2.error).toMatch(/goto-string/);
  });

  it("no-auth target: navigates without credentials", async () => {
    const { chromium, page } = fakeChromium();
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "no-auth" });
    expect(res.ready).toBe(true);
    expect(res.credential_used).toBeNull();
    expect(page.calls.goto[0]).toBe("https://example.com/");
  });

  it("unknown target: reports the configured targets", async () => {
    const res = await prepareSession({ target: "nope" });
    expect(res.ready).toBe(false);
    expect(res.error).toMatch(/Unknown playwright target/);
    expect(availableTargets()).toContain("app-jwt");
  });

  it("auth target without a credential name fails cleanly", async () => {
    const res = await prepareSession({ target: "auth-no-cred" });
    expect(res.ready).toBe(false);
    expect(res.error).toMatch(/no credential is named/);
  });

  it("credential override replaces the target default (keychain-backed)", async () => {
    const { chromium, page } = fakeChromium();
    setChromiumLoaderForTests(() => chromium);
    execSyncMock.mockReturnValue("kc-secret\n");
    const res = await prepareSession({ target: "app-jwt", credential: "jwt_keychain" });
    expect(res.ready).toBe(true);
    expect(res.credential_used).toBe("jwt_keychain");
    expect(execSyncMock.mock.calls[0][0]).toContain('"test-secrets"');
    expect(page.calls.initScripts).toHaveLength(1);
  });

  it("non-jwt credential on a jwt target fails cleanly and closes the browser", async () => {
    const { chromium, browser } = fakeChromium();
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "app-jwt", credential: "password_not_jwt" });
    expect(res.ready).toBe(false);
    expect(res.error).toMatch(/not a jwt credential/);
    expect(browser.close).toHaveBeenCalled();
  });

  it("form credential without username fails cleanly", async () => {
    const { chromium } = fakeChromium();
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "app-form", credential: "no_username_form" });
    expect(res.ready).toBe(false);
    expect(res.error).toMatch(/no username/);
  });

  it("browser launch failure is reported", async () => {
    setChromiumLoaderForTests(() => ({ launch: async () => { throw new Error("boom"); } }));
    const res = await prepareSession({ target: "no-auth" });
    expect(res.ready).toBe(false);
    expect(res.error).toMatch(/Browser launch failed: .*boom/);
  });

  it("chromium loader failure is reported", async () => {
    setChromiumLoaderForTests(() => {
      throw new Error("no global install");
    });
    const res = await prepareSession({ target: "no-auth" });
    expect(res.ready).toBe(false);
    expect(res.error).toMatch(/Failed to load global @playwright\/test/);
  });
});

// ── executeInSession — the persistence contract ──────────────────────────────

describe("executeInSession", () => {
  async function prepared() {
    const fixture = fakeChromium();
    setChromiumLoaderForTests(() => fixture.chromium);
    const res = await prepareSession({ target: "no-auth" });
    expect(res.ready).toBe(true);
    return { ...fixture, sessionId: res.session_id };
  }

  it("session survives multiple execute calls", async () => {
    const { sessionId, browser } = await prepared();
    const r1 = await executeInSession({ session_id: sessionId, script: "return 1 + 1;" });
    expect(r1.result).toBe(2);
    expect(r1.session_alive).toBe(true);
    const r2 = await executeInSession({ session_id: sessionId, script: "return baseUrl;" });
    expect(r2.result).toBe("https://example.com");
    expect(r2.session_alive).toBe(true);
    expect(browser.close).not.toHaveBeenCalled();
    expect(listSessions()[0].execute_count).toBe(2);
  });

  it("script errors do NOT consume the session", async () => {
    const { sessionId } = await prepared();
    const bad = await executeInSession({ session_id: sessionId, script: "throw new Error('nope');" });
    expect(bad.error).toMatch(/Script execution error: .*nope/);
    expect(bad.session_alive).toBe(true);
    const ok = await executeInSession({ session_id: sessionId, script: "return 'recovered';" });
    expect(ok.result).toBe("recovered");
  });

  it("script receives the live page object", async () => {
    const { sessionId, page } = await prepared();
    const r = await executeInSession({
      session_id: sessionId,
      script: "await page.goto(baseUrl + '/x'); return page.url();",
    });
    expect(page.calls.goto).toContain("https://example.com/x");
    expect(r.result).toBe("http://localhost:3001/dashboard");
  });

  it("console errors are drained per call", async () => {
    const { sessionId, page } = await prepared();
    page.emitConsoleError("first boom");
    const r1 = await executeInSession({ session_id: sessionId, script: "return 1;" });
    expect(r1.console_errors).toEqual(["first boom"]);
    const r2 = await executeInSession({ session_id: sessionId, script: "return 2;" });
    expect(r2.console_errors).toEqual([]);
  });

  it("unknown session id returns a helpful error", async () => {
    const r = await executeInSession({ session_id: "deadbeef", script: "return 1;" });
    expect(r.session_alive).toBe(false);
    expect(r.error).toMatch(/No active session/);
  });

  it("unknown session id lists active sessions when some exist", async () => {
    const { sessionId } = await prepared();
    const r = await executeInSession({ session_id: "deadbeef", script: "return 1;" });
    expect(r.error).toContain(sessionId);
  });

  it("non-Error script throws are stringified", async () => {
    const { sessionId } = await prepared();
    const r = await executeInSession({ session_id: sessionId, script: "throw 'plain';" });
    expect(r.error).toMatch(/plain/);
    expect(r.session_alive).toBe(true);
  });

  it("idle TTL closes the session; execute on it resets the clock", async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, browser } = await prepared();
      // Use just before expiry — TTL resets.
      await vi.advanceTimersByTimeAsync(SESSION_TTL_MS - 1000);
      await executeInSession({ session_id: sessionId, script: "return 1;" });
      await vi.advanceTimersByTimeAsync(SESSION_TTL_MS - 1000);
      expect(listSessions()).toHaveLength(1);
      // Now let it expire.
      await vi.advanceTimersByTimeAsync(SESSION_TTL_MS + 1000);
      expect(listSessions()).toHaveLength(0);
      expect(browser.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── close + list ─────────────────────────────────────────────────────────────

describe("closeSession / listSessions", () => {
  it("close tears down the browser and reports listSessions metadata", async () => {
    const { chromium, browser } = fakeChromium();
    setChromiumLoaderForTests(() => chromium);
    const res = await prepareSession({ target: "no-auth" });
    const [info] = listSessions();
    expect(info.target).toBe("no-auth");
    expect(info.base_url).toBe("https://example.com");
    expect(info.current_url).toBe("http://localhost:3001/dashboard");
    expect(closeSession(res.session_id)).toBe(true);
    expect(browser.close).toHaveBeenCalled();
    expect(listSessions()).toHaveLength(0);
    expect(closeSession(res.session_id)).toBe(false);
  });
});
