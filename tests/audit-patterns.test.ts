import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AUDIT_DIR, AUDIT_ERRORS_PATH } from "../src/lib/logger.js";
import {
  summarizeMcpErrors,
  markMcpPatternResolved,
  recordPatternNote,
  markPatternNote,
  getSteeringForPattern,
  getMcpHealth,
} from "../src/lib/audit-patterns.js";

const PATTERNS_PATH = join(AUDIT_DIR, "patterns.json");

function resetAudit(): void {
  if (existsSync(PATTERNS_PATH)) rmSync(PATTERNS_PATH);
  if (existsSync(AUDIT_ERRORS_PATH)) rmSync(AUDIT_ERRORS_PATH);
  mkdirSync(AUDIT_DIR, { recursive: true });
}

function writeRawError(tool: string, message: string, level: "warn" | "error" = "error"): void {
  mkdirSync(AUDIT_DIR, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    pid: process.pid,
    tool,
    err: message,
  });
  const existing = existsSync(AUDIT_ERRORS_PATH) ? readFileSync(AUDIT_ERRORS_PATH, "utf8") : "";
  writeFileSync(AUDIT_ERRORS_PATH, existing + line + "\n");
}

describe("audit-patterns: signature normalization", () => {
  beforeEach(resetAudit);

  it("strips ticket IDs", () => {
    writeRawError("foo", "Failed to update WBT-1234 with payload");
    writeRawError("foo", "Failed to update PROJ-9999 with payload");
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].normalized_message).toContain("<TICKET>");
    expect(result.patterns[0].count).toBe(2);
  });

  it("strips long numbers, paths, URLs, hashes", () => {
    writeRawError("bar", "connect ECONNREFUSED 127.0.0.1:3306 at /Users/foo/bar/baz.ts:42");
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns[0].normalized_message).toContain("<NUM>");
    expect(result.patterns[0].normalized_message).toContain("<PATH>");
  });

  it("strips https URLs", () => {
    writeRawError("baz", "fetch https://api.example.com/v1/users/123 failed");
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns[0].normalized_message).toContain("<URL>");
  });

  it("strips git hashes", () => {
    writeRawError("qux", "commit abcdef1234567 not found");
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns[0].normalized_message).toContain("<HASH>");
  });

  it("clamps to 240 chars", () => {
    const longMsg = "x".repeat(500);
    writeRawError("clamp", longMsg);
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns[0].normalized_message.length).toBeLessThanOrEqual(240);
  });
});

describe("audit-patterns: recurrence + steering", () => {
  beforeEach(resetAudit);

  it("returns null steering on first occurrence", () => {
    const steering = getSteeringForPattern("db_read", "error", "connect refused");
    expect(steering).toBeNull();
  });

  it("returns first_occurrence recommendation on second occurrence with no notes", () => {
    getSteeringForPattern("db_read", "error", "connect refused");
    const steering = getSteeringForPattern("db_read", "error", "connect refused");
    expect(steering).not.toBeNull();
    expect(steering!.recommendation).toBe("first_occurrence");
    expect(steering!.count).toBe(2);
    expect(steering!.active_notes).toHaveLength(0);
  });

  it("flips to apply_active_notes after a note is recorded", () => {
    getSteeringForPattern("db_read", "error", "connect refused");
    const second = getSteeringForPattern("db_read", "error", "connect refused");
    const noteResult = recordPatternNote({
      pattern_id: second!.pattern_id,
      body: "start mysql with brew services start mysql",
    });
    expect(noteResult.ok).toBe(true);
    const third = getSteeringForPattern("db_read", "error", "connect refused");
    expect(third!.recommendation).toBe("apply_active_notes");
    expect(third!.active_notes).toHaveLength(1);
    expect(third!.active_notes[0].body).toContain("brew services start mysql");
  });

  it("auto-demotes a note after 3 further recurrences without resolution", () => {
    // count 1 (no steering), count 2 (steering: first_occurrence)
    getSteeringForPattern("db_read", "error", "boom");
    const second = getSteeringForPattern("db_read", "error", "boom");
    recordPatternNote({ pattern_id: second!.pattern_id, body: "try X" });
    // count_at_creation = 2
    // count 3 → diff 1, still active
    let s = getSteeringForPattern("db_read", "error", "boom");
    expect(s!.recommendation).toBe("apply_active_notes");
    // count 4 → diff 2, still active
    s = getSteeringForPattern("db_read", "error", "boom");
    expect(s!.recommendation).toBe("apply_active_notes");
    // count 5 → diff 3, now demoted (because of >=NOTE_STALE_THRESHOLD)
    s = getSteeringForPattern("db_read", "error", "boom");
    expect(s!.recommendation).toBe("fresh_triage");
    expect(s!.active_notes).toHaveLength(0);
    expect(s!.auto_demoted).toBeGreaterThanOrEqual(1);
  });

  it("resolved → reopen flow increments reopen_count", () => {
    getSteeringForPattern("db_read", "error", "boom");
    const second = getSteeringForPattern("db_read", "error", "boom");
    markMcpPatternResolved({ pattern_id: second!.pattern_id, notes: "fixed in commit abc" });
    // next occurrence should reopen
    const reopen = getSteeringForPattern("db_read", "error", "boom");
    expect(reopen!.reopen_count).toBe(1);
  });
});

