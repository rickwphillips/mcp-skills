import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConnection } from "../config/connections.js";
import { getPool } from "../lib/db-pool.js";
import { isReadOnlyStatement, isSingleStatement } from "../lib/ssh-mysql.js";

const inputSchema = {
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
};

export const registerDbReadTool = (server: McpServer) => {
  server.registerTool(
    "db_read",
    {
      title: "Database Read",
      description:
        "Run a read-only SQL query against a configured MySQL connection. Returns rows as JSON. " +
        "The server uses a native MySQL driver — pass raw SQL exactly as MySQL expects it; do NOT shell-escape. " +
        "Use SQL's own escaping (e.g. '' for a literal apostrophe) or pass the optional `params` array to bind values safely. " +
        "The response includes `executed_sql` so you can verify exactly what reached the database.",
      inputSchema,
    },
    async ({ connection, query, params }) => {
      const conn = getConnection(connection);
      const env = conn.env ?? "dev";
      // db_read must never mutate. Reject anything that isn't a single read
      // statement so a DELETE/UPDATE can't slip through this tool and bypass
      // db_write's prod CONFIRM gate and audit log — including a stacked
      // "SELECT 1; UPDATE ..." whose first keyword is read-only but which the
      // SSH shell-out path would execute in full.
      if (!isSingleStatement(query)) {
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
                  error:
                    "db_read accepts a single statement only; stacked statements (';'-separated) are not allowed.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      if (!isReadOnlyStatement(query)) {
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
                  error:
                    "db_read only accepts read-only statements (SELECT / WITH / SHOW / DESCRIBE / EXPLAIN). Use db_write for anything that modifies data.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      const pool = await getPool(connection);
      try {
        const [rows] = await pool.query(query, params ?? []);
        const arr = Array.isArray(rows) ? rows : [];
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
                  row_count: arr.length,
                  rows: arr,
                },
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
