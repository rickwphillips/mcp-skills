import mysql from "mysql2/promise";
import { getConnection } from "../config/connections.js";

const pools = new Map<string, mysql.Pool>();

export function getPool(connectionName: string): mysql.Pool {
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
