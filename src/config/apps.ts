// MCP Apps (SEP-1865) wire constants, verified against the installed
// @modelcontextprotocol/ext-apps 1.7.x package. Kept as literals so the server
// runtime never imports ext-apps (it is a devDependency bundled into the app
// HTML only).

export const OPS_CONSOLE_URI = "ui://mcp-skills/ops-console";

// Preferred nested form; the legacy flat "ui/resourceUri" key is deprecated.
export const OPS_CONSOLE_TOOL_META = {
  ui: { resourceUri: OPS_CONSOLE_URI },
} as const;

// ext-apps RESOURCE_MIME_TYPE.
export const APP_HTML_MIME = "text/html;profile=mcp-app";
