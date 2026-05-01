import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ConnectionConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  ssh?: {
    host: string;
    user?: string;
  };
  env?: "dev" | "prod";
  description?: string;
}

export interface ServerConfig {
  connections: Record<string, ConnectionConfig>;
  auditLogPath?: string;
  pdfWorkDir?: string;
}

const DEFAULT_CONFIG_PATHS = [
  process.env.MCP_SKILLS_CONFIG,
  join(homedir(), ".config", "mcp-skills", "config.json"),
  join(process.cwd(), "mcp-skills.config.json"),
].filter((p): p is string => Boolean(p));

let cached: ServerConfig | null = null;

export function loadConfig(): ServerConfig {
  if (cached) return cached;

  for (const path of DEFAULT_CONFIG_PATHS) {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as ServerConfig;
      validate(parsed, path);
      cached = withDefaults(parsed);
      return cached;
    }
  }

  cached = withDefaults({ connections: {} });
  return cached;
}

function validate(config: ServerConfig, path: string): void {
  if (!config.connections || typeof config.connections !== "object") {
    throw new Error(`Invalid config at ${path}: missing "connections" object`);
  }
  for (const [name, conn] of Object.entries(config.connections)) {
    for (const required of ["host", "user", "password", "database"] as const) {
      if (!conn[required]) {
        throw new Error(
          `Invalid config at ${path}: connection "${name}" missing "${required}"`,
        );
      }
    }
  }
}

function withDefaults(config: ServerConfig): ServerConfig {
  return {
    ...config,
    auditLogPath:
      config.auditLogPath ??
      join(homedir(), ".local", "share", "mcp-skills", "write-audit.jsonl"),
    pdfWorkDir: config.pdfWorkDir ?? join(homedir(), ".cache", "mcp-skills", "pdf"),
  };
}

export function getConnection(name: string): ConnectionConfig {
  const config = loadConfig();
  const conn = config.connections[name];
  if (!conn) {
    const available = Object.keys(config.connections).join(", ") || "(none configured)";
    throw new Error(
      `Unknown connection "${name}". Available: ${available}. ` +
        `Configure connections in ${DEFAULT_CONFIG_PATHS[1]}.`,
    );
  }
  return conn;
}

export function listConnections(): string[] {
  return Object.keys(loadConfig().connections);
}