describe("audit-patterns: note lifecycle", () => {
  beforeEach(resetAudit);

  function seedPattern(): string {
    getSteeringForPattern("db_read", "error", "x");
    const s = getSteeringForPattern("db_read", "error", "x");
    return s!.pattern_id;
  }

  it("recordPatternNote rejects empty body", () => {
    const id = seedPattern();
    const result = recordPatternNote({ pattern_id: id, body: "   " });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/body required/);
  });

  it("recordPatternNote rejects unknown pattern_id", () => {
    const result = recordPatternNote({ pattern_id: "deadbeef0000", body: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pattern not found/);
  });

  it("markPatternNote requires reason for status wrong", () => {
    const id = seedPattern();
    const note = recordPatternNote({ pattern_id: id, body: "try X" });
    const result = markPatternNote({ pattern_id: id, note_id: note.note!.id, status: "wrong" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reason required/);
  });

  it("markPatternNote requires reason for status stale", () => {
    const id = seedPattern();
    const note = recordPatternNote({ pattern_id: id, body: "try X" });
    const result = markPatternNote({ pattern_id: id, note_id: note.note!.id, status: "stale" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reason required/);
  });

  it("markPatternNote accepts superseded without reason", () => {
    const id = seedPattern();
    const note = recordPatternNote({ pattern_id: id, body: "try X" });
    const result = markPatternNote({ pattern_id: id, note_id: note.note!.id, status: "superseded" });
    expect(result.ok).toBe(true);
    expect(result.note!.status).toBe("superseded");
  });

  it("superseded notes drop out of active_notes in steering", () => {
    const id = seedPattern();
    const note = recordPatternNote({ pattern_id: id, body: "try X" });
    markPatternNote({ pattern_id: id, note_id: note.note!.id, status: "superseded" });
    const s = getSteeringForPattern("db_read", "error", "x");
    expect(s!.active_notes).toHaveLength(0);
    expect(s!.superseded_count).toBe(1);
    expect(s!.recommendation).toBe("fresh_triage");
  });
});

describe("audit-patterns: severity classification", () => {
  beforeEach(resetAudit);

  it("classifies 401 / 403 / unauthorized as security", () => {
    writeRawError("foo", "got HTTP 401 from upstream");
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns[0].severity).toBe("security");
  });

  it("classifies token/credential keywords as security", () => {
    writeRawError("foo", "invalid token returned by provider");
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns[0].severity).toBe("security");
  });

  it("classifies generic errors as normal", () => {
    writeRawError("foo", "table 'x' doesn't exist");
    const result = summarizeMcpErrors({ status: "open" });
    expect(result.patterns[0].severity).toBe("normal");
  });
});

describe("audit-patterns: getMcpHealth", () => {
  beforeEach(resetAudit);

  it("returns null when no open patterns", () => {
    expect(getMcpHealth()).toBeNull();
  });

  it("surfaces top patterns ordered by severity then reopen_count then count", () => {
    writeRawError("foo", "got HTTP 401");
    writeRawError("foo", "got HTTP 401");
    writeRawError("foo", "got HTTP 401");
    writeRawError("bar", "table missing");
    writeRawError("bar", "table missing");
    writeRawError("bar", "table missing");
    writeRawError("bar", "table missing");
    const health = getMcpHealth();
    expect(health).not.toBeNull();
    expect(health!.open).toBe(2);
    expect(health!.security_open).toBe(1);
    // security comes first even though bar has higher count
    expect(health!.top[0].tool).toBe("foo");
  });
});

