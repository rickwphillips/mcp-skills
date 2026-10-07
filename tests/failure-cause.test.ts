import { describe, it, expect } from "vitest";
import { describeFailureCause } from "../src/lib/failure-cause.js";
import { extractSwallowedError } from "../src/lib/dispatch-wrapper.js";

const envelope = (body: unknown) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify(body) }],
});

const failedRun = (stderr: string, stdout = "") => ({ outcome: "failed", exit_code: 255, stdout, stderr });

describe("describeFailureCause", () => {
  it("names a missing migration at preflight", () => {
    const text = JSON.stringify({
      status: "PREFLIGHT_FAILED",
      preflight: { git: { commander: { clean: true } }, migration: { ok: false, version: "5.23.1" } },
    });
    expect(describeFailureCause(text)).toBe("PREFLIGHT_FAILED: missing migration file");
  });

  it("names a dirty git tree at preflight", () => {
    const text = JSON.stringify({
      status: "PREFLIGHT_FAILED",
      preflight: { git: { portfolio: { clean: false } } },
    });
    expect(describeFailureCause(text)).toBe("PREFLIGHT_FAILED: dirty git tree");
  });

  it("names an ssh reset from a failed run", () => {
    const text = JSON.stringify({
      status: "PARTIAL_FAILURE",
      runs: [failedRun("kex_exchange_identification: read: Connection reset by peer")],
    });
    expect(describeFailureCause(text)).toBe("PARTIAL_FAILURE: ssh connection reset by host");
  });

  it("names a post-deploy e2e failure", () => {
    const text = JSON.stringify({
      status: "PARTIAL_FAILURE",
      runs: [failedRun("", "Running Playwright smoke tests\n 3 failed")],
    });
    expect(describeFailureCause(text)).toBe("PARTIAL_FAILURE: post-deploy e2e failed");
  });

  it("falls back to a generic cause for an unrecognized failed run", () => {
    const text = JSON.stringify({ status: "PARTIAL_FAILURE", runs: [failedRun("boom")] });
    expect(describeFailureCause(text)).toBe("PARTIAL_FAILURE: deploy script exited non-zero");
  });

  it("ignores runs that succeeded", () => {
    const text = JSON.stringify({
      status: "PARTIAL_FAILURE",
      runs: [{ outcome: "ok", exit_code: 0, stdout: "", stderr: "" }, failedRun("Connection closed by host")],
    });
    expect(describeFailureCause(text)).toBe("PARTIAL_FAILURE: ssh connection reset by host");
  });

  it("returns just the status when no cause is recognizable", () => {
    expect(describeFailureCause(JSON.stringify({ status: "ERROR" }))).toBe("ERROR");
  });

  it("returns null for non-JSON or empty envelopes", () => {
    expect(describeFailureCause("plain text")).toBeNull();
    expect(describeFailureCause("{}")).toBeNull();
  });
});

describe("extractSwallowedError on isError results", () => {
  it("gives different causes different signatures", () => {
    const ssh = extractSwallowedError(
      envelope({ status: "PARTIAL_FAILURE", runs: [failedRun("Connection reset by peer")] }),
    );
    const preflight = extractSwallowedError(
      envelope({ status: "PREFLIGHT_FAILED", preflight: { migration: { ok: false } } }),
    );
    expect(ssh).not.toBe(preflight);
    expect(ssh).not.toBe("isError flag set on tool result");
  });

  it("keeps the generic label when nothing is recognizable", () => {
    expect(extractSwallowedError({ isError: true, content: [{ type: "text", text: "whatever" }] })).toBe(
      "isError flag set on tool result",
    );
  });
});
