import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { AUDIT_DIR, AUDIT_ERRORS_PATH } from "./logger.js";

const PATTERNS_PATH = path.join(AUDIT_DIR, "patterns.json");

interface RawErrorLine {
  ts?: string;
  level?: string;
  pid?: number;
  tool?: string;
  ok?: boolean;
  ms?: number;
  msg?: string;
  err?: unknown;
  [key: string]: unknown;
}

export type Severity = "security" | "normal";
export type NoteStatus = "active" | "superseded" | "wrong" | "stale";

export interface PatternNote {
  id: string;
  ts: string;
  body: string;
  status: NoteStatus;
  reason?: string;
  count_at_creation: number;
}

export interface Pattern {
  id: string;
  tool: string;
  level: "warn" | "error";
  severity: Severity;
  normalized_message: string;
  count: number;
  first_seen: string;
  last_seen: string;
  samples: Array<{ ts: string; message: string; pid?: number }>;
  status: "open" | "resolved";
  resolved_at?: string;
  notes?: PatternNote[];
  reopen_count?: number;
}

const NOTE_STALE_THRESHOLD = 3;
const STEERING_RECURRENCE_THRESHOLD = 2;
const NOTE_BODY_MAX = 2048;
const AUTO_ROLLUP_BYTES = 1_000_000;
const AUTO_ROLLUP_LINES = 5_000;

const SECURITY_PATTERN =
  /\b(401|403|unauthor[iz]+ed|forbidden|permission denied|access denied|invalid token|expired token|csrf|secret|credential|api[_-]?key|signature (?:invalid|mismatch)|tls|ssl handshake|cert(?:ificate)? (?:invalid|expired))\b/i;

function classifySeverity(tool: string, normalized: string): Severity {
  if (SECURITY_PATTERN.test(normalized)) return "security";
  if (tool.includes("oauth") || tool.includes("auth")) return "security";
  return "normal";
}

interface PatternsFile {
  version: 1;
  patterns: Pattern[];
}

function migrateNotes(p: Pattern): void {
  const n = p.notes as unknown;
  if (typeof n === "string") {
    p.notes = [
      {
        id: crypto.randomBytes(4).toString("hex"),
        ts: p.resolved_at ?? p.last_seen,
        body: n,
        status: "active",
        count_at_creation: p.count,
      },
    ];
    return;
  }
  if (Array.isArray(n)) {
    p.notes = n
      .map((entry): PatternNote | null => {
        if (typeof entry === "string") {
          return {
            id: crypto.randomBytes(4).toString("hex"),
            ts: p.resolved_at ?? p.last_seen,
            body: entry,
            status: "active",
            count_at_creation: p.count,
          };
        }
        if (entry && typeof entry === "object" && typeof (entry as PatternNote).body === "string") {
          const e = entry as PatternNote;
          return {
            id: typeof e.id === "string" ? e.id : crypto.randomBytes(4).toString("hex"),
            ts: typeof e.ts === "string" ? e.ts : p.last_seen,
            body: e.body,
            status: e.status ?? "active",
            reason: e.reason,
            count_at_creation: typeof e.count_at_creation === "number" ? e.count_at_creation : p.count,
          };
        }
        return null;
      })
      .filter((x): x is PatternNote => x !== null);
    return;
  }
  delete p.notes;
}

function readPatterns(): PatternsFile {
  try {
    const raw = fs.readFileSync(PATTERNS_PATH, "utf8");
    const parsed = JSON.parse(raw) as PatternsFile;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.patterns)) {
      for (const p of parsed.patterns) migrateNotes(p);
      return parsed;
    }
  } catch {
    // missing or unreadable; start fresh
  }
  return { version: 1, patterns: [] };
}

