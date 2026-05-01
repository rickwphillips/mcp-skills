import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const URI = "skills://reference/canvas-design";

const BODY = `# Canvas Design

Design original visual work. Never copy or mimic identifiable artists' styles to avoid copyright issues — synthesize from principles.

## Core principles

**Hierarchy.** One focal point. One. Everything else supports or contrasts. If two elements compete, you've lost.

**Negative space is design.** Empty space is not absence — it's structure. Reserve at least 30% breathing room around the focal point.

**Type is image.** Letterforms have weight, color, rhythm. Treat typography as a visual element first, a reading channel second.

**Color carries meaning before content.** Pick palette before composition. 2-3 colors plus neutrals beats a rainbow. Use the 60-30-10 distribution (dominant / secondary / accent).

**Grid before freehand.** Establish a grid (rule of thirds at minimum). Break it on purpose, never accidentally.

**Contrast is the engine.** Light/dark, big/small, sharp/soft, busy/empty. Every effective design has at least one strong contrast axis.

## Decision sequence

1. **Purpose** — What does the viewer need to feel/understand in 2 seconds?
2. **Format** — Aspect ratio and intended viewing distance dictate everything downstream.
3. **Palette** — Pick before sketching. 2-3 hues + neutrals.
4. **Composition** — Grid, focal point, supporting elements, negative space.
5. **Typography** — Display face for the focal text, neutral face for body.
6. **Pass 1**: rough composition, no detail.
7. **Pass 2**: refine focal element, lock hierarchy.
8. **Pass 3**: detail and polish — but stop before over-rendering.

## Anti-patterns

- **Centering everything.** Centered design is rarely the strongest layout — only when symmetry IS the message.
- **Too many fonts.** Two faces max for most work.
- **Drop shadows everywhere.** A shadow should solve a real layering problem, not be ambient noise.
- **Filling all space.** White space is not wasted space.
- **Style mimicry.** Don't generate "in the style of <artist>." Synthesize from principles, not copying.
- **Pixel-pushing too early.** Lock composition first; polish last.

## When the user gives no constraints

Default to: 16:9, dark background, single focal element, off-center per rule-of-thirds, 2 colors + 1 accent + neutrals, sans-serif display + lighter sans body, generous negative space.
`;

export const registerCanvasDesignResource = (server: McpServer) => {
  server.registerResource(
    "canvas-design",
    URI,
    {
      title: "Canvas Design — Principles",
      description:
        "Design philosophy for original visual work: hierarchy, negative space, typography, color, contrast, anti-patterns.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: BODY }],
    }),
  );
};
