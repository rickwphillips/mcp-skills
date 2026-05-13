import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
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
