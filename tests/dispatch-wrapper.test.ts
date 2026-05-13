import { describe, it, expect } from "vitest";
import { extractSwallowedError } from "../src/lib/dispatch-wrapper.js";

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
});