function appendLine(obj: Record<string, unknown>): void {
  mkdirSync(AUDIT_DIR, { recursive: true });
  const existing = existsSync(AUDIT_ERRORS_PATH) ? readFileSync(AUDIT_ERRORS_PATH, "utf8") : "";
  writeFileSync(AUDIT_ERRORS_PATH, existing + JSON.stringify(obj) + "\n");
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function writePatternsFile(patterns: unknown[]): void {
  mkdirSync(AUDIT_DIR, { recursive: true });
  writeFileSync(PATTERNS_PATH, JSON.stringify({ version: 1, patterns }, null, 2));
}

describe("audit-patterns: message extraction + normalization", () => {
  beforeEach(resetAudit);

  it("extracts err.message from an object error", () => {
    appendLine({ level: "error", tool: "t", err: { message: "kaboom" } });
    expect(summarizeMcpErrors({ status: "open" }).patterns[0].normalized_message).toBe("kaboom");
  });

  it("falls back to err.name when message is absent", () => {
    appendLine({ level: "error", tool: "t", err: { name: "TypeError" } });
    expect(summarizeMcpErrors({ status: "open" }).patterns[0].normalized_message).toBe("TypeError");
  });

  it("falls back to msg when there is no err field", () => {
    appendLine({ level: "error", tool: "t", msg: "just a message" });
    expect(summarizeMcpErrors({ status: "open" }).patterns[0].normalized_message).toBe(
      "just a message",
    );
  });

  it("uses the (no message) sentinel when nothing usable is present", () => {
    appendLine({ level: "error", tool: "t" });
    expect(summarizeMcpErrors({ status: "open" }).patterns[0].normalized_message).toBe("(no message)");
  });

  it("defaults tool to (none) when the tool field is missing", () => {
    appendLine({ level: "error", err: "boom" });
    expect(summarizeMcpErrors({ status: "open" }).patterns[0].tool).toBe("(none)");
  });

  it("normalizes 0x hex literals to <HEX>", () => {
    appendLine({ level: "error", tool: "t", err: "fault at 0xDEADBEEF now" });
    expect(summarizeMcpErrors({ status: "open" }).patterns[0].normalized_message).toContain("<HEX>");
  });

  it("ignores raw lines whose level is not warn/error", () => {
    appendLine({ level: "info", tool: "t", msg: "noise" });
    appendLine({ level: "error", tool: "t", err: "real" });
    const r = summarizeMcpErrors({ status: "open" });
    expect(r.patterns).toHaveLength(1);
    expect(r.scanned_raw_lines).toBe(2);
  });
});

describe("audit-patterns: legacy notes migration", () => {
  beforeEach(resetAudit);

  function basePattern(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "legacy1",
      tool: "t",
      level: "error",
      severity: "normal",
      normalized_message: "m",
      count: 2,
      first_seen: daysAgo(1),
      last_seen: daysAgo(1),
      samples: [],
      status: "open",
      ...extra,
    };
  }

  it("migrates a string note into a single note object", () => {
    writePatternsFile([basePattern({ notes: "old inline note" })]);
    const notes = summarizeMcpErrors({ status: "all" }).patterns[0].notes;
    expect(notes).toHaveLength(1);
    expect(notes![0].body).toBe("old inline note");
    expect(notes![0].status).toBe("active");
  });

  it("migrates an array of mixed note entries, dropping invalid ones", () => {
    writePatternsFile([
      basePattern({
        notes: [
          { id: "a", ts: daysAgo(1), body: "valid", status: "active", count_at_creation: 1 },
          { body: "minimal" },
          "string note",
          { nope: true },
          42,
        ],
      }),
    ]);
    const bodies = summarizeMcpErrors({ status: "all" }).patterns[0].notes!.map((n) => n.body);
    expect(bodies).toEqual(["valid", "minimal", "string note"]);
  });

  it("drops a notes field that is neither string nor array", () => {
    writePatternsFile([basePattern({ notes: 42 })]);
    expect(summarizeMcpErrors({ status: "all" }).patterns[0].notes).toBeUndefined();
  });
});

