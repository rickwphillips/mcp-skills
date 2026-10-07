type Run = { outcome?: unknown; exit_code?: unknown; stdout?: unknown; stderr?: unknown };

type Envelope = {
  status?: unknown;
  message?: unknown;
  preflight?: { git?: Record<string, { clean?: unknown }>; migration?: { ok?: unknown } };
  runs?: unknown;
};

/**
 * Ordered most-specific first: the first signature found in a failed run's
 * output names its cause. Wording is fixed (no versions, paths or counts) so
 * the same cause always normalizes to the same audit pattern.
 */
const RUN_CAUSES: ReadonlyArray<readonly [RegExp, string]> = [
  [/kex_exchange_identification|Connection reset by|Connection closed by/i, "ssh connection reset by host"],
  [/Playwright|e2e/i, "post-deploy e2e failed"],
  [/Failed to compile|Type error|Build error|npm ERR/i, "build failed"],
  [/lftp|530 Login|ftp:\/\//i, "ftp upload failed"],
];

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

const preflightCauses = (preflight: Envelope["preflight"]): string[] => {
  if (!preflight) return [];
  const dirty = Object.values(preflight.git ?? {}).some((g) => g.clean === false);
  return [
    ...(dirty ? ["dirty git tree"] : []),
    ...(preflight.migration?.ok === false ? ["missing migration file"] : []),
  ];
};

const runCause = (run: Run): string => {
  const output = `${asText(run.stderr)}\n${asText(run.stdout)}`;
  const hit = RUN_CAUSES.find(([pattern]) => pattern.test(output));
  return hit ? hit[1] : "deploy script exited non-zero";
};

const runCauses = (runs: unknown): string[] =>
  Array.isArray(runs)
    ? (runs as Run[]).filter((r) => r.outcome !== "ok").map(runCause)
    : [];

/**
 * Names the specific cause of an `isError` tool result, e.g.
 * "PREFLIGHT_FAILED: missing migration file". Returns null when the content
 * carries nothing recognizable, so callers can fall back to a generic label.
 */
export const describeFailureCause = (text: string): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const env = parsed as Envelope;
  const status = asText(env.status);
  const causes = [...new Set([...preflightCauses(env.preflight), ...runCauses(env.runs)])].sort();
  if (causes.length === 0) return status || null;
  return status ? `${status}: ${causes.join("; ")}` : causes.join("; ");
};
