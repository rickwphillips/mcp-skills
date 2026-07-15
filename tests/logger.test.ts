import { describe, it, expect, vi, afterEach } from "vitest";
import { redact, logger } from "../src/lib/logger.js";

describe("redact: key-based masking", () => {
  it("masks keys named 'token'", () => {
    expect(redact({ token: "abc" })).toEqual({ token: "[REDACTED]" });
  });

  it("masks keys named 'password'", () => {
    expect(redact({ password: "p" })).toEqual({ password: "[REDACTED]" });
  });

  it("masks keys named 'cookie' / 'authorization' / 'secret' / 'api_key' / 'apiKey'", () => {
    expect(redact({ cookie: "c" })).toEqual({ cookie: "[REDACTED]" });
    expect(redact({ authorization: "a" })).toEqual({ authorization: "[REDACTED]" });
    expect(redact({ secret: "s" })).toEqual({ secret: "[REDACTED]" });
    expect(redact({ api_key: "k" })).toEqual({ api_key: "[REDACTED]" });
    expect(redact({ apiKey: "k" })).toEqual({ apiKey: "[REDACTED]" });
    expect(redact({ "api-key": "k" })).toEqual({ "api-key": "[REDACTED]" });
  });

  it("masks keys that contain the matching substring (e.g. accessToken)", () => {
    expect(redact({ accessToken: "x" })).toEqual({ accessToken: "[REDACTED]" });
    expect(redact({ refresh_token: "x" })).toEqual({ refresh_token: "[REDACTED]" });
    expect(redact({ user_password: "x" })).toEqual({ user_password: "[REDACTED]" });
  });

  it("leaves unrelated keys untouched", () => {
    expect(redact({ id: 5, name: "alice" })).toEqual({ id: 5, name: "alice" });
  });

  it("masks at any depth", () => {
    expect(redact({ outer: { inner: { token: "x" } } })).toEqual({
      outer: { inner: { token: "[REDACTED]" } },
    });
  });
});

describe("redact: value-based masking", () => {
  it("masks GitLab personal access tokens (glpat-)", () => {
    expect(redact("connecting with glpat-AbCdEf123-456_789")).toBe("connecting with [REDACTED]");
  });

  it("masks GitLab OAuth tokens (gloas-)", () => {
    expect(redact("Bearer gloas-XyZ123_AbC-456")).toBe("Bearer [REDACTED]");
  });

  it("masks Atlassian API tokens (ATATT)", () => {
    expect(redact("ATATT3xFfGF0bC123_ABC")).toBe("[REDACTED]");
  });

  it("masks inline tokens within structured logs", () => {
    const result = redact({ msg: "auth failed with glpat-real-token", id: 1 });
    expect(result).toEqual({ msg: "auth failed with [REDACTED]", id: 1 });
  });

  it("leaves normal strings alone", () => {
    expect(redact("the cat sat on the mat")).toBe("the cat sat on the mat");
  });
});

describe("redact: edge cases", () => {
  it("handles arrays", () => {
    expect(redact([{ token: "x" }, { id: 1 }])).toEqual([{ token: "[REDACTED]" }, { id: 1 }]);
  });

  it("returns primitives unchanged", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it("hits depth limit and returns sentinel", () => {
    // 8 levels deep should exceed the depth-6 cap
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: "deep" } } } } } } } };
    const result = JSON.stringify(redact(deep));
    expect(result).toContain("depth-limit");
  });

  it("does not mask key 'apricot' (false-positive guard for substring 'api')", () => {
    // The REDACT_KEY regex uses `api[_-]?key`, so 'apricot' shouldn't match.
    expect(redact({ apricot: "tasty" })).toEqual({ apricot: "tasty" });
  });
});

function captureStderr(fn: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    try {
      lines.push(JSON.parse(chunk as string));
    } catch {
      // not JSON
    }
    return true;
  });
  fn();
  spy.mockRestore();
  return lines;
}

