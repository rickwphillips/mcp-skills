import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { summarizeDeployRuns } from "../lib/deploy-run.js";

const inputSchema = {
  target: z
    .enum(["commander", "portfolio", "grandkid", "all", "c", "p", "g", "a"])
    .describe("Project to deploy. Aliases: c=commander, p=portfolio, g=grandkid, a=all."),
  flags: z
    .string()
    .optional()
    .describe(
      "Flags passed to the deploy script. " +
        "--static-only|-s skips PHP/migrations. --php-only|-p PHP only. " +
        "--decks-only|-d commander decks only. --guru-only|-r commander rules-guru only.",
    ),
  skip_preflight: z
    .boolean()
    .optional()
    .describe("Skip git-clean and commander-migration preflight checks. Default false."),
};

const REPO_ROOT = "/Users/rickphillips/FreddyRhetorickContexts";
const SCRIPTS = {
  commander: join(REPO_ROOT, "commander-collector/deploy.sh"),
  portfolio: join(REPO_ROOT, "website/rickwphillips.com/deploy-portfolio.sh"),
  grandkid: join(REPO_ROOT, "grandkid-arcade/deploy-grandkid-arcade.sh"),
} as const;

type Project = "commander" | "portfolio" | "grandkid";

const expandTarget = (t: string): Project[] => {
  const map: Record<string, Project[]> = {
    c: ["commander"],
    commander: ["commander"],
    p: ["portfolio"],
    portfolio: ["portfolio"],
    g: ["grandkid"],
    grandkid: ["grandkid"],
    a: ["portfolio", "grandkid", "commander"],
    all: ["portfolio", "grandkid", "commander"],
  };
  return map[t] ?? [];
};

const isStaticOnly = (flags?: string): boolean => {
  if (!flags) return false;
  return /(?:^|\s)(--static-only|-s)(?:\s|$)/.test(flags);
};

const checkGitCleanAsync = async (cwd: string): Promise<{ clean: boolean; output: string }> => {
  return new Promise((resolve) => {
    const child = spawn("git", ["status", "--porcelain"], { cwd });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", (err) =>
      resolve({ clean: false, output: `Failed to run git in ${cwd}: ${err.message}` }),
    );
    child.on("close", () => resolve({ clean: out.trim().length === 0, output: out.trim() }));
  });
};

const checkCommanderMigration = (): { ok: boolean; message: string; version?: string } => {
  const pkgPath = join(REPO_ROOT, "commander-collector/apps/core/package.json");
  if (!existsSync(pkgPath)) {
    return { ok: false, message: `Cannot read ${pkgPath}` };
  }
  let version: string;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    version = pkg.version;
    if (!version) return { ok: false, message: "package.json has no version field" };
  } catch (err) {
    return { ok: false, message: `Failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}` };
  }

  const rootMigration = join(REPO_ROOT, `commander-collector/migrations/v${version}.sql`);
  const wrongDirMigration = join(REPO_ROOT, `commander-collector/apps/core/migrations/v${version}.sql`);

  if (existsSync(rootMigration)) {
    return { ok: true, message: `Migration v${version}.sql found at repo root.`, version };
  }
  if (existsSync(wrongDirMigration)) {
    return {
      ok: false,
      version,
      message:
        `Migration v${version}.sql is in apps/core/migrations/ — WRONG LOCATION. ` +
        `Move it to commander-collector/migrations/ at repo root before deploying. ` +
        `Deploy script reads root only; wrong location = silently skipped.`,
    };
  }
  return {
    ok: false,
    version,
    message:
      `No migration file found for v${version}. Either create commander-collector/migrations/v${version}.sql, ` +
      `or pass skip_preflight: true if this version has no DB changes.`,
  };
};

const runScript = async (
  project: Project,
  flags?: string,
): Promise<{ project: Project; exit_code: number | null; signal: string | null; stdout: string; stderr: string }> => {
  const scriptPath = SCRIPTS[project];
  const args = flags ? flags.split(/\s+/).filter(Boolean) : [];
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      resolve({ project, exit_code: null, signal: null, stdout, stderr: `${stderr}Failed to spawn ${scriptPath}: ${err.message}` });
    });
    child.on("close", (code, signal) => {
      resolve({ project, exit_code: code, signal, stdout, stderr });
    });
  });
};

export const registerDeployTool = (server: McpServer) => {
  server.registerTool(
    "deploy",
    {
      title: "Deploy",
      description:
        "Deploy one or all FreddyRhetorick projects (commander, portfolio, grandkid) to production. " +
        "Runs the project's deploy.sh; preflight-checks git tree clean and commander migration file location " +
        "unless skip_preflight or --static-only. " +
        "**Before calling: surface the target and flags to the user and ask for confirmation. Never auto-fire a deploy.**",
      inputSchema,
    },
    async ({ target, flags, skip_preflight }) => {
      const projects = expandTarget(target);
      if (projects.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "ERROR", message: `Unknown target: ${target}` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const skipStatic = isStaticOnly(flags);
      const preflightSkipped = skip_preflight === true || skipStatic;

      const preflight: Record<string, unknown> = {};
      if (!preflightSkipped) {
        const gitChecks: Record<string, { clean: boolean; output: string }> = {};
        for (const p of projects) {
          const cwd =
            p === "commander"
              ? join(REPO_ROOT, "commander-collector")
              : p === "portfolio"
                ? join(REPO_ROOT, "website/rickwphillips.com")
                : join(REPO_ROOT, "grandkid-arcade");
          gitChecks[p] = await checkGitCleanAsync(cwd);
        }
        preflight.git = gitChecks;

        if (projects.includes("commander")) {
          preflight.migration = checkCommanderMigration();
        }

        const dirty = Object.entries(gitChecks).filter(([, v]) => !v.clean);
        const migrationFailed =
          projects.includes("commander") && (preflight.migration as { ok: boolean }).ok === false;

        if (dirty.length > 0 || migrationFailed) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "PREFLIGHT_FAILED",
                    preflight,
                    message:
                      "Preflight failed. Either clean the git tree / fix the migration file, or pass skip_preflight: true.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      } else {
        preflight.skipped = true;
      }

      const runs =
        target === "all" || target === "a"
          ? await Promise.all(projects.map((p) => runScript(p, flags)))
          : [await runScript(projects[0], flags)];

      const { status, outcomes, isError } = summarizeDeployRuns(runs);
      const runsWithOutcomes = runs.map((run, index) => ({
        ...run,
        outcome: outcomes[index],
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status,
                target,
                projects,
                flags: flags ?? null,
                preflight,
                runs: runsWithOutcomes,
                message:
                  status === "DEPLOY_OK_E2E_FAILED"
                    ? "Deploy completed and is live; post-deploy Playwright smoke tests reported failures. Verify prod manually or re-run e2e after cache warmup."
                    : undefined,
              },
              null,
              2,
            ),
          },
        ],
        isError,
      };
    },
  );
};
