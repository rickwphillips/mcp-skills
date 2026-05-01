import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const URI = "skills://project/commander-collector";

const BODY = `# Commander Collector — Project Skill

## Project Location
Repo path (relative): \`commander-collector/\`

## Stack & Dev
- **Next.js** (App Router, \`'use client'\` pages) · **TypeScript** strict · **MUI 7** + Emotion · **SCSS modules**
- Dev port: **3001** → \`npm run dev\` (starts on 3001)
- PHP API port: **8081**
- DB: \`rickwphi_app_commander\` (prod), \`commander_collector\` (local)

## Path Alias
\`@/*\` → \`./app/*\` — always use \`@/\` for imports (e.g. \`@/lib/utils\`, \`@/components/ManaSymbol\`)
- Exception: \`app/lib/version.ts\` uses \`../../package.json\` (outside \`app/\`)

## Key Architecture

### PHP API Pattern
\`\`\`php
require_once 'config.php';
// switch on $_SERVER['REQUEST_METHOD']
// Helpers: getDB(), getJSONInput(), sendJSON(), sendError()
\`\`\`

### Mounted State Pattern
- **Detail pages** (games/detail, decks/detail, players/detail): \`useState(!!id)\` for loading init
- **List/other pages**: \`in\` prop on \`Grow\` is always \`true\` (behind loading spinner)
- **PageContainer**: intentional \`mounted\` Fade animation — do not remove

### Shared Utilities (\`app/lib/utils.ts\`)
- \`MTG_COLORS\`, \`MTG_COLORS_WITH_C\`, \`getOrdinalSuffix(n)\`, \`sortColors(colors)\`
- \`GUILD_NAMES\`, \`SHARD_NAMES\`, \`WEDGE_NAMES\` — 2/3-color combination name maps
- \`getColorNickname(colors)\` — returns guild/shard/wedge name or undefined

### Type System (\`app/lib/types.ts\`)
- \`MtgColorOrColorless = MtgColor | 'C'\`
- \`ComparisonConditions\` includes \`my_games_only\`, \`my_decks_only\`
- \`ComparisonEntityResult\` includes \`commander?: string | null\`

### Color / ManaSymbol Component (\`app/components/ManaSymbol.tsx\`)
- All color pickers use \`ManaSymbol\` pips (new deck form, edit dialog, filter, ConditionColorPicker)
- \`ConditionColorPicker\` normalizes via \`sortColors()\` before storing
- Exclusive colorless toggle: C clears WUBRG, WUBRG clears C
- Shows guild/shard/wedge nickname when mode is AND and colors match
- \`ColorSymbols\` Box uses \`width: arr.width\` — prevents \`overflow:hidden\` clipping
- Single-pip: \`left: size * 0.6\`, \`width: size * 2.1\`
- Deck card layout: text \`flex:1, maxWidth:'calc(100% - 80px)', pr:1\`; symbol \`flexShrink:0, ml:-30\`

### Stats System
- Section registry: \`app/lib/statsSections.ts\` — 11 section IDs
- \`useHiddenStats\` hook — localStorage persistence
- Custom panels: \`stat_panels\` table, PHP CRUD at \`stat-panels.php\`
- Panel sharing via \`share_code\`, URL param \`?panel=<code>\`
- Panel builder at \`/stats/customize/\` with @dnd-kit drag-and-drop

### Comparison Builder (\`app/stats/customize/ComparisonBuilder.tsx\`)
- Section A conditions order: Game Type → Pod Size → Game Length → Count As Win → My games/decks only → Deck must include colors
- Color filtering is Section A only (removed from Section C)

### Comparison Panel (\`app/stats/ComparisonPanel.tsx\`)
- Show/hide checkboxes: Colors, Player, Commander (all default on)
- Horizontal layout ≤8 entities; vertical >8 — both respect toggle flags
- Deck group-by returns \`commander\` field from PHP

### QuerySentence (\`app/stats/customize/QuerySentence.tsx\`)
- Natural-language description of current query (sticky)
- Guild/shard/wedge names applied in AND mode only (suppressed in OR mode)
- \`my_games_only\` + \`game_type\` merged: "in my Commander games" / "in my 2HG games"
- \`my_decks_only\`: changes prefix to "my" → "Show me my Grixis decks"

### Search
- Games page: filter by player name, deck name, or commander
- Players page: filter by name
- Decks page: filter by deck name, commander, player, color, sort

## Deploy
\`\`\`bash
deploy-commander     # local ~/.zshrc alias
\`\`\`
- Shares PHP API path with portfolio: \`rsync php-api/ rickwphillips:~/public_html/app/php-api/\`
- basePath: \`/app/projects/commander\` (prod), \`''\` (dev)
- \`API_BASE\` must include basePath — browser fetch does NOT auto-prepend Next.js basePath

## Pre-existing Lint Warning
\`set-state-in-effect\` in ThemeProvider.tsx — **not ours**, do not fix

## Cross-DB Note
Author/user lookups use \`getAuthDB()\` — no cross-DB JOINs possible
`;

export const registerCommanderCollectorResource = (server: McpServer) => {
  server.registerResource(
    "commander-collector",
    URI,
    {
      title: "Commander Collector — Project Context",
      description:
        "Project context for the Commander Collector MTG game tracking app: stack, architecture, deploy, conventions.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: BODY }],
    }),
  );
};
