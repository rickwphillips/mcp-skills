// Server logo (MCP spec icons, SEP-973). Clients that honor serverInfo.icons
// (MCPJam, Claude Desktop, ...) render this as the server's logo. Inline SVG
// data URI so the stdio server needs no asset files: an autumn-amber rounded
// tile with an "S" spark, echoing the skills/toolbox identity.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#b45309"/>
</linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#g)"/>
<path d="M42 20c-2-3-6-5-10-5-6 0-11 4-11 9 0 5 4 7 10 9 5 1 8 3 8 6 0 4-4 6-8 6-5 0-9-2-11-6"
fill="none" stroke="#fff7ed" stroke-width="5" stroke-linecap="round"/>
<circle cx="47" cy="47" r="4" fill="#fff7ed"/>
</svg>`;

export const SERVER_ICONS = [
  {
    src: `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`,
    mimeType: "image/svg+xml",
    sizes: ["any"],
  },
];