describe("audit-patterns: purge retention", () => {
  beforeEach(resetAudit);

  function base(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "p",
      tool: "t",
      level: "error",
      severity: "normal",
      normalized_message: "m",
      count: 1,
      first_seen: daysAgo(200),
      last_seen: daysAgo(200),
      samples: [],
      status: "open",
      ...extra,
    };
  }

  it("purges resolved patterns past the resolved retention window", () => {
    writePatternsFile([base({ status: "resolved", resolved_at: daysAgo(100), last_seen: daysAgo(100) })]);
    const r = summarizeMcpErrors({ status: "all" });
    expect(r.purged).toBe(1);
    expect(r.total_patterns).toBe(0);
  });

  it("purges resolved patterns using last_seen when resolved_at is absent", () => {
    writePatternsFile([base({ status: "resolved", last_seen: daysAgo(100) })]);
    expect(summarizeMcpErrors({ status: "all" }).purged).toBe(1);
  });

  it("purges open patterns past the open retention window", () => {
    writePatternsFile([base({ status: "open", last_seen: daysAgo(100) })]);
    expect(summarizeMcpErrors({ status: "all" }).purged).toBe(1);
  });

  it("keeps patterns with an unparseable last_seen date", () => {
    writePatternsFile([base({ status: "open", last_seen: "not-a-date" })]);
    const r = summarizeMcpErrors({ status: "all" });
    expect(r.purged).toBe(0);
    expect(r.total_patterns).toBe(1);
  });
});

describe("audit-patterns: auto-rollup + health ordering", () => {
  beforeEach(resetAudit);

  it("rolls up and clears the raw sink when it exceeds the line threshold", () => {
    mkdirSync(AUDIT_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), level: "error", tool: "t", err: "flood" });
    writeFileSync(AUDIT_ERRORS_PATH, (line + "\n").repeat(5001));
    expect(getMcpHealth()).not.toBeNull();
    expect(readFileSync(AUDIT_ERRORS_PATH, "utf8")).toBe("");
  });

  it("detects rollup need by file size for a single oversized line", () => {
    mkdirSync(AUDIT_DIR, { recursive: true });
    const big = "x".repeat(1_100_000);
    const line = JSON.stringify({ ts: new Date().toISOString(), level: "error", tool: "t", err: big });
    writeFileSync(AUDIT_ERRORS_PATH, line + "\n");
    expect(getMcpHealth()).not.toBeNull();
    expect(readFileSync(AUDIT_ERRORS_PATH, "utf8")).toBe("");
  });

  it("orders equal-severity patterns by reopen_count then count", () => {
    writePatternsFile([
      { id: "B", tool: "b", level: "error", severity: "normal", normalized_message: "b", count: 5, first_seen: daysAgo(1), last_seen: daysAgo(1), samples: [], status: "open", reopen_count: 0 },
      { id: "A", tool: "a", level: "error", severity: "normal", normalized_message: "a", count: 2, first_seen: daysAgo(1), last_seen: daysAgo(1), samples: [], status: "open", reopen_count: 1 },
      { id: "C", tool: "c", level: "error", severity: "normal", normalized_message: "c", count: 3, first_seen: daysAgo(1), last_seen: daysAgo(1), samples: [], status: "open", reopen_count: 0 },
    ]);
    expect(getMcpHealth()!.top.map((t) => t.id)).toEqual(["A", "B", "C"]);
  });
});

describe("audit-patterns: severity backfill + reopen via rollup", () => {
  beforeEach(resetAudit);

  it("backfills severity on an existing pattern that lacks it", () => {
    const normalized = "sev msg";
    const id = createHash("sha1").update(`sev_t|error|${normalized}`).digest("hex").slice(0, 12);
    writePatternsFile([
      { id, tool: "sev_t", level: "error", normalized_message: normalized, count: 1, first_seen: daysAgo(1), last_seen: daysAgo(1), samples: [], status: "open" },
    ]);
    appendLine({ level: "error", tool: "sev_t", err: normalized });
    const p = summarizeMcpErrors({ status: "open" }).patterns.find((x) => x.id === id)!;
    expect(p.severity).toBe("normal");
  });

  it("reopens a resolved pattern when a matching raw error rolls up again", () => {
    writeRawError("reopen_t", "reopen msg");
    const id = summarizeMcpErrors({ status: "open" }).patterns[0].id;
    markMcpPatternResolved({ pattern_id: id });
    const p = summarizeMcpErrors({ status: "all" }).patterns.find((x) => x.id === id)!;
    expect(p.status).toBe("open");
    expect(p.reopen_count).toBe(1);
  });
});
