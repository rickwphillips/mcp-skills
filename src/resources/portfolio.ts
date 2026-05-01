import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const URI = "skills://project/portfolio";

const BODY = `# Portfolio — Project Skill

## Project Location
Repo path (relative): \`website/rickwphillips.com/\`

## Stack & Dev
- **Next.js 16.0.1** (App Router) · **React 19.2.0** · **TypeScript 5.x** strict · **MUI 7.3.4** + Emotion · **SCSS modules** (Sass 1.93.3)
- Dev port: **3000** → \`npm run dev\`
- PHP API port: **8080**
- DB: \`rickwphi_app_portfolio\`

## Path Alias
\`@/*\` → project root

## Key Architecture

### Theme System
- \`ThemeProvider.tsx\` — Context wrapper, light/dark mode, localStorage persistence, matchMedia, FOUC prevention (returns \`null\` until mounted), wraps MUI ThemeProvider
- \`theme.ts\` — autumn palette (warm browns/oranges/golds), separate light/dark schemes, component overrides (Card, Chip, Button, Link)
- \`DarkModeToggle.tsx\` — fixed-position toggle via \`useThemeMode()\`
- \`layout.tsx\` wraps all children in ThemeProvider

### Pages
- \`page.tsx\` — hero (gradient text) + nav (Resume/Projects/Blog/Contact) + gaming philosophy + chihuahua carousel (auto-rotating) + embedded blog posts; all animations gated on \`mounted\`
- \`resume/page.tsx\` — about + 6 expertise cards + tech (Frontend/Backend/Practices) + achievements + education

### Rendering
All pages \`'use client'\` — theme needs localStorage/matchMedia, heavy MUI + animations, carousel/hover state

### Blog Posts
React components (not MDX) at \`app/blog/posts/[name]/[Name]Post.tsx\`, exported via \`app/blog/posts/index.ts\`, embedded in homepage as full Card components.

**"Create/add/make a post about X"** = write markdown and insert into the **production** portfolio DB — NOT a static React component.
- Script: \`website/rickwphillips.com/scripts/create-post.php\`
- Deploy: \`scp scripts/create-post.php rickwphillips:/tmp/create-post.php && ssh rickwphillips "php /tmp/create-post.php && rm /tmp/create-post.php"\`
- Category options: Engineering, General. Accent = hex chip color.

### Chihuahua Carousel
- Photos in \`public/Photos-1-001/\` — Copper, Penny, Lulu
- Auto-rotating, animations gated on \`mounted\`

## Key Patterns

### Theme-aware styling
\`\`\`tsx
sx={{ background: (theme) => theme.palette.mode === 'dark' ? 'dark-val' : 'light-val' }}
\`\`\`

### Mounted state (FOUC prevention + animations)
\`\`\`tsx
const [mounted, setMounted] = useState(false);
useEffect(() => { const t = setTimeout(() => setMounted(true), 0); return () => clearTimeout(t); }, []);
// <Fade in={mounted} timeout={1000}>
\`\`\`

### Animation stagger
150–200ms multiples for MUI Fade/Grow/Slide

## Deploy
\`\`\`bash
deploy-portfolio     # local ~/.zshrc alias
\`\`\`
- Static export excludes: \`projects/commander\`, \`projects/grandkid-games\`, \`php-api\`
- \`--delete\` flag: \`.htaccess\` must be restored after deploy
- PHP API: \`rsync php-api/ rickwphillips:~/public_html/app/php-api/\`
- basePath: \`/app\` (prod), \`''\` (dev)

## Knowledge Graph
SQLite at \`knowledge-graph.db\`. Rebuild: \`python3 build-knowledge-graph.py\`
\`\`\`bash
./query-graph.sh endpoints
./query-graph.sh search <term>
./query-graph.sh project <name>
\`\`\`

## Resume Data
Lives at \`.claude/resumes/\` (private, not committed). Achievements: 30%+ improvement, $1.2M sales figures.

## Troubleshooting
- FOUC: check ThemeProvider \`mounted\` state + \`null\` return
- Animations: stagger in 150–200ms multiples
- Build fails: \`npm run build\` to surface TS errors
- ESLint: \`eslint.config.mjs\` using Next.js \`defineConfig\`

## Pre-existing Lint Warning
\`set-state-in-effect\` in ThemeProvider.tsx — **not ours**, do not fix
`;

export const registerPortfolioResource = (server: McpServer) => {
  server.registerResource(
    "portfolio",
    URI,
    {
      title: "Portfolio (rickwphillips.com) — Project Context",
      description:
        "Project context for the rickwphillips.com personal portfolio: stack, theme system, blog, deploy, knowledge graph.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: BODY }],
    }),
  );
};