describe("logger methods: normalize + write", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info writes a JSON line to stderr with level=info", () => {
    const lines = captureStderr(() => logger.info({ tool: "my_tool", ok: true }));
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("info");
    expect(lines[0].tool).toBe("my_tool");
    expect(lines[0].ok).toBe(true);
    expect(typeof lines[0].ts).toBe("string");
  });

  it("debug is suppressed at the default info level", () => {
    const lines = captureStderr(() => logger.debug({ msg: "verbose" }));
    expect(lines).toHaveLength(0);
  });

  it("warn writes to stderr and includes level=warn", () => {
    const lines = captureStderr(() => logger.warn("something wrong"));
    expect(lines[0].level).toBe("warn");
    expect(lines[0].msg).toBe("something wrong");
  });

  it("error writes to stderr with level=error", () => {
    const lines = captureStderr(() => logger.error("fatal"));
    expect(lines[0].level).toBe("error");
  });

  it("string arg normalizes to {msg: string}", () => {
    const lines = captureStderr(() => logger.info("hello world"));
    expect(lines[0].msg).toBe("hello world");
  });

  it("null arg normalizes to empty payload (only ts/level/pid)", () => {
    const lines = captureStderr(() => logger.info(null));
    expect(lines[0].level).toBe("info");
    expect(lines[0].msg).toBeUndefined();
  });

  it("number arg normalizes to {msg: string representation}", () => {
    const lines = captureStderr(() => logger.info(42));
    expect(lines[0].msg).toBe("42");
  });

  it("Error instance arg normalizes to {err: {name, message, stack}}", () => {
    const lines = captureStderr(() => logger.error(new Error("raw error")));
    expect(lines[0].err).toMatchObject({ name: "Error", message: "raw error" });
  });

  it("object with err:Error serializes the Error", () => {
    const lines = captureStderr(() => logger.error({ tool: "t", err: new Error("disk full") }));
    expect(lines[0].err).toMatchObject({ name: "Error", message: "disk full" });
    expect((lines[0].err as Record<string, unknown>).stack).toBeDefined();
  });

  it("redacts sensitive keys in log payload", () => {
    const lines = captureStderr(() => logger.info({ token: "secret123", id: 1 }));
    expect(lines[0].token).toBe("[REDACTED]");
    expect(lines[0].id).toBe(1);
  });

  it("exposes level, filePath, fileEnabled, auditEnabled, auditPath on logger", () => {
    expect(logger.level).toBe("info");
    expect(logger.fileEnabled).toBe(true);
    expect(logger.auditEnabled).toBe(true);
    expect(logger.auditPath).toContain("errors.jsonl");
    expect(logger.filePath).toContain("server-");
  });
});

describe("logger: readOptions env configuration", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  async function freshLogger(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return (await import("../src/lib/logger.js")).logger;
  }

  it("honors MCP_SKILLS_LOG_LEVEL=debug", async () => {
    expect((await freshLogger({ MCP_SKILLS_LOG_LEVEL: "debug" })).level).toBe("debug");
  });

  it("falls back to info for an unrecognized level", async () => {
    expect((await freshLogger({ MCP_SKILLS_LOG_LEVEL: "bogus" })).level).toBe("info");
  });

  it("disables file logging when MCP_SKILLS_LOG_FILE=off", async () => {
    const l = await freshLogger({ MCP_SKILLS_LOG_FILE: "off" });
    expect(l.fileEnabled).toBe(false);
    expect(l.filePath).toBeNull();
  });

  it("uses a custom file path when MCP_SKILLS_LOG_FILE is a path", async () => {
    expect((await freshLogger({ MCP_SKILLS_LOG_FILE: "/tmp/custom-mcp.log" })).filePath).toBe(
      "/tmp/custom-mcp.log",
    );
  });

  it("disables audit when MCP_SKILLS_AUDIT=off", async () => {
    expect((await freshLogger({ MCP_SKILLS_AUDIT: "off" })).auditEnabled).toBe(false);
  });
});
