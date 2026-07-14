import { spawn } from "node:child_process";
import type { ConnectionConfig } from "../config/connections.js";

export interface QueryResult {
  rows?: Record<string, unknown>[];
  affectedRows?: number;
  insertId?: number;
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function isSingleStatement(sql: string): boolean {
  // True if `sql` is a single statement (an optional trailing ';' is allowed).
  // Strips string literals and comments first so a ';' inside 'a;b' or a comment
  // is not mistaken for a statement separator. Used to reject stacked statements
  // (e.g. "SELECT 1; UPDATE t SET ...") on the db_read path, where the SSH
  // shell-out would otherwise execute every ';'-separated statement.
  let stripped = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; } // doubled-quote escape
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    stripped += ch;
    i++;
  }
  return !stripped.replace(/;\s*$/, "").includes(";");
}

export function isReadOnlyStatement(sql: string): boolean {
  // Strip leading line (-- ...) and block (/* ... */) comments plus whitespace
  // so a comment prefix can't hide the real leading keyword.
  let head = sql;
  let prev;
  do {
    prev = head;
    head = head.replace(/^\s+/, "").replace(/^--[^\n]*\n?/, "").replace(/^\/\*[\s\S]*?\*\//, "");
  } while (head !== prev);
  head = head.toUpperCase();
  return (
    head.startsWith("SELECT") ||
    head.startsWith("WITH") ||
    head.startsWith("SHOW") ||
    head.startsWith("DESCRIBE") ||
    head.startsWith("DESC ") ||
    head.startsWith("EXPLAIN")
  );
}

export function buildScript(sql: string, params: (string | number | boolean | null)[]): { script: string; isSelect: boolean } {
  const isSelect = isReadOnlyStatement(sql);
  const lines: string[] = [];
  params.forEach((p, i) => {
    if (p === null) {
      lines.push(`SET @p${i} = NULL;`);
    } else if (typeof p === "boolean") {
      lines.push(`SET @p${i} = ${p ? 1 : 0};`);
    } else if (typeof p === "number") {
      lines.push(`SET @p${i} = ${Number(p)};`);
    } else {
      const b64 = Buffer.from(String(p), "utf8").toString("base64");
      lines.push(`SET @p${i} = CONVERT(FROM_BASE64('${b64}') USING utf8mb4);`);
    }
  });
  if (params.length > 0) {
    const sqlB64 = Buffer.from(sql, "utf8").toString("base64");
    lines.push(`SET @sql_stmt = CONVERT(FROM_BASE64('${sqlB64}') USING utf8mb4);`);
    lines.push(`PREPARE stmt FROM @sql_stmt;`);
    const usingClause = params.length > 0 ? ` USING ${params.map((_, i) => `@p${i}`).join(", ")}` : "";
    lines.push(`EXECUTE stmt${usingClause};`);
    if (!isSelect) {
      lines.push("SELECT ROW_COUNT() AS affected_rows, LAST_INSERT_ID() AS insert_id;");
    }
    lines.push(`DEALLOCATE PREPARE stmt;`);
  } else {
    const stmt = sql.trim().endsWith(";") ? sql.trim() : sql.trim() + ";";
    lines.push(stmt);
    if (!isSelect) {
      lines.push("SELECT ROW_COUNT() AS affected_rows, LAST_INSERT_ID() AS insert_id;");
    }
  }
  return { script: lines.join("\n") + "\n", isSelect };
}

function decodeBatchValue(s: string): unknown {
  if (s === "NULL") return null;
  return s.replace(/\\([nt0rZ"'\\])/g, (_m, c) => {
    switch (c) {
      case "n": return "\n";
      case "t": return "\t";
      case "0": return "\0";
      case "r": return "\r";
      case "Z": return "\x1a";
      case '"': return '"';
      case "'": return "'";
      case "\\": return "\\";
      default: return c;
    }
  });
}

export function parseBatchOutput(out: string, isSelect: boolean): QueryResult {
  const trimmed = out.replace(/\r/g, "");
  if (!trimmed) return isSelect ? { rows: [] } : { affectedRows: 0, insertId: 0 };

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (line === "") {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);

  if (!isSelect) {
    const last = blocks[blocks.length - 1];
    if (!last || last.length < 2) return { affectedRows: 0, insertId: 0 };
    const values = last[1].split("\t");
    return {
      affectedRows: Number(values[0]),
      insertId: Number(values[1]),
    };
  }

  const dataBlock = blocks[0];
  if (!dataBlock || dataBlock.length < 1) return { rows: [] };
  const header = dataBlock[0].split("\t");
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < dataBlock.length; i++) {
    const values = dataBlock[i].split("\t");
    const row: Record<string, unknown> = {};
    header.forEach((col, idx) => {
      row[col] = decodeBatchValue(values[idx] ?? "");
    });
    rows.push(row);
  }
  return { rows };
}

function resolveKey(p?: string): string | undefined {
  if (!p) return undefined;
  if (p.startsWith("~/")) return `${process.env.HOME}${p.slice(1)}`;
  return p;
}

export async function executeViaSsh(
  conn: ConnectionConfig & { ssh: NonNullable<ConnectionConfig["ssh"]> },
  sql: string,
  params: (string | number | boolean | null)[] = [],
): Promise<QueryResult> {
  const { script, isSelect } = buildScript(sql, params);

  const remoteHost = conn.ssh.remoteHost ?? "127.0.0.1";
  const remotePort = conn.ssh.remotePort ?? conn.port ?? 3306;

  const dbClient = [
    "mysql",
    `-h${remoteHost}`,
    `-P${remotePort}`,
    `-u${conn.user}`,
    `-p${conn.password}`,
    "--default-character-set=utf8mb4",
    "--batch",
    "--raw",
    "--column-names",
    conn.database,
  ].map(shellSingleQuote).join(" ");

  const sshArgs: string[] = [];
  if (conn.ssh.port) sshArgs.push("-p", String(conn.ssh.port));
  const keyPath = resolveKey(conn.ssh.privateKey);
  if (keyPath) sshArgs.push("-i", keyPath, "-o", "IdentitiesOnly=yes");
  sshArgs.push(`${conn.ssh.user}@${conn.ssh.host}`);
  sshArgs.push(dbClient);

  return new Promise((resolve, reject) => {
    const child = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (err) => reject(new Error(`ssh-mysql spawn error: ${err.message}`)));
    child.on("close", (code) => {
      const errOut = stderr.replace(/^mysql:.*using a password on the command line interface can be insecure\.?\s*/m, "").trim();
      if (code !== 0) {
        reject(new Error(`ssh-mysql exit ${code}: ${errOut || stdout}`));
        return;
      }
      if (/^ERROR\s+\d+/m.test(errOut)) {
        reject(new Error(`mysql error: ${errOut}`));
        return;
      }
      try {
        resolve(parseBatchOutput(stdout, isSelect));
      } catch (err) {
        reject(err as Error);
      }
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}
