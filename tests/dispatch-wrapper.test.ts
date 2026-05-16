import { describe, it, expect, vi, afterEach } from "vitest";
import { extractSwallowedError, wrapRegisterTool } from "../src/lib/dispatch-wrapper.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Prevent real audit writes from contaminating the shared MCP_SKILLS_HOME temp dir
// used by audit-patterns.test.ts running in a parallel fork.
vi.mock("../src/lib/audit-patterns.js", () => ({
  getSteeringForPattern: vi.fn().mockReturnValue(null),
}));

function envelope(body: object): unknown {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

describe("extractSwallowedError", () => {
  it("returns null for a non-error tool result", () => {
    expect(extractSwallowedError(envelope({ ok: true, rows: [] }))).toBeNull();
  });

  it("returns null for a non-object result", () => {
    expect(extractSwallowedError(null)).toBeNull();
    expect(extractSwallowedError(undefined)).toBeNull();
    expect(extractSwallowedError("just a string")).toBeNull();
  });

  it("returns null when content is missing or not an array", () => {
    expect(extractSwallowedError({})).toBeNull();
    expect(extractSwallowedError({ content: "nope" })).toBeNull();
  });

  it("detects {error: string}", () => {
    expect(extractSwallowedError(envelope({ error: "connect refused" }))).toBe("connect refused");
  });

  it("detects {error: {message}}", () => {
    expect(extractSwallowedError(envelope({ error: { message: "boom" } }))).toBe("boom");
  });

  it("detects {error: {name}} when message is missing", () => {
    expect(extractSwallowedError(envelope({ error: { name: "AccessDenied" } }))).toBe("AccessDenied");
  });

  it("detects {errors: [string]}", () => {
    expect(extractSwallowedError(envelope({ errors: ["bad input", "missing field"] }))).toBe(
      "bad input; missing field",
    );
  });

  it("detects {errors: [{message}]}", () => {
    expect(
      extractSwallowedError(envelope({ errors: [{ message: "a" }, { message: "b" }] })),
    ).toBe("a; b");
  });

  it("detects {errors: {field: msg}} (Jira-style field map)", () => {
    const result = extractSwallowedError(envelope({ errors: { summary: "required", labels: "invalid" } }));
    expect(result).toContain("summary: required");
    expect(result).toContain("labels: invalid");
  });

  it("detects {status: 'error', message}", () => {
    expect(
      extractSwallowedError(envelope({ status: "error", message: "mysql native error" })),
    ).toBe("mysql native error");
  });

  it("detects {status: 'ERROR', message} (case variant from db_write)", () => {
    expect(
      extractSwallowedError(envelope({ status: "ERROR", message: "REQUIRES_CONFIRMATION" })),
    ).toBe("REQUIRES_CONFIRMATION");
  });

  it("detects {ok: false, message}", () => {
    expect(extractSwallowedError(envelope({ ok: false, message: "bad arg" }))).toBe("bad arg");
  });

  it("detects {ok: false, reason}", () => {
    expect(extractSwallowedError(envelope({ ok: false, reason: "no auth" }))).toBe("no auth");
  });

  it("detects isError flag at the result level", () => {
    expect(
      extractSwallowedError({ isError: true, content: [{ type: "text", text: "whatever" }] }),
    ).toBe("isError flag set on tool result");
  });

  it("ignores text blocks that aren't JSON", () => {
    expect(
      extractSwallowedError({ content: [{ type: "text", text: "this is not JSON" }] }),
    ).toBeNull();
  });

  it("ignores text blocks without error keywords (cheap prefilter)", () => {
    expect(
      extractSwallowedError({
        content: [{ type: "text", text: JSON.stringify({ rows: [], count: 5 }) }],
      }),
    ).toBeNull();
  });

  it("skips non-text content blocks", () => {
    expect(
      extractSwallowedError({
        content: [
          { type: "image", text: "won't parse this" },
          { type: "text", text: JSON.stringify({ error: "real one" }) },
        ],
      }),
    ).toBe("real one");
  });

  it("detects {error: {}} with no message/name — falls to safeStringify", () => {
    const result = extractSwallowedError(envelope({ error: { code: 404 } }));
    expect(result).toContain("404");
  });

  it("detects {errors: [{code}]} — object with no .message falls to safeStringify", () => {
    const result = extractSwallowedError(envelope({ errors: [{ code: 500 }] }));
    expect(result).toContain("500");
  });

  it("returns sentinel when status=error but no message field", () => {
    expect(extractSwallowedError(envelope({ status: "error" }))).toBe(
      "status=error with no message",
    );
  });

  it("returns sentinel when ok=false and neither message nor reason present", () => {
    expect(extractSwallowedError(envelope({ ok: false }))).toBe("ok=false with no message");
  });
});

function makeMockServer() {
  let capturedCb: ((...args: unknown[]) => unknown) | null = null;
  const original = vi.fn((_name: string, _config: unknown, cb: (...args: unknown[]) => unknown) => {
    capturedCb = cb;
  });
  const server = { registerTool: original } as unknown as McpServer;
  return { server, getWrappedCb: () => capturedCb };
}

describe("wrapRegisterTool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces server.registerTool with a wrapped version", () => {
    const { server } = makeMockServer();
    const originalFn = server.registerTool;
    wrapRegisterTool(server);
    expect(server.registerTool).not.toBe(originalFn);
  });

  it("calls through to the original callback on success and returns the result", async () => {
    const { server, getWrappedCb } = makeMockServer();
    wrapRegisterTool(server);

    const toolResult = { content: [{ type: "text", text: '{"status":"OK"}' }] };
    const originalCb = vi.fn().mockResolvedValue(toolResult);
    server.registerTool("my_tool", {} as never, originalCb as never);

    const wrappedCb = getWrappedCb()!;
    const result = await wrappedCb({}, {});
    expect(result).toEqual(toolResult);
    expect(originalCb).toHaveBeenCalledWith({}, {});
  });

  it("detects a swallowed error envelope and returns result unchanged (no steering in clean env)", async () => {
    const { server, getWrappedCb } = makeMockServer();
    wrapRegisterTool(server);

    const errorResult = { content: [{ type: "text", text: '{"error":"oops"}' }] };
    server.registerTool("my_tool", {} as never, vi.fn().mockResolvedValue(errorResult) as never);

    const wrappedCb = getWrappedCb()!;
    const result = await wrappedCb({}, {});
    expect(result).toEqual(errorResult);
  });

  it("rethrows exceptions thrown by the original callback", async () => {
    const { server, getWrappedCb } = makeMockServer();
    wrapRegisterTool(server);

    const boom = new Error("kaboom");
    server.registerTool("my_tool", {} as never, vi.fn().mockRejectedValue(boom) as never);

    const wrappedCb = getWrappedCb()!;
    await expect(wrappedCb({}, {})).rejects.toThrow("kaboom");
  });

  it("passes isError:true result through without modification", async () => {
    const { server, getWrappedCb } = makeMockServer();
    wrapRegisterTool(server);

    const isErrorResult = { isError: true, content: [{ type: "text", text: "plain error" }] };
    server.registerTool("my_tool", {} as never, vi.fn().mockResolvedValue(isErrorResult) as never);

    const wrappedCb = getWrappedCb()!;
    const result = await wrappedCb({}, {});
    // isError flag is detected as swallowed but no steering → result unchanged
    expect(result).toEqual(isErrorResult);
  });
});
