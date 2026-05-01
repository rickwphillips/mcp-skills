import mysql from "mysql2/promise";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { getConnection, listConnections, loadConfig } from "../config/connections.js";

export const dbReadSchema = z.object({
  connection: z
    .string()
    .describe("Connection name as defined in the server's connections config."),
  query: z
    .string()
    .describe(
      "Raw SQL to execute. The server uses a native MySQL driver — do NOT shell-escape. " +
        "Use SQL's own escaping (e.g. '' for a literal apostrophe).",
    ),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe(
      "Optional parameters for `?` placeholders in the query. " +
        "When provided, the driver binds them safely and the agent does no escaping.",
    ),
});

export const dbWriteSchema = z.object({
  connection: z.string().describe("Connection name as defined in the server's connections config."),
  query: z
    .string()
    .describe(
      "Raw SQL to execute. The server uses a native MySQL driver — do NOT shell-escape.",
    ),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe("Optional parameters for `?` placeholders."),
  read_before_state: z
    .string()
    .optional()
    .describe(
      "Optional human-readable description of the rows that will change " +
        "(captured by the agent via a prior db_read). Stored in the audit log.",
    ),
  rollback_sql: z
    .string()
    .optional()
    .describe("SQL that would reverse this write. Stored in the audit log; echoed in response."),
  confirm: z
    .literal("CONFIRM")
    .optional()
    .describe(
      "Required when connection.env === 'prod'. Pass the literal string 'CONFIRM' to acknowledge.",
    ),
});

export type DbReadInput = z.infer<typeof dbReadSchema>;
export type DbWriteInput = z.infer<typeof dbWriteSchema>;

const pools = new Map<string, mysql.Pool>();

function getPool(connectionName: string): mysql.Pool {
  let pool = pools.get(connectionName);
  if (pool) return pool;

  const conn = getConnection(connectionName);
  pool = mysql.createPool({
    host: conn.host,
    port: conn.port ?? 3306,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    waitForConnections: true,
    connectionLimit: 5,
    multipleStatements: false,
    charset: "utf8mb4",
  });
  pools.set(connectionName, pool);
  return pool;
}

export async function dbRead(input: DbReadInput): Promise<string> {
  const { connection, query, params } = dbReadSchema.parse(input);
  const conn = getConnection(connection);
  const env = conn.env ?? "dev";
  const pool = getPool(connection);

  try {
    const [rows] = await pool.query(query, params ?? []);
    const arr = Array.isArray(rows) ? rows : [];
    const payload = {
      env,
      connection,
      database: conn.database,
      executed_sql: query,
      params: params ?? [],
      row_count: arr.length,
      rows: arr,
    };
    return JSON.stringify(payload, null, 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify(
      {
        env,
        connection,
        database: conn.database,
        executed_sql: query,
        params: params ?? [],
        error: msg,
      },
      null,
      2,
    );
  }
}

export async function dbWrite(input: DbWriteInput): Promise<string> {
  const parsed = dbWriteSchema.parse(input);
  const { connection, query, params, read_before_state, rollback_sql, confirm } = parsed;
  const conn = getConnection(connection);
  const env = conn.env ?? "dev";

  if (env === "prod" && confirm !== "CONFIRM") {
    return JSON.stringify(
      {
        env,
        connection,
        database: conn.database,
        executed_sql: query,
        params: params ?? [],
        status: "REQUIRES_CONFIRMATION",
        message:
          "PRODUCTION write blocked. Re-call db_write with confirm: \"CONFIRM\" after surfacing the read-before state and the SQL to the user. Include rollback_sql.",
      },
      null,
      2,
    );
  }

  const pool = getPool(connection);
  try {
    const [result] = await pool.query(query, params ?? []);
    const okResult = result as mysql.ResultSetHeader;
    const audit = {
      ts: new Date().toISOString(),
      env,
      connection,
      database: conn.database,
      executed_sql: query,
      params: params ?? [],
      affected_rows: okResult.affectedRows ?? null,
      insert_id: okResult.insertId ?? null,
      read_before_state: read_before_state ?? null,
      rollback_sql: rollback_sql ?? null,
    };
    appendAudit(audit);
    pruneAudit();

    return JSON.stringify(
      {
        ...audit,
        status: "OK",
      },
      null,
      2,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify(
      {
        env,
        connection,
        database: conn.database,
        executed_sql: query,
        params: params ?? [],
        status: "ERROR",
        error: msg,
      },
      null,
      2,
    );
  }
}

function appendAudit(entry: Record<string, unknown>): void {
  const path = loadConfig().auditLogPath!;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

function pruneAudit(): void {
  const path = loadConfig().auditLogPath!;
  if (!existsSync(path)) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const kept = lines.filter((line) => {
    try {
      const parsed = JSON.parse(line);
      return new Date(parsed.ts).getTime() > cutoff;
    } catch {
      return false;
    }
  });
  writeFileSync(path, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
}

export function listAvailableConnections(): string {
  const names = listConnections();
  if (names.length === 0) {
    return JSON.stringify(
      {
        connections: [],
        message:
          "No connections configured. Create ~/.config/mcp-skills/config.json — see README.",
      },
      null,
      2,
    );
  }
  const detail = names.map((n) => {
    const c = getConnection(n);
    return {
      name: n,
      env: c.env ?? "dev",
      database: c.database,
      host: c.host,
      description: c.description ?? null,
    };
  });
  return JSON.stringify({ connections: detail }, null, 2);
}
