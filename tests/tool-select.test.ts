import { describe, it, expect, vi } from "vitest";
import { parseSelector, applySliceFilter } from "../src/tool-select.js";
import { ALWAYS_ON, TOOL_GROUPS, GROUPS } from "../src/tool-groups.js";
import { registerTools } from "../src/tools/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Capture every tool name registerTools wires up, without a real server.
// Tool registrars only call registerTool(name, config, cb) at registration time;
// the callbacks never run here, so a minimal stub is enough.
function captureRegisteredNames(): string[] {
  const names: string[] = [];
  const stub = {
    registerTool: (name: string) => {
      names.push(name);
      return { enable() {}, disable() {}, remove() {}, update() {} };
    },
  } as unknown as McpServer;
  registerTools(stub);
  return names;
}

describe("tool-groups coverage", () => {
  it("every registered tool belongs to exactly one group or is always-on", () => {
    const registered = captureRegisteredNames();
    const ungrouped = registered.filter(
      (n) => !(n in TOOL_GROUPS) && !ALWAYS_ON.includes(n),
    );
    expect(ungrouped).toEqual([]);
  });

  it("no group token collides with a tool name", () => {
    for (const g of GROUPS) {
      expect(g in TOOL_GROUPS).toBe(false);
    }
  });
});

describe("parseSelector", () => {
  it("unset selector matches all", () => {
    const s = parseSelector(undefined);
    expect(s.matchAll).toBe(true);
    expect(s.includes("db_read")).toBe(true);
    expect(s.includes("pdf_merge")).toBe(true);
    expect(s.includesGroup("resources")).toBe(true);
  });

  it("empty / whitespace selector matches all", () => {
    expect(parseSelector("   ").matchAll).toBe(true);
  });

  it("group token includes that group's tools and excludes others", () => {
    const s = parseSelector("db");
    expect(s.matchAll).toBe(false);
    expect(s.includes("db_read")).toBe(true);
    expect(s.includes("db_write")).toBe(true);
    expect(s.includes("list_db_connections")).toBe(true);
    expect(s.includes("pdf_merge")).toBe(false);
    expect(s.includesGroup("db")).toBe(true);
    expect(s.includesGroup("pdf")).toBe(false);
    expect(s.includesGroup("resources")).toBe(false);
  });

  it("multiple tokens, comma or whitespace separated", () => {
    const s = parseSelector("db, pdf");
    expect(s.includes("db_read")).toBe(true);
    expect(s.includes("pdf_split")).toBe(true);
    expect(s.includes("record_audio")).toBe(false);
  });

  it("always-on tools register under any non-matching selector", () => {
    const s = parseSelector("pdf");
    for (const n of ALWAYS_ON) expect(s.includes(n)).toBe(true);
  });

  it("per-tool token touches its group without pulling siblings", () => {
    const s = parseSelector("db_read");
    expect(s.includes("db_read")).toBe(true);
    expect(s.includes("db_write")).toBe(false);
    expect(s.includesGroup("db")).toBe(true);
  });

  it("unknown tokens are collected, not thrown", () => {
    const s = parseSelector("db, bogus, nope");
    expect(s.unknown).toEqual(["bogus", "nope"]);
    expect(s.includes("db_read")).toBe(true);
  });
});

describe("applySliceFilter", () => {
  function makeServer() {
    const registered: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => {
        registered.push(name);
        return { enable() {}, disable() {}, remove() {}, update() {} };
      }),
    } as unknown as McpServer;
    return { server, registered };
  }

  it("passes through selected tools and records their names", () => {
    const { server } = makeServer();
    const names: string[] = [];
    applySliceFilter(server, parseSelector("db"), names);
    server.registerTool("db_read", {} as never, (() => {}) as never);
    server.registerTool("pdf_merge", {} as never, (() => {}) as never);
    server.registerTool("get_version", {} as never, (() => {}) as never); // always-on
    expect(names).toEqual(["db_read", "get_version"]);
  });

  it("filtered-out tool returns a chainable no-op (no crash)", () => {
    const { server } = makeServer();
    applySliceFilter(server, parseSelector("db"), []);
    const reg = server.registerTool("pdf_merge", {} as never, (() => {}) as never);
    expect(() => reg.enable().update({} as never).disable().remove()).not.toThrow();
  });
});
