import { describe, it, expect, beforeAll } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResources } from "../src/resources/apps.js";
import { OPS_CONSOLE_URI, APP_HTML_MIME, OPS_CONSOLE_TOOL_META } from "../src/config/apps.js";

interface CapturedResource {
  name: string;
  uri: string;
  meta: { title?: string; description?: string; mimeType?: string };
  cb: (uri: URL) => Promise<{
    contents: { uri: string; mimeType?: string; text?: string }[];
  }>;
}

// Stub server capturing registerResource calls (mirrors the registerTool stub
// pattern in tool-select.test.ts).
const captured: CapturedResource[] = [];
const stubServer = {
  registerResource(
    name: string,
    uri: string,
    meta: CapturedResource["meta"],
    cb: CapturedResource["cb"],
  ) {
    captured.push({ name, uri, meta, cb });
    return {};
  },
} as unknown as McpServer;

let html = "";

beforeAll(async () => {
  registerAppResources(stubServer);
  const res = await captured[0].cb(new URL(OPS_CONSOLE_URI));
  html = res.contents[0].text ?? "";
});

describe("ops-console ui:// resource", () => {
  it("registers at the URI the tool _meta points to, with the MCP Apps mimeType", () => {
    expect(captured).toHaveLength(1);
    expect(captured[0].uri).toBe(OPS_CONSOLE_URI);
    expect(captured[0].meta.mimeType).toBe(APP_HTML_MIME);
    expect(OPS_CONSOLE_TOOL_META.ui.resourceUri).toBe(OPS_CONSOLE_URI);
    expect(captured[0].cb).toBeInstanceOf(Function);
  });

  it("serves the read back with matching uri and mimeType", async () => {
    const res = await captured[0].cb(new URL(OPS_CONSOLE_URI));
    expect(res.contents[0].uri).toBe(OPS_CONSOLE_URI);
    expect(res.contents[0].mimeType).toBe(APP_HTML_MIME);
  });

  it("is a non-trivial HTML document with a mount point", () => {
    expect(html.length).toBeGreaterThan(10_000);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('id="root"');
  });

  it("is fully self-contained (no external scripts, styles, or fetch origins)", () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    // No external URL may appear inside a tag attribute (inline JS strings are
    // fine; markup must not reference the network).
    expect(html).not.toMatch(/<[a-z][^>]*\s(?:src|href)=["']https?:\/\//i);
  });

  it("has no premature </script> inside the inlined bundle", () => {
    // Everything after the inline bundle's opening <script> up to the final
    // closing tag must not terminate the script element early.
    const openIdx = html.lastIndexOf("<script>");
    const closeIdx = html.indexOf("</script>", openIdx);
    const afterClose = html.slice(closeIdx + "</script>".length);
    expect(openIdx).toBeGreaterThan(-1);
    // Only whitespace and the closing body/html tags may follow the bundle.
    expect(afterClose.replace(/\s/g, "")).toBe("</body></html>");
  });
});
