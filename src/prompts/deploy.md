
# Deploy

Deploy one or all FreddyRhetorick projects to production.

## Inputs

- `target` — `commander` | `portfolio` | `grandkid` | `all` (aliases `c`, `p`, `g`, `a`)
- `flags` — optional, e.g. `--static-only`, `--php-only`, `--decks-only`, `--guru-only`

### Argument Aliases

**Project:**
| Alias | Resolves to |
|-------|-------------|
| `c`   | commander   |
| `p`   | portfolio   |
| `g`   | grandkid    |
| `a`   | grandkid (arcade) |

**Flags:**
| Alias | Resolves to      |
|-------|------------------|
| `-s`  | `--static-only`  |
| `-p`  | `--php-only`     |
| `-d`  | `--decks-only`   |
| `-r`  | `--guru-only`    |

## Steps

1. **Parse `target`** to determine project. Expand aliases first.

2. **If no target**, ask the user which project to deploy. Do not guess.

3. **Pre-deploy checks** (skip if `--static-only`):
   - Confirm working tree is clean (`git status`)
   - **⚠️ Commander migration check (mandatory before every commander deploy):**
     1. Read the version from `commander-collector/apps/core/package.json`
     2. Check for `commander-collector/migrations/v{version}.sql` at repo root
     3. If file is missing at root but exists in `apps/core/migrations/` — **STOP. Wrong location. Move it to repo root before proceeding.**
     4. If file is missing entirely — warn the user: "No migration file found for v{version} at commander-collector/migrations/. Confirm this version has no DB changes before continuing."
     5. Only proceed once the migration file location is confirmed correct or absence is explicitly acknowledged.

4. **Run the deploy** using the appropriate alias (assumes the user's local `~/.zshrc` defines them):
   ```bash
   deploy-commander
   deploy-portfolio
   deploy-grandkid
   deploy-all
   ```
   Pass `flags` through to the alias.

5. **Post-deploy reminders**:
   - **Portfolio**: `--delete` flag removes `.htaccess` — remind user to restore it
   - **Grandkid**: API path is `grandkid-api/` (separate from portfolio/commander)

## Project Targets — DO NOT CROSS-CONTAMINATE

These projects are **strictly separate**. Each has its own deploy script, its own remote directories, its own DB, its own PHP API files. **Never deploy one project's files to another project's path. Never merge them. Never reuse a path across projects.**

| Project     | Local source                    | Deploy script                    | Remote static                                | Remote PHP API                       |
|-------------|---------------------------------|----------------------------------|----------------------------------------------|--------------------------------------|
| **Portfolio** | `website/rickwphillips.com/`  | `deploy-portfolio.sh`            | `~/public_html/app/`                         | `~/public_html/app/php-api/`         |
| **Commander** | `commander-collector/apps/core/` | `commander-collector/deploy.sh` | `~/public_html/app/projects/commander/`      | `~/public_html/php-api/` (canonical) |
| **Grandkid**  | `grandkid-arcade/`            | `deploy-grandkid-arcade.sh`      | `~/public_html/app/projects/grandkid-games/` | `~/public_html/grandkid-api/`        |

| Project   | Dev Port | PHP Port | basePath (prod)                | DB                       | Version source           |
|-----------|----------|----------|--------------------------------|--------------------------|--------------------------|
| Portfolio | 3000     | 8080     | `/app`                         | `rickwphi_app_portfolio` | `package.json`           |
| Commander | 3001     | 8081     | `/app/projects/commander`      | `rickwphi_app_commander` | `apps/core/package.json` |
| Grandkid  | 3002     | 8082     | `/app/projects/grandkid-games` | `rickwphi_app_grandkid`  | `package.json`           |

### ⚠️ Symlink hazard (read before touching either deploy script)

In production, `~/public_html/app/php-api` is a **symlink** pointing to `~/public_html/php-api`:
- Commander writes to `~/public_html/php-api/` directly (canonical)
- Portfolio writes to `~/public_html/app/php-api/` which **resolves to the same directory**
- Both deploys land files at the same on-disk location

This is the user's existing topology — **they have explicitly said NOT to consolidate**. The skill must:
- Use each project's own deploy script (knows the right path for that project)
- Never run rsync directly to either path — always go through the project's deploy script
- Never suggest "fixing" the symlink without an explicit user request to restructure it
- Be aware that any file shared by both projects (e.g. `posts.php`, `config.php`) gets overwritten by whichever deployed last

If you discover files with the same name in both `commander-collector/apps/core/app/php-api/` and `website/rickwphillips.com/php-api/`, **flag it to the user** — do not silently let one stomp the other.

## Notes

- `API_BASE` must include basePath — browser fetch does NOT auto-prepend Next.js basePath
- DB migrations run automatically unless `--static-only` or `--decks-only` passed
- Each project has its own `schema_migrations` table in its own DB — never share migration state across projects
- Remote DB creds read from `~/auth_secrets.php` on server (constants: `DB_USER/PASS/NAME`, `PORTFOLIO_DB_*`, `GRANDKID_DB_*`)
- **Commander is a Turborepo monorepo**: `apps/core` (main app) + `apps/decks` (standalone decks app)
  - Full deploy builds both apps; `--decks-only` builds + deploys only `apps/decks` (fast path)
  - `apps/core/out/` deployed with `--delete` (authoritative); `apps/decks/out/` merged without `--delete`
  - Both apps share the same remote path (`public_html/app/projects/commander/`) and same basePath
  - PHP API is in `apps/core/app/php-api/`; version/migrations read from `apps/core/package.json`
  - **Migration files MUST be in `commander-collector/migrations/` (repo root), NOT `apps/core/migrations/`**
