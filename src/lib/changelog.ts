import { getPool } from "./db-pool.js";

/**
 * Latest release version recorded in a project's changelog_releases table
 * (the schema cc_status reads). IO helper — excluded from coverage like
 * db-pool itself.
 */
export async function fetchLatestChangelogVersion(
  connectionName: string,
): Promise<string | null> {
  const pool = await getPool(connectionName);
  const [rows] = await pool.query(
    `SELECT version FROM changelog_releases ORDER BY sort_order DESC LIMIT 1`,
  );
  return (rows as { version: string }[])[0]?.version ?? null;
}
