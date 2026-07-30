// Pure fleet-status shaping for the ops_console tool. No IO in this module —
// gathering (fs, git, DB) lives in src/tools/ops-console.ts; everything here is
// unit-testable and under the src/lib coverage thresholds.

export interface FleetGit {
  branch: string | null;
  dirty: boolean;
  dirtyCount: number;
}

export interface FleetVersionGap {
  localVsDev: string | null;
  localVsProd: string | null;
  devVsProd: string | null;
}

export interface FleetProjectStatus {
  name: string;
  localVersion: string | null;
  git: FleetGit | null;
  changelog?: { dev: string | null; prod: string | null };
  gap?: FleetVersionGap;
  urls?: { dev?: string; prod?: string };
  notes: string[];
}

export interface FleetPayload {
  generatedAt: string;
  serverVersion: string;
  projects: FleetProjectStatus[];
}

/**
 * Parse `git status --porcelain=v1 -b` output. First line is `## <branch>...`
 * (or `## HEAD (no branch)` when detached); every further line is one dirty
 * entry.
 */
export function parseGitStatus(output: string): FleetGit {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  let branch: string | null = null;
  const header = lines[0];
  if (header?.startsWith("## ")) {
    const ref = header.slice(3);
    branch = ref.startsWith("HEAD") ? "(detached)" : ref.split("...")[0];
  }
  const dirtyCount = lines.filter((l) => !l.startsWith("## ")).length;
  return { branch, dirty: dirtyCount > 0, dirtyCount };
}

/**
 * Three-way version comparison (lifted from cc_status). Null members mean
 * "equal or not comparable".
 */
export function computeVersionGap(
  local: string | null,
  dev: string | null,
  prod: string | null,
): FleetVersionGap {
  return {
    localVsDev:
      local && dev && local !== dev
        ? `local (${local}) differs from dev DB (${dev})`
        : null,
    localVsProd:
      local && prod && local !== prod
        ? `local (${local}) differs from prod DB (${prod})`
        : null,
    devVsProd:
      dev && prod && dev !== prod
        ? `dev DB (${dev}) differs from prod DB (${prod})`
        : null,
  };
}

export interface FleetProjectInput {
  name: string;
  localVersion: string | null;
  git: FleetGit | null;
  changelog?: { dev: string | null; prod: string | null };
  urls?: { dev?: string; prod?: string };
  notes: string[];
}

export function buildFleetPayload(
  serverVersion: string,
  generatedAt: string,
  inputs: FleetProjectInput[],
): FleetPayload {
  return {
    generatedAt,
    serverVersion,
    projects: inputs.map((p) => ({
      name: p.name,
      localVersion: p.localVersion,
      git: p.git,
      ...(p.changelog
        ? {
            changelog: p.changelog,
            gap: computeVersionGap(
              p.localVersion,
              p.changelog.dev,
              p.changelog.prod,
            ),
          }
        : {}),
      ...(p.urls && (p.urls.dev || p.urls.prod) ? { urls: p.urls } : {}),
      notes: p.notes,
    })),
  };
}

/**
 * Prose summary for non-App clients. Deliberately NOT JSON: the dispatch
 * wrapper parses JSON-looking text blocks for error keys and may inject
 * _steering into them; plain prose is immune.
 */
export function summarizeFleet(payload: FleetPayload): string {
  const lines = payload.projects.map((p) => {
    const parts: string[] = [];
    parts.push(p.localVersion ? `v${p.localVersion}` : "version unknown");
    if (p.git) {
      parts.push(
        `branch ${p.git.branch ?? "unknown"}, ${
          p.git.dirty ? `dirty (${p.git.dirtyCount} files)` : "clean"
        }`,
      );
    } else {
      parts.push("git state unknown");
    }
    if (p.changelog) {
      parts.push(
        `dev DB ${p.changelog.dev ?? "unknown"}, prod DB ${p.changelog.prod ?? "unknown"}`,
      );
      const gaps = p.gap
        ? [p.gap.localVsDev, p.gap.localVsProd, p.gap.devVsProd].filter(
            (g): g is string => g !== null,
          )
        : [];
      if (gaps.length > 0) parts.push(`GAP: ${gaps.join("; ")}`);
    }
    const notes = p.notes.length > 0 ? ` [notes: ${p.notes.join("; ")}]` : "";
    return `- ${p.name}: ${parts.join(" — ")}${notes}`;
  });
  return [
    `Fleet status (mcp-skills v${payload.serverVersion}, ${payload.generatedAt}):`,
    ...lines,
  ].join("\n");
}
