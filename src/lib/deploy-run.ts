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

const E2E_FAILURE_MARKERS = [/Playwright tests failed/i, /deploy is live/i] as const;

export const isE2eOnlyFailure = (run: DeployRun): boolean =>
  run.exit_code !== 0 &&
  run.exit_code !== null &&
  E2E_FAILURE_MARKERS.every((pattern) => pattern.test(run.stdout));

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
