import mysql from "mysql2/promise";
import { getConnection, type ConnectionConfig } from "../config/connections.js";
import { executeViaSsh, type QueryResult } from "./ssh-mysql.js";

export interface QueryRunner {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

const runners = new Map<string, Promise<QueryRunner>>();

function buildMysql2Runner(pool: mysql.Pool): QueryRunner {
  return {
    async query(sql, params) {
      return pool.query(sql, params ?? []);
    },
  };
}

function buildSshRunner(conn: ConnectionConfig & { ssh: NonNullable<ConnectionConfig["ssh"]> }): QueryRunner {
  return {
    async query(sql, params) {
      const result: QueryResult = await executeViaSsh(
        conn,
        sql,
        (params ?? []) as (string | number | boolean | null)[],
      );
      if (result.rows !== undefined) {
        return [result.rows, []];
      }
      const header = {
        affectedRows: result.affectedRows ?? 0,
        insertId: result.insertId ?? 0,
        warningStatus: 0,
      } as unknown as mysql.ResultSetHeader;
      return [header, []];
    },
  };
}

async function buildRunner(connectionName: string): Promise<QueryRunner> {
  const conn = getConnection(connectionName);
  if (conn.ssh) {
    return buildSshRunner(conn as ConnectionConfig & { ssh: NonNullable<ConnectionConfig["ssh"]> });
  }
  const pool = mysql.createPool({
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
  return buildMysql2Runner(pool);
}

export function getPool(connectionName: string): Promise<QueryRunner> {
  let promise = runners.get(connectionName);
  if (promise) return promise;
  promise = buildRunner(connectionName);
  runners.set(connectionName, promise);
  promise.catch(() => runners.delete(connectionName));
  return promise;
}
