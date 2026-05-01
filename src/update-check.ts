import { exec } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

export type UpdateStatus = "current" | "behind" | "ahead" | "unknown" | "error";

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string | null;
  update_status: UpdateStatus;
  upgrade_command: string | null;
  source: "gh-release" | "gh-tags" | "git-ls-remote" | "none";
  message: string;
  checked_at: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
let cached: { result: UpdateCheckResult; ts: number } | null = null;

function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    try {
      readFileSync(join(dir, "package.json"), "utf8");
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  return process.cwd();
}

function getCurrentVersion(): string {
  const pkg = JSON.parse(readFileSync(join(findRoot(), "package.json"), "utf8"));
  return pkg.version;
}

function getRepoSlug(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(findRoot(), "package.json"), "utf8"));
    const url: string | undefined = pkg.repository?.url;
    if (!url) return null;
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function tryGhRelease(repo: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `gh release view --repo ${repo} --json tagName -q .tagName`,
      { timeout: 5000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function tryGhTags(repo: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `gh api /repos/${repo}/tags --jq '.[0].name'`,
      { timeout: 5000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function tryGitLsRemote(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `git ls-remote --tags --refs origin 2>/dev/null | awk -F'/' '{print $NF}' | sort -V | tail -1`,
      { cwd: findRoot(), timeout: 5000, shell: "/bin/bash" },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(force = false): Promise<UpdateCheckResult> {
  const now = Date.now();
  if (!force && cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  const current = getCurrentVersion();
  const repo = getRepoSlug();

  if (!repo) {
    const result: UpdateCheckResult = {
      current_version: current,
      latest_version: null,
      update_status: "unknown",
      upgrade_command: null,
      source: "none",
      message: "Repo URL not found in package.json — cannot check for updates.",
      checked_at: new Date().toISOString(),
    };
    cached = { result, ts: now };
    return result;
  }

  let latest: string | null = null;
  let source: UpdateCheckResult["source"] = "none";

  latest = await tryGhRelease(repo);
  if (latest) source = "gh-release";

  if (!latest) {
    latest = await tryGhTags(repo);
    if (latest) source = "gh-tags";
  }

  if (!latest) {
    latest = await tryGitLsRemote();
    if (latest) source = "git-ls-remote";
  }

  if (!latest) {
    const result: UpdateCheckResult = {
      current_version: current,
      latest_version: null,
      update_status: "unknown",
      upgrade_command: null,
      source: "none",
      message:
        "Could not reach GitHub. Ensure `gh auth status` is OK, or that the repo's git remote is reachable.",
      checked_at: new Date().toISOString(),
    };
    cached = { result, ts: now };
    return result;
  }

  const cmp = compareSemver(current, latest);
  let status: UpdateStatus;
  let message: string;
  let upgradeCommand: string | null = null;

  if (cmp === 0) {
    status = "current";
    message = `Up to date (v${current}).`;
  } else if (cmp < 0) {
    status = "behind";
    upgradeCommand = `cd ${findRoot()} && git pull && npm install && npm run build`;
    message =
      `A newer version is available: ${latest} (you have v${current}). ` +
      `Ask the user before updating, then run: ${upgradeCommand}. Restart your MCP client after the build.`;
  } else {
    status = "ahead";
    message = `Local v${current} is ahead of latest tag ${latest}. (Probably an unreleased dev build.)`;
  }

  const result: UpdateCheckResult = {
    current_version: current,
    latest_version: latest,
    update_status: status,
    upgrade_command: upgradeCommand,
    source,
    message,
    checked_at: new Date().toISOString(),
  };
  cached = { result, ts: now };
  return result;
}

export function backgroundBootCheck(): void {
  checkForUpdates(true)
    .then((result) => {
      if (result.update_status === "behind") {
        process.stderr.write(`[mcp-skills] ⚠ ${result.message}\n`);
      } else if (result.update_status === "current") {
        process.stderr.write(`[mcp-skills] ✓ ${result.message}\n`);
      } else if (result.update_status === "ahead") {
        process.stderr.write(`[mcp-skills] ${result.message}\n`);
      }
    })
    .catch(() => {
      // Silent on boot errors; surfaced when get_version is called.
    });
}
