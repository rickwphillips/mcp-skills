import { describe, it, expect } from "vitest";
import {
  classifyDeployRun,
  isE2eOnlyFailure,
  summarizeDeployRuns,
  type DeployRun,
} from "../src/lib/deploy-run.js";

const baseRun = (overrides: Partial<DeployRun> = {}): DeployRun => ({
  project: "commander",
  exit_code: 0,
  signal: null,
  stdout: "",
  stderr: "",
  ...overrides,
});

describe("deploy-run classification", () => {
  it("classifies a successful run as ok", () => {
    expect(classifyDeployRun(baseRun())).toBe("ok");
  });

  it("classifies commander e2e-only failure when deploy is live", () => {
    const run = baseRun({
      exit_code: 1,
      stdout:
        "⚠️  Playwright tests failed — deploy is live but regressions detected.\n" +
        "   Run: cd apps/core && npx playwright test --reporter=html\n",
    });
    expect(isE2eOnlyFailure(run)).toBe(true);
    expect(classifyDeployRun(run)).toBe("e2e_failed");
  });

  it("classifies exit 20 as e2e-only regardless of stdout wording", () => {
    // The current deploy-commander.sh says "the Playwright suite" and "the
    // build is live in production", matching neither legacy marker. The exit
    // code is what makes this robust to wording changes.
    const run = baseRun({
      exit_code: 20,
      stdout:
        "  DEPLOY SUCCEEDED — POST-DEPLOY TESTS FAILED\n" +
        "  The build is live in production. The failure below\n" +
        "  is the Playwright suite (exit 1), not the deploy.\n",
    });
    expect(isE2eOnlyFailure(run)).toBe(true);
    expect(classifyDeployRun(run)).toBe("e2e_failed");
  });

  it("classifies exit 20 as e2e-only even with empty stdout", () => {
    // Guards the original bug: set -e aborted before any marker was printed.
    const run = baseRun({ exit_code: 20, stdout: "" });
    expect(classifyDeployRun(run)).toBe("e2e_failed");
  });

  it("reports exit 20 as DEPLOY_OK_E2E_FAILED without isError", () => {
    const run = baseRun({ exit_code: 20, stdout: "" });
    expect(summarizeDeployRuns([run])).toEqual({
      status: "DEPLOY_OK_E2E_FAILED",
      outcomes: ["e2e_failed"],
      isError: false,
    });
  });

  it("still treats a bare exit 1 with no markers as a real failure", () => {
    // Regression guard: exit 20 must not widen into "any non-zero is fine".
    expect(classifyDeployRun(baseRun({ exit_code: 1, stdout: "" }))).toBe("failed");
  });

  it("classifies a non-zero exit without e2e markers as failed", () => {
    const run = baseRun({ exit_code: 1, stdout: "npm run build failed" });
    expect(classifyDeployRun(run)).toBe("failed");
  });

  it("classifies spawn failures as failed", () => {
    expect(classifyDeployRun(baseRun({ exit_code: null }))).toBe("failed");
  });

  it("summarizes all-ok runs", () => {
    expect(summarizeDeployRuns([baseRun(), baseRun({ project: "portfolio" })])).toEqual({
      status: "OK",
      outcomes: ["ok", "ok"],
      isError: false,
    });
  });

  it("summarizes e2e-only failures without isError", () => {
    const e2eRun = baseRun({
      exit_code: 1,
      stdout: "Playwright tests failed — deploy is live but regressions detected.",
    });
    expect(summarizeDeployRuns([e2eRun])).toEqual({
      status: "DEPLOY_OK_E2E_FAILED",
      outcomes: ["e2e_failed"],
      isError: false,
    });
  });

  it("treats mixed e2e and real failures as PARTIAL_FAILURE with isError", () => {
    const e2eRun = baseRun({
      exit_code: 1,
      stdout: "Playwright tests failed — deploy is live but regressions detected.",
    });
    const failedRun = baseRun({ project: "portfolio", exit_code: 1, stdout: "rsync failed" });
    expect(summarizeDeployRuns([e2eRun, failedRun])).toEqual({
      status: "PARTIAL_FAILURE",
      outcomes: ["e2e_failed", "failed"],
      isError: true,
    });
  });
});
