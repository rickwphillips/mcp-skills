import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import { z } from "zod";
import { getConnection, loadConfig } from "../config/connections.js";
import { getPool } from "../lib/db-pool.js";

// Prod writes awaiting CONFIRM, keyed by a hash of the exact (connection, query,
// params) surfaced on the first call. A confirm only executes a write that was
// actually reviewed first: a lone confirm: "CONFIRM" on the first call, or a
// confirm whose SQL differs from what was surfaced, matches nothing and is
// rejected. In-memory + short TTL, so it fails closed across a server restart.
const pendingConfirms = new Map<string, number>();
const CONFIRM_TTL_MS = 5 * 60 * 1000;

function confirmKey(connection: string, query: string, params: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify([connection, query, params]))
    .digest("hex");
}

function prunePendingConfirms(now: number): void {
  for (const [k, ts] of pendingConfirms) {
    if (now - ts > CONFIRM_TTL_MS) pendingConfirms.delete(k);
  }
}

const inputSchema = {
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
};

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

export const registerDbWriteTool = (server: McpServer) => {
  server.registerTool(
    "db_write",
    {
      title: "Database Write",
      description:
        "Run a write SQL statement (INSERT/UPDATE/DELETE) against a configured MySQL connection. " +
        "If the target connection is marked env: 'prod', the first call returns REQUIRES_CONFIRMATION; " +
        "the agent must surface the SQL + read-before state to the user, then re-call with confirm: 'CONFIRM'. " +
        "All successful writes are appended to the audit log (kept 30 days). " +
        "Pass `rollback_sql` so the response and audit log can echo it.",
      inputSchema,
    },
    async ({ connection, query, params, read_before_state, rollback_sql, confirm }) => {
      const conn = getConnection(connection);
      const env = conn.env ?? "dev";

      if (env === "prod") {
        const now = Date.now();
        prunePendingConfirms(now);
        const key = confirmKey(connection, query, params ?? []);

        if (confirm !== "CONFIRM") {
          // First step: register this exact write as pending and ask for
          // confirmation. Nothing executes yet.
          pendingConfirms.set(key, now);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    env,
                    connection,
                    database: conn.database,
                    executed_sql: query,
                    params: params ?? [],
                    status: "REQUIRES_CONFIRMATION",
                    message:
                      "PRODUCTION write blocked. Re-call db_write with confirm: \"CONFIRM\" and the identical SQL/params after surfacing the read-before state to the user. Include rollback_sql.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Second step: only proceed if this exact SQL was surfaced first.
        const pendingTs = pendingConfirms.get(key);
        if (pendingTs === undefined) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    env,
                    connection,
                    database: conn.database,
                    executed_sql: query,
                    params: params ?? [],
                    status: "CONFIRMATION_NOT_FOUND",
                    message:
                      "No pending write matches this exact connection/SQL/params (or it expired). Call db_write WITHOUT confirm first to surface the read-before state, then re-call with confirm: \"CONFIRM\" and the identical SQL.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        // Consume the token — one confirm per surfaced write.
        pendingConfirms.delete(key);
      }

      const pool = await getPool(connection);
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
        // The write has already committed. If auditing fails, do NOT fall into
        // the catch below and report ERROR — that would prompt a retry and
        // duplicate the row. Surface the audit failure as a warning on an OK
        // result instead.
        let auditWarning: string | null = null;
        try {
          appendAudit(audit);
          pruneAudit();
        } catch (auditErr) {
          auditWarning = auditErr instanceof Error ? auditErr.message : String(auditErr);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                auditWarning
                  ? { ...audit, status: "OK", audit_warning: auditWarning }
                  : { ...audit, status: "OK" },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
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
              ),
            },
          ],
        };
      }
    },
  );
};
