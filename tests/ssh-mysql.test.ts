import { describe, it, expect } from "vitest";
import { buildScript, parseBatchOutput } from "../src/lib/ssh-mysql.js";

describe("buildScript: isSelect detection", () => {
  it("detects SELECT", () => {
    expect(buildScript("SELECT 1", []).isSelect).toBe(true);
  });

  it("detects SELECT with leading whitespace", () => {
    expect(buildScript("  \n  SELECT 1", []).isSelect).toBe(true);
  });

  it("detects SHOW / DESCRIBE / EXPLAIN as read-only", () => {
    expect(buildScript("SHOW TABLES", []).isSelect).toBe(true);
    expect(buildScript("DESCRIBE foo", []).isSelect).toBe(true);
    expect(buildScript("DESC foo", []).isSelect).toBe(true);
    expect(buildScript("EXPLAIN SELECT 1", []).isSelect).toBe(true);
  });

  it("treats INSERT / UPDATE / DELETE as write", () => {
    expect(buildScript("INSERT INTO foo VALUES (1)", []).isSelect).toBe(false);
    expect(buildScript("UPDATE foo SET x=1", []).isSelect).toBe(false);
    expect(buildScript("DELETE FROM foo", []).isSelect).toBe(false);
  });
});

describe("buildScript: param binding", () => {
  it("emits NULL for null params", () => {
    const { script } = buildScript("SELECT ?", [null]);
    expect(script).toContain("SET @p0 = NULL;");
  });

  it("emits numeric literals for numbers", () => {
    const { script } = buildScript("SELECT ?", [42]);
    expect(script).toContain("SET @p0 = 42;");
  });

  it("converts booleans to 0/1", () => {
    expect(buildScript("SELECT ?", [true]).script).toContain("SET @p0 = 1;");
    expect(buildScript("SELECT ?", [false]).script).toContain("SET @p0 = 0;");
  });

  it("base64-encodes string params via FROM_BASE64", () => {
    const { script } = buildScript("SELECT ?", ["hello"]);
    const expected = Buffer.from("hello", "utf8").toString("base64");
    expect(script).toContain(`SET @p0 = CONVERT(FROM_BASE64('${expected}') USING utf8mb4);`);
  });

  it("base64-encodes strings that contain dangerous shell/SQL chars", () => {
    const dangerous = "'; DROP TABLE users; --";
    const { script } = buildScript("SELECT ?", [dangerous]);
    const expected = Buffer.from(dangerous, "utf8").toString("base64");
    expect(script).toContain(`SET @p0 = CONVERT(FROM_BASE64('${expected}') USING utf8mb4);`);
    // The dangerous literal must NEVER appear unescaped in the script
    expect(script.includes(dangerous)).toBe(false);
  });

  it("emits PREPARE/EXECUTE/DEALLOCATE for queries with params", () => {
    const { script } = buildScript("SELECT * FROM x WHERE y = ?", ["v"]);
    expect(script).toContain("PREPARE stmt FROM @sql_stmt;");
    expect(script).toContain("EXECUTE stmt USING @p0;");
    expect(script).toContain("DEALLOCATE PREPARE stmt;");
  });

  it("appends ROW_COUNT/LAST_INSERT_ID after PREPARE/EXECUTE for writes", () => {
    const { script } = buildScript("INSERT INTO x VALUES (?)", ["v"]);
    expect(script).toContain("EXECUTE stmt USING @p0;");
    expect(script).toContain("SELECT ROW_COUNT() AS affected_rows, LAST_INSERT_ID() AS insert_id;");
  });

  it("does NOT append ROW_COUNT after a SELECT with params", () => {
    const { script } = buildScript("SELECT * FROM x WHERE y = ?", ["v"]);
    expect(script).not.toContain("ROW_COUNT()");
  });

  it("appends ROW_COUNT/LAST_INSERT_ID for writes without params (no PREPARE path)", () => {
    const { script } = buildScript("DELETE FROM x WHERE id = 5", []);
    expect(script).toContain("DELETE FROM x WHERE id = 5;");
    expect(script).toContain("SELECT ROW_COUNT() AS affected_rows, LAST_INSERT_ID() AS insert_id;");
  });

  it("handles multiple params in USING clause order", () => {
    const { script } = buildScript("SELECT ?, ?, ?", ["a", 1, true]);
    expect(script).toContain("EXECUTE stmt USING @p0, @p1, @p2;");
  });
});

describe("parseBatchOutput: SELECT results", () => {
  it("parses a single-row result", () => {
    const out = "id\tslug\n5\tfoo\n";
    const result = parseBatchOutput(out, true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows![0]).toEqual({ id: "5", slug: "foo" });
  });

  it("parses multi-row results", () => {
    const out = "id\tname\n1\talice\n2\tbob\n3\tcarol\n";
    const result = parseBatchOutput(out, true);
    expect(result.rows).toHaveLength(3);
    expect(result.rows![2]).toEqual({ id: "3", name: "carol" });
  });

  it("returns empty rows for an empty selection", () => {
    const out = "id\tname\n";
    const result = parseBatchOutput(out, true);
    expect(result.rows).toEqual([]);
  });

  it("returns empty rows for completely empty output", () => {
    const result = parseBatchOutput("", true);
    expect(result.rows).toEqual([]);
  });

  it("decodes NULL as JS null", () => {
    const out = "id\tname\n1\tNULL\n";
    const result = parseBatchOutput(out, true);
    expect(result.rows![0].name).toBeNull();
  });

  it("decodes mysql --batch escape sequences", () => {
    // mysql escapes embedded tab as \\t, newline as \\n, etc.
    const out = "raw\nhello\\tworld\\nfoo\\\\bar\n";
    const result = parseBatchOutput(out, true);
    expect(result.rows![0].raw).toBe("hello\tworld\nfoo\\bar");
  });
});

describe("parseBatchOutput: write results", () => {
  it("parses affected_rows and insert_id from the trailing block", () => {
    const out = "affected_rows\tinsert_id\n3\t42\n";
    const result = parseBatchOutput(out, false);
    expect(result.affectedRows).toBe(3);
    expect(result.insertId).toBe(42);
  });

  it("returns zeros for empty write output", () => {
    const result = parseBatchOutput("", false);
    expect(result.affectedRows).toBe(0);
    expect(result.insertId).toBe(0);
  });

  it("handles PREPARE/EXECUTE multi-block output (uses last block)", () => {
    // Multi-statement script emits blank-line-separated result sets;
    // for writes the last one carries ROW_COUNT/LAST_INSERT_ID.
    const out = "header\nvalue\n\naffected_rows\tinsert_id\n7\t99\n";
    const result = parseBatchOutput(out, false);
    expect(result.affectedRows).toBe(7);
    expect(result.insertId).toBe(99);
  });
});
