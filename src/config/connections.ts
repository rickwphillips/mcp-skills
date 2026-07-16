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
    port?: number;
    user: string;
    privateKey?: string;
    remoteHost?: string;
    remotePort?: number;
  };
  env?: "dev" | "prod";
  description?: string;
}

/**
 * A named credential whose secret lives wherever the operator put it. The
 * config records the LOCATION only — the secret itself is fetched on demand
 * (macOS Keychain or env var) and never stored in this file.
 */
export type CredentialConfig = KeychainCredential | EnvCredential;

interface CredentialBase {
  description?: string;
  /**
   * "jwt" credentials mint an HS256 token locally from the fetched secret
   * (the shared-auth model used by commander/portfolio/grandkid). Requires
   * user_id + username. Omitted/"password" = plain username+password pair.
   */
  kind?: "password" | "jwt";
  /** JWT subject (auth_users UUID). Required when kind === "jwt". */
  user_id?: string;
  /** JWT username claim, or the login username for form logins. */
  username?: string;
}

export interface KeychainCredential extends CredentialBase {
  method: "keychain";
  /** `security find-generic-password -s <service> -a <account> -w` */
  keychain_service: string;
  keychain_account: string;
}

export interface EnvCredential extends CredentialBase {
  method: "env";
  /** Env var holding the secret (password or JWT secret). */
  secret_env: string;
}

/**
 * A named base URL the playwright session tools can drive, with the auth
 * strategy that gets a fresh browser session logged in.
 */
export interface PlaywrightTargetConfig {
  base_url: string;
  /**
   * "jwt": mint an HS256 token from `credential` and inject it into
   * localStorage under `storage_key` before first navigation.
   * "form": fill a login form at `login_path` with the credential's
   * username + secret. "none": no auth (default when omitted).
   */
  auth?: "jwt" | "form" | "none";
  /** Default credential name (a key under `credentials`). */
  credential?: string;
  /** localStorage key for the JWT strategy. Default "auth_token". */
  storage_key?: string;
  /** Login form path for the form strategy. Default "/login". */
  login_path?: string;
  env?: "dev" | "prod";
  description?: string;
}

export interface ServerConfig {
  connections: Record<string, ConnectionConfig>;
  credentials?: Record<string, CredentialConfig>;
  playwrightTargets?: Record<string, PlaywrightTargetConfig>;
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

export function getCredentialConfig(name: string): CredentialConfig {
  const config = loadConfig();
  const cred = config.credentials?.[name];
  if (!cred) {
    const available = Object.keys(config.credentials ?? {}).join(", ") || "(none configured)";
    throw new Error(
      `Unknown credential "${name}". Available: ${available}. ` +
        `Configure credentials in ${DEFAULT_CONFIG_PATHS[1]}.`,
    );
  }
  return cred;
}

export function getPlaywrightTarget(name: string): PlaywrightTargetConfig {
  const config = loadConfig();
  const target = config.playwrightTargets?.[name];
  if (!target) {
    const available = Object.keys(config.playwrightTargets ?? {}).join(", ") || "(none configured)";
    throw new Error(
      `Unknown playwright target "${name}". Available: ${available}. ` +
        `Configure playwrightTargets in ${DEFAULT_CONFIG_PATHS[1]}.`,
    );
  }
  return target;
}

export function listPlaywrightTargets(): string[] {
  return Object.keys(loadConfig().playwrightTargets ?? {});
}
