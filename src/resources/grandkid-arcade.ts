import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const URI = "skills://project/grandkid-arcade";

const BODY = `# Grandkid Arcade — Project Skill

## Project Location
Repo path (relative): \`grandkid-arcade/\`

## Stack & Dev
- **Next.js 16** (App Router, \`'use client'\` pages, static export for prod) · **TypeScript** strict · **MUI 7** + Emotion · **SCSS modules**
- Dev port: **3002** → \`npm run dev\`
- PHP API port: **8082**
- DB: \`rickwphi_app_grandkid\` (dev: \`grandkid_arcade\`)
- Auth DB: \`rickwphi_auth\` (shared, accessed via \`getAuthDB()\`)
- Test suite: **Vitest** → \`npm run test:run\`

## Path Alias
\`@/*\` → project root — use \`@/app/...\` for app imports

## URLs
- **Production:** \`https://rickwphillips.com/app/projects/grandkid-games/\`
- **Dev:** \`http://localhost:3002\`
- **API (prod):** \`https://rickwphillips.com/grandkid-api/\`
- **API (dev):** Proxied via Next.js rewrites to \`localhost:8082\`

## Game Registry (\`app/lib/gameRegistry.ts\`)
9 games total — each gets a route at \`app/games/<slug>/page.tsx\`:

| Slug | Title | Category | Age |
|------|-------|----------|-----|
| \`color-match\` | Picture Matcher | puzzle | 3–18 |
| \`slide-puzzle\` | Slide Puzzle | puzzle | 5–18 |
| \`connect-4\` | Connect 4 | puzzle | 4–18 |
| \`hangman\` | Hangman | educational | 5–18 |
| \`word-search\` | Word Search | educational | 5–18 |
| \`jigsaw-puzzle\` | Jigsaw Puzzle | puzzle | 3–18 |
| \`math-flash-cards\` | Math Flash Cards | educational | 4–18 |
| \`simon-says\` | Simon Says | action | 3–18 |
| \`whack-a-mole\` | Whack-a-Mole | action | 3–18 |

## Database Schema

### \`grandkids\`
\`id\` (INT PK) · \`name\` (VARCHAR 100) · \`age\` (TINYINT) · \`interests\` (JSON) · \`avatar_color\` (VARCHAR 20, default \`#D2691E\`) · \`created_at\`

### \`game_plays\`
\`id\` · \`grandkid_id\` (FK) · \`game_slug\` · \`score\` · \`completed\` (TINYINT) · \`played_at\`
Indexes: \`(grandkid_id, game_slug)\`, \`(played_at)\`

### \`favorites\`
\`id\` · \`grandkid_id\` (FK) · \`game_slug\` · \`created_at\`
Unique: \`(grandkid_id, game_slug)\`

### \`love_messages\`
\`id\` · \`message\` (VARCHAR 255, supports \`{name}\` placeholder) · \`grandkid_name\` (VARCHAR 100, nullable — null = universal) · \`created_at\`
Seeded with 23 universal + 5 Mason-exclusive + 5 Ella-Grace-exclusive messages

### \`hangman_words\`
\`id\` · \`word\` · \`hint\` (optional) · \`difficulty\` (ENUM: easy/medium/hard) · \`created_at\`
Seeded with family names, dog names (Copper, Penny, Lulu, Luna, Stella)

### \`word_search_themes\`
\`id\` · \`title\` · \`difficulty\` · \`emoji\` · \`description\` · \`created_at\`

### \`word_search_words\`
\`id\` · \`theme_id\` (FK → \`word_search_themes\`) · \`word\` · \`created_at\`

## API Endpoints

\`API_BASE\`: \`/php-api/\` (dev) or \`/grandkid-api/\` (prod)
All endpoints require \`Authorization: Bearer <jwt>\` header.

### Grandkids
- \`GET /grandkids\` — list all
- \`GET /grandkids?id={id}\` — get single
- \`POST /grandkids\` — create
- \`PUT /grandkids?id={id}\` — update
- \`DELETE /grandkids?id={id}\` — delete

### Scores
- \`GET /scores\` — list all
- \`GET /scores?grandkid_id={id}&game_slug={slug}\` — filtered
- \`POST /scores\` — submit score

### Favorites
- \`GET /favorites?grandkid_id={id}\` — get favorites
- \`POST /favorites\` — toggle favorite (returns \`{ favorited: bool }\`)

### Puzzle Images
- \`GET /puzzle-images\` — list (no image_data)
- \`GET /puzzle-images?id={id}\` — single with image_data (base64)
- \`POST /puzzle-images\` — create
- \`DELETE /puzzle-images?id={id}\` — delete

### Love Messages
- \`GET /love-messages\` — all universal messages
- \`GET /love-messages?name={name}\` — universal + name-specific

### Hangman Words
- \`GET /hangman-words?difficulty={diff}&random=1\` — random word
- \`GET /hangman-words\` — list all
- \`POST /hangman-words\` — create
- \`DELETE /hangman-words?id={id}\` — delete

### Word Search
- \`GET /word-search-themes\` — list themes
- \`GET /word-search-themes?id={id}\` — single theme with words
- \`POST /word-search-themes\` — create theme
- \`DELETE /word-search-themes?id={id}\` — delete theme (cascades words)
- \`POST /word-search-themes?id={id}&words=1\` — add word to theme
- \`DELETE /word-search-themes?word_id={id}\` — delete word

## PHP API Pattern
\`\`\`php
require_once 'config.php';
// switch on $_SERVER['REQUEST_METHOD']
// Helpers: getDB(), getJSONInput(), sendJSON(), sendError()
// Auth: require_once 'auth/middleware.php'; $user = requireAuth();
\`\`\`
PHP files live at \`app/php-api/\`. Remote deploy path: \`~/public_html/grandkid-api/\`

## Core Hooks & Auth

### \`useGrandkid()\` (\`app/lib/useGrandkid.ts\`)
- State: \`grandkids[]\`, \`selectedId\`, \`selected\`, \`loading\`, \`error\`
- Methods: \`selectGrandkid(id)\`, \`refresh()\`
- Persists selection to localStorage (\`selectedGrandkidId\`)

### \`useSettings()\` (\`app/lib/useSettings.ts\`)
- \`loveMessages\` (default: true) — controls FloatingLoveMessages
- \`floatingIcons\` (default: true)
- Both persisted to localStorage
- Settings UI lives on admin page, NOT home page

### \`AuthGuard\` (\`app/components/AuthGuard.tsx\`)
- Checks JWT from localStorage or URL param \`?token=\`
- Validates token expiry via JWT payload
- Extracts user: \`id\`, \`username\`, \`display_name\`, \`role\` (admin/user)
- Redirects to login (\`/app/login/\`) if invalid

### \`AdminGuard\` (\`app/components/AdminGuard.tsx\`)
- Requires \`role === 'admin'\` in JWT — wraps admin pages

## Components

| Component | Purpose |
|-----------|---------|
| \`AuthGuard\` | JWT validation wrapper for entire app |
| \`ThemeProvider\` | MUI autumn theme + dark mode |
| \`PageContainer\` | Layout with Fade animation |
| \`DarkModeToggle\` | Fixed top-right toggle |
| \`GameCard\` | Game card with emoji, title, description, age range |
| \`WinBadge\` | Win/lose celebration overlay (shared by ALL games) |
| \`FloatingLoveMessages\` | Random love messages floating on screen |
| \`LoadingSpinner\` | Centered circular progress |
| \`AdminGuard\` | Admin role check wrapper |
| \`MuteToggle\` | Sound toggle (persisted) |

## Game-Specific Details

### WinBadge (\`app/components/WinBadge.tsx\`)
- \`position: absolute; inset: 0\` — parent must be \`position: relative\` sized to game board
- \`border-radius: 8px\` (matches all game boards)
- Close button positioned via \`sx\` prop (not SCSS) to avoid MUI specificity issues
- Each game constrains relative wrapper \`maxWidth\` to match board/grid width

### Connect 4
- Win overlay + action buttons + turn indicator: all delayed **1200ms** on game end (\`showWinBadge\` + \`showWinActions\`)
- Turn indicator changes to "[Color] Wins!" on game end (not hidden)
- Moves count = red's turns only (every other drop); AI drop does NOT increment
- Board: no outer shadow; cells use \`::after\` inset shadow (z-index 15, pieces 10, boardFace 20)

### Jigsaw Puzzle
- Uses \`headbreaker\` library (Konva canvas-based, true jigsaw shapes)
- \`lineSoftness: 0.18\` for curved edges; \`fixed: true\` + \`preventOffstageDrag: true\` prevent board pan
- Pre-scales image with offscreen canvas (cover-crop: largest centered portion, correct aspect ratio)
- \`Manufacturer.withHeadAt(anchor(pieceRadius, pieceRadius))\` aligns grid to canvas top-left
- On win: canvas replaced with full image reveal
- Puzzle images fetched from DB (base64), selected in admin

### Hangman
- Words sourced from \`hangman_words\` DB table (random by difficulty)
- Falls back to hardcoded word list if API unavailable

### Word Search
- Themes sourced from \`word_search_themes\` + \`word_search_words\` tables
- Admin manages themes and word lists

### Math Flash Cards
- Operations: addition, subtraction, multiplication, division
- Timer-based scoring

### Simon Says
- Color pattern display + repeat mechanic

### Whack-a-Mole
- 30-second timed game, tap moles before they hide

## Admin Pages
- \`/admin/puzzle-images/\` — image upload (max 5MB, stored as base64), preview, delete; also has settings toggles
- \`/admin/hangman-words/\` — add (word, hint, difficulty), list, delete
- \`/admin/word-search/\` — create themes, add/delete words per theme, delete themes

## Deploy
\`\`\`bash
deploy-grandkid     # local ~/.zshrc alias
\`\`\`
- PHP API path is **separate** from portfolio/commander: \`rsync php-api/ rickwphillips:~/public_html/grandkid-api/\`
- basePath: \`/app/projects/grandkid-games\` (prod), \`''\` (dev)
- \`API_BASE\` is environment-aware: dev \`/php-api/\` (proxied), prod \`/grandkid-api/\`
- \`ASSET_BASE\`: \`''\` (dev) or \`/app/projects/grandkid-games\` (prod) — used for public assets
- \`API_BASE\` must include basePath — browser fetch does NOT auto-prepend Next.js basePath

## Changelog & Version
- Changelog: \`app/changelog/page.tsx\` (TSX array)
- Version sourced from \`app/lib/version.ts\` → \`package.json\`

## Pre-existing Lint Warning
\`set-state-in-effect\` in ThemeProvider.tsx — **not ours**, do not fix

## Cross-DB Note
Author/user lookups use \`getAuthDB()\` — no cross-DB JOINs possible
`;

export const registerGrandkidArcadeResource = (server: McpServer) => {
  server.registerResource(
    "grandkid-arcade",
    URI,
    {
      title: "Grandkid Arcade — Project Context",
      description:
        "Project context for the Grandkid Arcade kids' games app: 9 games, schema, API, components, deploy.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: BODY }],
    }),
  );
};
