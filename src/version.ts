import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface VersionInfo {
  name: string;
  version: string;
  changelog_recent: ChangelogEntry[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string;
}

let cached: VersionInfo | null = null;

export function getVersionInfo(): VersionInfo {
  if (cached) return cached;
  const root = findRoot();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const changelog = readChangelog(join(root, "CHANGELOG.md"));
  cached = {
    name: pkg.name,
    version: pkg.version,
    changelog_recent: changelog.slice(0, 5),
  };
  return cached;
}

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
  throw new Error("Could not locate package.json from " + __dirname);
}

function readChangelog(path: string): ChangelogEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const entries: ChangelogEntry[] = [];
  const headerRe = /^##\s+\[?([\d.]+)\]?\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/gm;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^##\s+\[?([\d.]+)\]?\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/);
    if (match) {
      const notesLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^##\s/)) break;
        notesLines.push(lines[j]);
      }
      entries.push({
        version: match[1],
        date: match[2],
        notes: notesLines.join("\n").trim(),
      });
    }
  }
  return entries;
}
