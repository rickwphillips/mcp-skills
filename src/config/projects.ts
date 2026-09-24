import { join } from "node:path";

// Single source of truth for the fleet the ops_console tool reports on.
// Values mirror src/tools/deploy.ts (REPO_ROOT / SCRIPTS / git cwd mapping),
// which is intentionally NOT refactored to consume this table yet — deploy is
// a confirmed-dangerous tool and stays untouched in this change.
export const REPO_ROOT = "/Users/rickphillips/FreddyRhetorickContexts";

export interface ProjectDef {
  name: "commander" | "portfolio" | "grandkid";
  /** Absolute path to the project's git working directory. */
  repoDir: string;
  /** Absolute path to the deploy script (informational for the fleet view). */
  deployScript: string;
  /** Absolute path to the package.json that holds the project version. */
  packageJsonPath: string;
  /** DB connection names holding changelog_releases (commander only). */
  changelogConnections?: { dev: string; prod: string };
  /** playwrightTargets config keys resolving to dev/prod base URLs. */
  playwrightTargets?: { dev?: string; prod?: string };
}

export const PROJECTS: readonly ProjectDef[] = [
  {
    name: "commander",
    repoDir: join(REPO_ROOT, "commander-collector"),
    deployScript: join(REPO_ROOT, "commander-collector/deploy.sh"),
    packageJsonPath: join(REPO_ROOT, "commander-collector/apps/core/package.json"),
    changelogConnections: { dev: "commander_dev", prod: "commander_prod" },
    playwrightTargets: { dev: "commander-dev", prod: "commander-prod" },
  },
  {
    name: "portfolio",
    repoDir: join(REPO_ROOT, "website/rickwphillips.com"),
    deployScript: join(REPO_ROOT, "website/rickwphillips.com/deploy-portfolio.sh"),
    packageJsonPath: join(REPO_ROOT, "website/rickwphillips.com/package.json"),
    playwrightTargets: { dev: "portfolio-dev", prod: "portfolio-prod" },
  },
  {
    name: "grandkid",
    repoDir: join(REPO_ROOT, "grandkid-arcade"),
    deployScript: join(REPO_ROOT, "grandkid-arcade/deploy-grandkid-arcade.sh"),
    packageJsonPath: join(REPO_ROOT, "grandkid-arcade/package.json"),
    playwrightTargets: { dev: "grandkid-dev", prod: "grandkid-prod" },
  },
];
