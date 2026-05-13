import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT_KEY = /token|password|cookie|authorization|secret|api[_-]?key/i;
const REDACT_VALUE = /\b(glpat-[A-Za-z0-9_-]+|gloas-[A-Za-z0-9_-]+|ATATT[A-Za-z0-9_-]+)\b/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value == null) return value;
  if (typeof value === "string") return value.replace(REDACT_VALUE, "[REDACTED]");
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEY.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

interface LoggerOptions {
  level: LogLevel;
  fileEnabled: boolean;
  filePath: string | null;
  auditEnabled: boolean;
  auditPath: string;
}

// Allow tests (and advanced users) to redirect the storage tree away from
// ~/.local/share/mcp-skills via MCP_SKILLS_HOME. The default keeps the
// canonical path so production usage is unchanged.
const SHARE_DIR =
  process.env.MCP_SKILLS_HOME ?? path.join(os.homedir(), ".local", "share", "mcp-skills");
export const AUDIT_DIR = path.join(SHARE_DIR, "audit");
export const AUDIT_ERRORS_PATH = path.join(AUDIT_DIR, "errors.jsonl");
const LOG_DIR = path.join(SHARE_DIR, "logs");

function readOptions(): LoggerOptions {
  const rawLevel = (process.env.MCP_SKILLS_LOG_LEVEL || "").toLowerCase();
  const level: LogLevel =
    rawLevel === "debug" || rawLevel === "info" || rawLevel === "warn" || rawLevel === "error"
      ? rawLevel
      : "info";

  const rawFile = process.env.MCP_SKILLS_LOG_FILE;
  let fileEnabled = true;
  let filePath: string | null = null;

  if (rawFile === "off" || rawFile === "false" || rawFile === "0") {
    fileEnabled = false;
  } else if (rawFile && rawFile.length > 0) {
    filePath = rawFile;
  } else {
    filePath = path.join(LOG_DIR, `server-${process.pid}.log`);
  }

  const rawAudit = process.env.MCP_SKILLS_AUDIT;
  const auditEnabled = !(rawAudit === "off" || rawAudit === "false" || rawAudit === "0");

  return { level, fileEnabled, filePath, auditEnabled, auditPath: AUDIT_ERRORS_PATH };
}

const options = readOptions();

let fileStream: fs.WriteStream | null = null;
function ensureFileStream(): fs.WriteStream | null {
  if (!options.fileEnabled || !options.filePath) return null;
  if (fileStream) return fileStream;
  try {
    fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
    fileStream = fs.createWriteStream(options.filePath, { flags: "a" });
    fileStream.on("error", () => {
      fileStream = null;
    });
    return fileStream;
  } catch {
    return null;
  }
}

let auditStream: fs.WriteStream | null = null;
function ensureAuditStream(): fs.WriteStream | null {
  if (!options.auditEnabled) return null;
  if (auditStream) return auditStream;
  try {
    fs.mkdirSync(path.dirname(options.auditPath), { recursive: true });
    auditStream = fs.createWriteStream(options.auditPath, { flags: "a" });
    auditStream.on("error", () => {
      auditStream = null;
    });
    return auditStream;
  } catch {
    return null;
  }
}

function pruneOldLogs(): void {
  if (!options.fileEnabled || !options.filePath) return;
  const dir = path.dirname(options.filePath);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith("server-") || !entry.endsWith(".log")) continue;
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        // ignore
      }
    }
  } catch {
    // dir may not exist yet
  }
}

pruneOldLogs();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[options.level];
}

function write(level: LogLevel, payload: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    pid: process.pid,
    ...(redact(payload) as Record<string, unknown>),
  };
  const line = JSON.stringify(record);

  // stderr only — stdout is the MCP JSON-RPC channel
  process.stderr.write(line + "\n");

  const stream = ensureFileStream();
  if (stream) {
    try {
      stream.write(line + "\n");
    } catch {
      // ignore
    }
  }

  // Durable sink for warn/error: survives the 7-day file prune so the
  // audit pattern rollup has data to work with weeks later.
  if (level === "warn" || level === "error") {
    const audit = ensureAuditStream();
    if (audit) {
      try {
        audit.write(line + "\n");
      } catch {
        // ignore
      }
    }
  }
}

function normalize(arg: unknown): Record<string, unknown> {
  if (arg == null) return {};
  if (typeof arg === "string") return { msg: arg };
  if (arg instanceof Error) return { err: serializeError(arg) };
  if (typeof arg === "object") {
    const obj = arg as Record<string, unknown>;
    if (obj.err instanceof Error) {
      return { ...obj, err: serializeError(obj.err) };
    }
    return obj;
  }
  return { msg: String(arg) };
}

export const logger = {
  debug(arg: unknown): void {
    write("debug", normalize(arg));
  },
  info(arg: unknown): void {
    write("info", normalize(arg));
  },
  warn(arg: unknown): void {
    write("warn", normalize(arg));
  },
  error(arg: unknown): void {
    write("error", normalize(arg));
  },
  level: options.level,
  filePath: options.filePath,
  fileEnabled: options.fileEnabled,
  auditEnabled: options.auditEnabled,
  auditPath: options.auditPath,
};
