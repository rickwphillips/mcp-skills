import { describe, it, expect } from "vitest";
import { redact } from "../src/lib/logger.js";

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
