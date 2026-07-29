export type DeployRun = {
  project: string;
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

export type DeployRunOutcome = "ok" | "e2e_failed" | "failed";

export type DeploySummary = {
  status: "OK" | "DEPLOY_OK_E2E_FAILED" | "PARTIAL_FAILURE";
  outcomes: DeployRunOutcome[];
  isError: boolean;
};

/**
 * Dedicated exit code meaning "the deploy succeeded and is live, but the
 * post-deploy test suite failed". Emitted by deploy-commander.sh.
 *
 * This exists because sniffing stdout was unreliable. The commander script used
 * to print its "tests failed, deploy is live" warning only if it reached that
 * line, but `set -e` aborted the script on the failing test command itself, so
 * the markers below were never emitted and a healthy deploy was misreported as
 * PARTIAL_FAILURE. An exit code cannot be swallowed that way, and it does not
 * drift when the wording changes (the current script says "the Playwright
 * suite" and "the build is live in production", neither of which matches the
 * legacy markers).
 */
export const DEPLOY_OK_E2E_FAILED_EXIT = 20;

/**
 * Legacy fallback for deploy scripts that have not adopted the exit code yet
 * (portfolio, grandkid). Both markers must be present to avoid false positives.
 */
const E2E_FAILURE_MARKERS = [/Playwright tests failed/i, /deploy is live/i] as const;

export const isE2eOnlyFailure = (run: DeployRun): boolean => {
  if (run.exit_code === DEPLOY_OK_E2E_FAILED_EXIT) return true;
  return (
    run.exit_code !== 0 &&
    run.exit_code !== null &&
    E2E_FAILURE_MARKERS.every((pattern) => pattern.test(run.stdout))
  );
};

export const classifyDeployRun = (run: DeployRun): DeployRunOutcome => {
  if (run.exit_code === 0) return "ok";
  if (isE2eOnlyFailure(run)) return "e2e_failed";
  return "failed";
};

export const summarizeDeployRuns = (runs: DeployRun[]): DeploySummary => {
  const outcomes = runs.map(classifyDeployRun);
  const anyFailed = outcomes.some((o) => o === "failed");
  const anyE2eFailed = outcomes.some((o) => o === "e2e_failed");
  const allOk = outcomes.every((o) => o === "ok");

  const status: DeploySummary["status"] = allOk
    ? "OK"
    : !anyFailed && anyE2eFailed
      ? "DEPLOY_OK_E2E_FAILED"
      : "PARTIAL_FAILURE";

  return { status, outcomes, isError: anyFailed };
};
