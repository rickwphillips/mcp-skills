import { describe, it, expect } from "vitest";
import {
  parseGitStatus,
  computeVersionGap,
  buildFleetPayload,
  summarizeFleet,
  type FleetProjectInput,
} from "../src/lib/fleet.js";

describe("parseGitStatus", () => {
  it("parses a clean branch", () => {
    expect(parseGitStatus("## main...origin/main\n")).toEqual({
      branch: "main",
      dirty: false,
      dirtyCount: 0,
    });
  });

  it("parses a dirty tree with counts", () => {
    const out = "## feat/x...origin/feat/x [ahead 1]\n M src/a.ts\n?? new.txt\n";
    expect(parseGitStatus(out)).toEqual({
      branch: "feat/x",
      dirty: true,
      dirtyCount: 2,
    });
  });

  it("handles a local-only branch without upstream", () => {
    expect(parseGitStatus("## feat/local\n")).toEqual({
      branch: "feat/local",
      dirty: false,
      dirtyCount: 0,
    });
  });

  it("flags detached HEAD", () => {
    expect(parseGitStatus("## HEAD (no branch)\n M x\n")).toEqual({
      branch: "(detached)",
      dirty: true,
      dirtyCount: 1,
    });
  });

  it("tolerates empty output", () => {
    expect(parseGitStatus("")).toEqual({
      branch: null,
      dirty: false,
      dirtyCount: 0,
    });
  });
});

describe("computeVersionGap", () => {
  it("is all-null when everything matches", () => {
    expect(computeVersionGap("1.2.3", "1.2.3", "1.2.3")).toEqual({
      localVsDev: null,
      localVsProd: null,
      devVsProd: null,
    });
  });

  it("reports each pairwise difference", () => {
    const gap = computeVersionGap("1.3.0", "1.3.0", "1.2.9");
    expect(gap.localVsDev).toBeNull();
    expect(gap.localVsProd).toContain("1.3.0");
    expect(gap.localVsProd).toContain("1.2.9");
    expect(gap.devVsProd).toContain("dev DB (1.3.0)");
  });

  it("treats null members as not comparable", () => {
    expect(computeVersionGap(null, "1.0.0", null)).toEqual({
      localVsDev: null,
      localVsProd: null,
      devVsProd: null,
    });
  });
});

const fullInput: FleetProjectInput = {
  name: "commander",
  localVersion: "3.4.1",
  git: { branch: "main", dirty: false, dirtyCount: 0 },
  changelog: { dev: "3.4.1", prod: "3.4.0" },
  urls: { dev: "https://dev.example", prod: "https://example" },
  notes: [],
};

describe("buildFleetPayload", () => {
  it("computes gaps for projects with changelog data", () => {
    const payload = buildFleetPayload("2.1.0", "2026-07-29T00:00:00Z", [fullInput]);
    expect(payload.serverVersion).toBe("2.1.0");
    expect(payload.projects[0].gap?.devVsProd).toContain("3.4.0");
    expect(payload.projects[0].urls).toEqual(fullInput.urls);
  });

  it("omits changelog/gap/urls for degraded projects", () => {
    const payload = buildFleetPayload("2.1.0", "2026-07-29T00:00:00Z", [
      {
        name: "portfolio",
        localVersion: null,
        git: null,
        notes: ["repo not present on this machine"],
      },
    ]);
    const p = payload.projects[0];
    expect(p.changelog).toBeUndefined();
    expect(p.gap).toBeUndefined();
    expect(p.urls).toBeUndefined();
    expect(p.notes).toHaveLength(1);
  });

  it("drops an urls object whose members are all undefined", () => {
    const payload = buildFleetPayload("2.1.0", "t", [
      { ...fullInput, urls: { dev: undefined, prod: undefined } },
    ]);
    expect(payload.projects[0].urls).toBeUndefined();
  });
});

describe("summarizeFleet", () => {
  const payload = buildFleetPayload("2.1.0", "2026-07-29T00:00:00Z", [
    fullInput,
    {
      name: "grandkid",
      localVersion: "1.9.0",
      git: { branch: "main", dirty: true, dirtyCount: 3 },
      notes: ["changelog connections not configured on this machine"],
    },
  ]);
  const text = summarizeFleet(payload);

  it("mentions every project with version, git, and gap details", () => {
    expect(text).toContain("commander");
    expect(text).toContain("v3.4.1");
    expect(text).toContain("clean");
    expect(text).toContain("GAP:");
    expect(text).toContain("grandkid");
    expect(text).toContain("dirty (3 files)");
    expect(text).toContain("notes:");
  });

  it("is prose, not JSON (dispatch-wrapper safety)", () => {
    expect(() => JSON.parse(text)).toThrow();
  });

  it("degrades wording when nothing is known", () => {
    const degraded = summarizeFleet(
      buildFleetPayload("2.1.0", "t", [
        { name: "portfolio", localVersion: null, git: null, notes: [] },
      ]),
    );
    expect(degraded).toContain("version unknown");
    expect(degraded).toContain("git state unknown");
  });
});