function writePatterns(data: PatternsFile): void {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const tmp = `${PATTERNS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, PATTERNS_PATH);
}

function retainResolvedDays(): number {
  const v = Number(process.env.MCP_SKILLS_AUDIT_RETAIN_RESOLVED_DAYS);
  return Number.isFinite(v) && v > 0 ? v : 7;
}

function retainOpenDays(): number {
  const v = Number(process.env.MCP_SKILLS_AUDIT_RETAIN_OPEN_DAYS);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

function purgeStalePatterns(file: PatternsFile): number {
  const now = Date.now();
  const resolvedCutoff = now - retainResolvedDays() * 24 * 60 * 60 * 1000;
  const openCutoff = now - retainOpenDays() * 24 * 60 * 60 * 1000;
  const before = file.patterns.length;
  file.patterns = file.patterns.filter((p) => {
    if (p.status === "resolved") {
      const ts = p.resolved_at ? Date.parse(p.resolved_at) : Date.parse(p.last_seen);
      return Number.isFinite(ts) ? ts >= resolvedCutoff : true;
    }
    const ts = Date.parse(p.last_seen);
    return Number.isFinite(ts) ? ts >= openCutoff : true;
  });
  return before - file.patterns.length;
}

function readRawErrors(): RawErrorLine[] {
  try {
    const raw = fs.readFileSync(AUDIT_ERRORS_PATH, "utf8");
    const out: RawErrorLine[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as RawErrorLine);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    return [];
  }
}

function extractMessage(entry: RawErrorLine): string {
  if (entry.err && typeof entry.err === "object") {
    const e = entry.err as { message?: unknown; name?: unknown };
    if (typeof e.message === "string" && e.message.length > 0) return e.message;
    if (typeof e.name === "string") return e.name;
  }
  if (typeof entry.err === "string") return entry.err;
  if (typeof entry.msg === "string") return entry.msg;
  return "(no message)";
}

function normalizeMessage(message: string): string {
  return message
    .replace(/\b[A-Z]+-\d+\b/g, "<TICKET>")
    .replace(/\b\d{4,}\b/g, "<NUM>")
    .replace(/\/[\w./-]+/g, "<PATH>")
    .replace(/https?:\/\/\S+/g, "<URL>")
    .replace(/0x[0-9a-fA-F]+/g, "<HEX>")
    .replace(/\b[0-9a-fA-F]{7,40}\b/g, "<HASH>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function patternId(tool: string, level: string, normalized: string): string {
  return crypto.createHash("sha1").update(`${tool}|${level}|${normalized}`).digest("hex").slice(0, 12);
}

export interface SummarizeArgs {
  days?: number;
  top?: number;
  tool?: string;
  status?: "open" | "resolved" | "all";
  clear?: boolean;
}

export interface SummarizeResult {
  scanned_raw_lines: number;
  rolled_up: number;
  purged: number;
  cleared: boolean;
  total_patterns: number;
  patterns: Pattern[];
  audit_path: string;
  patterns_path: string;
}

export function summarizeMcpErrors(args: SummarizeArgs = {}): SummarizeResult {
  const days = args.days ?? 30;
  const top = args.top ?? 10;
  const statusFilter = args.status ?? "open";
  const clear = args.clear ?? false;

  const file = readPatterns();
  const raw = readRawErrors();
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  let rolledUp = 0;

  for (const entry of raw) {
    const level = entry.level === "warn" || entry.level === "error" ? entry.level : null;
    if (!level) continue;
    const tool = typeof entry.tool === "string" ? entry.tool : "(none)";
    const ts = typeof entry.ts === "string" ? entry.ts : new Date().toISOString();
    const message = extractMessage(entry);
    const normalized = normalizeMessage(message);
    const id = patternId(tool, level, normalized);

    let p = file.patterns.find((x) => x.id === id);
    if (!p) {
      p = {
        id,
        tool,
        level,
        severity: classifySeverity(tool, normalized),
        normalized_message: normalized,
        count: 0,
        first_seen: ts,
        last_seen: ts,
        samples: [],
        status: "open",
      };
      file.patterns.push(p);
    } else if (!p.severity) {
      p.severity = classifySeverity(tool, normalized);
    }

    if (p.status === "resolved") {
      p.status = "open";
      p.reopen_count = (p.reopen_count ?? 0) + 1;
      delete p.resolved_at;
    }

    p.count += 1;
    if (ts < p.first_seen) p.first_seen = ts;
    if (ts > p.last_seen) p.last_seen = ts;
    if (p.samples.length < 3) {
      p.samples.push({ ts, message: message.slice(0, 500), pid: entry.pid });
    }
    rolledUp += 1;
  }

  const purged = purgeStalePatterns(file);
  if (rolledUp > 0 || purged > 0) writePatterns(file);

  if (clear) {
    try {
      fs.writeFileSync(AUDIT_ERRORS_PATH, "");
    } catch {
      // ignore
    }
  }

  const filtered = file.patterns
    .filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (args.tool && p.tool !== args.tool) return false;
      if (Date.parse(p.last_seen) < cutoffMs) return false;
      return true;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, top);

  return {
    scanned_raw_lines: raw.length,
    rolled_up: rolledUp,
    purged,
    cleared: clear,
    total_patterns: file.patterns.length,
    patterns: filtered,
    audit_path: AUDIT_ERRORS_PATH,
    patterns_path: PATTERNS_PATH,
  };
}

function rawNeedsRollup(): boolean {
  try {
    const stat = fs.statSync(AUDIT_ERRORS_PATH);
    if (stat.size >= AUTO_ROLLUP_BYTES) return true;
  } catch {
    return false;
  }
  try {
    const raw = fs.readFileSync(AUDIT_ERRORS_PATH, "utf8");
    let lines = 0;
    for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) lines++;
    return lines >= AUTO_ROLLUP_LINES;
  } catch {
    return false;
  }
}

export interface McpHealthSummary {
  open: number;
  security_open: number;
  regressions: number;
  top: Array<Pick<Pattern, "id" | "tool" | "count" | "last_seen" | "severity" | "normalized_message" | "reopen_count">>;
}

export function getMcpHealth(): McpHealthSummary | null {
  if (rawNeedsRollup()) {
    summarizeMcpErrors({ clear: true, top: 0 });
  } else {
    summarizeMcpErrors({ clear: false, top: 0 });
  }

  const file = readPatterns();
  const open = file.patterns.filter((p) => p.status === "open");
  if (open.length === 0) return null;

  const security = open.filter((p) => p.severity === "security");
  const regressions = open.filter((p) => (p.reopen_count ?? 0) > 0);

  const top = open
    .slice()
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "security" ? -1 : 1;
      const aReopen = a.reopen_count ?? 0;
      const bReopen = b.reopen_count ?? 0;
      if (aReopen !== bReopen) return bReopen - aReopen;
      return b.count - a.count;
    })
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      tool: p.tool,
      count: p.count,
      last_seen: p.last_seen,
      severity: p.severity,
      normalized_message: p.normalized_message,
      reopen_count: p.reopen_count,
    }));

  return { open: open.length, security_open: security.length, regressions: regressions.length, top };
}

export interface MarkResolvedArgs {
  pattern_id: string;
  notes?: string;
}

export interface MarkResolvedResult {
  ok: boolean;
  pattern?: Pattern;
  error?: string;
}

function appendNote(p: Pattern, body: string, status: NoteStatus = "active"): PatternNote {
  if (!p.notes) p.notes = [];
  const note: PatternNote = {
    id: crypto.randomBytes(4).toString("hex"),
    ts: new Date().toISOString(),
    body,
    status,
    count_at_creation: p.count,
  };
  p.notes.push(note);
  return note;
}

export function markMcpPatternResolved(args: MarkResolvedArgs): MarkResolvedResult {
  const file = readPatterns();
  const p = file.patterns.find((x) => x.id === args.pattern_id);
  if (!p) return { ok: false, error: `pattern not found: ${args.pattern_id}` };
  p.status = "resolved";
  p.resolved_at = new Date().toISOString();
  if (args.notes) appendNote(p, args.notes);
  writePatterns(file);
  return { ok: true, pattern: p };
}

function autoDemoteStaleNotes(p: Pattern): number {
  if (!p.notes || p.notes.length === 0) return 0;
  let demoted = 0;
  for (const note of p.notes) {
    if (note.status !== "active") continue;
    if (p.count - note.count_at_creation >= NOTE_STALE_THRESHOLD) {
      note.status = "stale";
      note.reason = `auto-demoted: pattern recurred ${p.count - note.count_at_creation} more times after this note`;
      demoted += 1;
    }
  }
  return demoted;
}

export interface RecordPatternNoteArgs {
  pattern_id: string;
  body: string;
}

export interface RecordPatternNoteResult {
  ok: boolean;
  note?: PatternNote;
  error?: string;
}

export function recordPatternNote(args: RecordPatternNoteArgs): RecordPatternNoteResult {
  let body = (args.body ?? "").trim();
  if (!body) return { ok: false, error: "body required" };
  if (body.length > NOTE_BODY_MAX) body = body.slice(0, NOTE_BODY_MAX) + "…";
  const file = readPatterns();
  const p = file.patterns.find((x) => x.id === args.pattern_id);
  if (!p) return { ok: false, error: `pattern not found: ${args.pattern_id}` };
  const note = appendNote(p, body, "active");
  writePatterns(file);
  return { ok: true, note };
}

export interface MarkPatternNoteArgs {
  pattern_id: string;
  note_id: string;
  status: NoteStatus;
  reason?: string;
}

export interface MarkPatternNoteResult {
  ok: boolean;
  note?: PatternNote;
  error?: string;
}

export function markPatternNote(args: MarkPatternNoteArgs): MarkPatternNoteResult {
  const { pattern_id, note_id, status, reason } = args;
  if (status === "wrong" || status === "stale") {
    if (!reason || !reason.trim()) {
      return { ok: false, error: `reason required when marking note as ${status}` };
    }
  }
  const file = readPatterns();
  const p = file.patterns.find((x) => x.id === pattern_id);
  if (!p) return { ok: false, error: `pattern not found: ${pattern_id}` };
  const note = p.notes?.find((n) => n.id === note_id);
  if (!note) return { ok: false, error: `note not found: ${note_id}` };
  note.status = status;
  if (reason) note.reason = reason;
  writePatterns(file);
  return { ok: true, note };
}

export interface SteeringPayload {
  pattern_id: string;
  count: number;
  reopen_count: number;
  severity: Severity;
  active_notes: Array<Pick<PatternNote, "id" | "ts" | "body">>;
  superseded_count: number;
  recommendation: "apply_active_notes" | "fresh_triage" | "first_occurrence";
  auto_demoted?: number;
}

function upsertOccurrence(file: PatternsFile, tool: string, level: "warn" | "error", message: string): Pattern {
  const normalized = normalizeMessage(message);
  const id = patternId(tool, level, normalized);
  let p = file.patterns.find((x) => x.id === id);
  const ts = new Date().toISOString();
  if (!p) {
    p = {
      id,
      tool,
      level,
      severity: classifySeverity(tool, normalized),
      normalized_message: normalized,
      count: 0,
      first_seen: ts,
      last_seen: ts,
      samples: [],
      status: "open",
    };
    file.patterns.push(p);
  }
  if (p.status === "resolved") {
    p.status = "open";
    p.reopen_count = (p.reopen_count ?? 0) + 1;
    delete p.resolved_at;
  }
  p.count += 1;
  if (ts > p.last_seen) p.last_seen = ts;
  if (p.samples.length < 3) p.samples.push({ ts, message: message.slice(0, 500) });
  return p;
}

export function getSteeringForPattern(
  tool: string,
  level: "warn" | "error",
  message: string,
): SteeringPayload | null {
  const file = readPatterns();
  const p = upsertOccurrence(file, tool, level, message);
  const demoted = autoDemoteStaleNotes(p);
  writePatterns(file);

  if (p.count < STEERING_RECURRENCE_THRESHOLD && (p.reopen_count ?? 0) === 0) return null;

  const active = (p.notes ?? []).filter((n) => n.status === "active");
  const superseded = (p.notes ?? []).filter((n) => n.status !== "active").length;

  const recommendation: SteeringPayload["recommendation"] =
    active.length > 0
      ? "apply_active_notes"
      : p.notes && p.notes.length > 0
        ? "fresh_triage"
        : "first_occurrence";

  return {
    pattern_id: p.id,
    count: p.count,
    reopen_count: p.reopen_count ?? 0,
    severity: p.severity,
    active_notes: active.map((n) => ({ id: n.id, ts: n.ts, body: n.body })),
    superseded_count: superseded,
    recommendation,
    auto_demoted: demoted > 0 ? demoted : undefined,
  };
}
