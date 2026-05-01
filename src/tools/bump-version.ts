import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";

const inputSchema = {
  project_path: z.string().describe("Filesystem path to the project root."),
  level: z.enum(["patch", "minor", "major"]).describe("Semver bump level."),
  summary: z
    .string()
    .min(1)
    .describe("One-line description of what changed in this version (used as CHANGELOG entry)."),
  commit: z
    .boolean()
    .optional()
    .describe("If true (default), git add + commit the changes. Push is never automatic."),
};

interface ManifestInfo {
  type: "package.json" | "Cargo.toml" | "composer.json" | "VERSION" | "pyproject.toml";
  path: string;
  version: string;
}

const detectManifest = (root: string): ManifestInfo | null => {
  const candidates: { type: ManifestInfo["type"]; rel: string }[] = [
    { type: "package.json", rel: "package.json" },
    { type: "Cargo.toml", rel: "Cargo.toml" },
    { type: "composer.json", rel: "composer.json" },
    { type: "pyproject.toml", rel: "pyproject.toml" },
    { type: "VERSION", rel: "VERSION" },
  ];
  for (const c of candidates) {
    const path = join(root, c.rel);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    const version = readVersion(c.type, raw);
    if (version) return { type: c.type, path, version };
  }
  return null;
};

const readVersion = (type: ManifestInfo["type"], raw: string): string | null => {
  if (type === "package.json" || type === "composer.json") {
    try {
      const obj = JSON.parse(raw);
      return typeof obj.version === "string" ? obj.version : null;
    } catch {
      return null;
    }
  }
  if (type === "Cargo.toml" || type === "pyproject.toml") {
    const m = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  }
  if (type === "VERSION") {
    const v = raw.trim();
    return v || null;
  }
  return null;
};

const writeVersion = (manifest: ManifestInfo, newVersion: string): void => {
  const raw = readFileSync(manifest.path, "utf8");
  let updated: string;
  if (manifest.type === "package.json" || manifest.type === "composer.json") {
    const obj = JSON.parse(raw);
    obj.version = newVersion;
    updated = JSON.stringify(obj, null, 2) + (raw.endsWith("\n") ? "\n" : "");
  } else if (manifest.type === "Cargo.toml" || manifest.type === "pyproject.toml") {
    updated = raw.replace(/^(\s*version\s*=\s*")([^"]+)(")/m, `$1${newVersion}$3`);
  } else {
    updated = newVersion + "\n";
  }
  writeFileSync(manifest.path, updated);
};

const bumpSemver = (version: string, level: "patch" | "minor" | "major"): string => {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) throw new Error(`Cannot parse version: ${version}`);
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  const patch = parseInt(m[3], 10);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const today = (): string => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const updateChangelog = (root: string, newVersion: string, summary: string): string => {
  const path = join(root, "CHANGELOG.md");
  const entry = `## [${newVersion}] - ${today()}\n\n- ${summary}\n\n`;
  if (!existsSync(path)) {
    writeFileSync(path, `# Changelog\n\n${entry}`);
    return path;
  }
  const raw = readFileSync(path, "utf8");
  const headerMatch = raw.match(/^# [^\n]*\n+/);
  if (headerMatch) {
    const idx = headerMatch.index! + headerMatch[0].length;
    writeFileSync(path, raw.slice(0, idx) + entry + raw.slice(idx));
  } else {
    writeFileSync(path, entry + raw);
  }
  return path;
};

export const registerBumpVersionTool = (server: McpServer) => {
  server.registerTool(
    "bump_version",
    {
      title: "Bump Version",
      description:
        "Bump a project's semver version, write a CHANGELOG entry, and commit (no push). " +
        "Detects package.json / Cargo.toml / composer.json / pyproject.toml / VERSION. " +
        "Date format is YYYY-MM-DD with no timestamp.",
      inputSchema,
    },
    async ({ project_path, level, summary, commit }) => {
      const shouldCommit = commit !== false;
      try {
        const manifest = detectManifest(project_path);
        if (!manifest) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "ERROR",
                    message:
                      "No manifest file found. Looked for package.json, Cargo.toml, composer.json, pyproject.toml, VERSION.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        const newVersion = bumpSemver(manifest.version, level);
        writeVersion(manifest, newVersion);
        const changelogPath = updateChangelog(project_path, newVersion, summary);

        let commitSha: string | null = null;
        if (shouldCommit) {
          const opts = { cwd: project_path };
          execSync(`git add ${JSON.stringify(manifest.path)} ${JSON.stringify(changelogPath)}`, opts);
          execSync(`git commit -m ${JSON.stringify(`chore: bump to v${newVersion}`)}`, opts);
          commitSha = execSync(`git rev-parse HEAD`, opts).toString().trim();
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "OK",
                  manifest: manifest.type,
                  manifest_path: manifest.path,
                  changelog_path: changelogPath,
                  old_version: manifest.version,
                  new_version: newVersion,
                  level,
                  summary,
                  committed: shouldCommit,
                  commit_sha: commitSha,
                  pushed: false,
                  next_step: shouldCommit
                    ? "Verify the diff, then run `git push` manually if it looks right."
                    : "Verify the diff, then commit + push manually.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  message: err instanceof Error ? err.message : String(err),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
};
