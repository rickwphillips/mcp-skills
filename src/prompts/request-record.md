
# Request Record — DB Read Connector

Accept a request (plain English or raw SQL), execute it, return results. Stop.

**Prefer the `db_read` MCP tool when the connection is already configured server-side** — it handles parameter binding and returns rows as JSON. Fall back to the shell pattern below for ad-hoc local/SSH queries.

Always prefix responses with `[DEV]` or `[PROD]`.

---

## MySQL Binary

```bash
MYSQL=$(which mysql 2>/dev/null || echo /opt/homebrew/bin/mysql)
```

Use `$MYSQL` in place of `mysql` in all commands below.

---

## Dev Connections (local — no lookup needed)

```bash
# Commander Collector
$MYSQL -h 127.0.0.1 -u commander_dev -pdevpassword commander_collector -t -e "SQL" 2>/dev/null

# Auth (users, sessions)
$MYSQL -h 127.0.0.1 -u commander_dev -pdevpassword rickwphillips_auth -t -e "SQL" 2>/dev/null

# Portfolio
$MYSQL -h 127.0.0.1 -u commander_dev -pdevpassword rickwphi_app_portfolio -t -e "SQL" 2>/dev/null

# Grandkid Games
$MYSQL -h 127.0.0.1 -u app_user -pdevpassword grandkid_arcade -t -e "SQL" 2>/dev/null
```

---

## Prod Connections (SSH — known path, no searching)

Never use inline `$()` subshells inside SSH commands. Fetch all prod credentials in a single SSH call once per session and cache them in memory. On subsequent prod queries reuse the cached values — do not SSH again.

**Fetch all prod credentials at once (once per session):**
```bash
PROD_CREDS=$(ssh rickwphillips '/usr/local/bin/php -r "require \"/home2/rickwphi/auth_secrets.php\"; echo DB_USER.\"|\".DB_PASS.\"|\".DB_NAME.\"|\".AUTH_DB_USER.\"|\".AUTH_DB_PASS.\"|\".AUTH_DB_NAME.\"|\".PORTFOLIO_DB_USER.\"|\".PORTFOLIO_DB_PASS.\"|\".PORTFOLIO_DB_NAME.\"|\".GRANDKID_DB_USER.\"|\".GRANDKID_DB_PASS.\"|\".GRANDKID_DB_NAME;"')
IFS='|' read -r PROD_CC_USER PROD_CC_PASS PROD_CC_DB \
                PROD_AU_USER PROD_AU_PASS PROD_AU_DB \
                PROD_PF_USER PROD_PF_PASS PROD_PF_DB \
                PROD_GK_USER PROD_GK_PASS PROD_GK_DB <<< "$PROD_CREDS"
```

**Connect using cached credentials:**
```bash
# Commander Collector
ssh rickwphillips "mysql -h127.0.0.1 -u$PROD_CC_USER -p$PROD_CC_PASS $PROD_CC_DB -t -e \"SQL\" 2>/dev/null"

# Auth
ssh rickwphillips "mysql -h127.0.0.1 -u$PROD_AU_USER -p$PROD_AU_PASS $PROD_AU_DB -t -e \"SQL\" 2>/dev/null"

# Portfolio
ssh rickwphillips "mysql -h127.0.0.1 -u$PROD_PF_USER -p$PROD_PF_PASS $PROD_PF_DB -t -e \"SQL\" 2>/dev/null"

# Grandkid Games
ssh rickwphillips "mysql -h127.0.0.1 -u$PROD_GK_USER -p$PROD_GK_PASS $PROD_GK_DB -t -e \"SQL\" 2>/dev/null"
```

---

## Schema Discovery

If the request is in plain English and column names are needed, run one preflight:

```bash
$MYSQL ... -t -e "SHOW TABLES" 2>/dev/null
$MYSQL ... -t -e "DESCRIBE table_name" 2>/dev/null
```

One preflight allowed — execute the data query immediately after. Do not run more than one.

**Common table name gotcha:** Portfolio blog posts are in `blog_posts`, not `posts`. Always run `SHOW TABLES` first if unsure.

**Error handling for `-e` failures:**
1. On exit code 1, **re-run without `2>/dev/null`** to see the actual MySQL error message.
2. If the error is a table/column name issue (e.g. `Table doesn't exist`), run `SHOW TABLES` and fix the name.
3. If the error is a quoting/syntax issue, switch to stdin piping:
```bash
echo "SELECT ..." | ssh rickwphillips "mysql -h127.0.0.1 -u$PROD_PF_USER -p$PROD_PF_PASS $PROD_PF_DB -t --default-character-set=utf8mb4" 2>/dev/null
```
4. Never present a bare "exit code 1" to the user without the error text.

---

## Execution Rules

1. Raw SQL provided → execute directly
2. Plain English → one `DESCRIBE` if needed, then one query
3. Return results in standard format
4. Stop — no follow-up queries, no verification, no commentary

---

## Standard Output Format

```
[ENV] <description> — N rows
+-------+-------+-------+
| col1  | col2  | col3  |
+-------+-------+-------+
| val   | val   | val   |
+-------+-------+-------+
```

- Zero rows: `[ENV] <description> — 0 rows`
- Error: `[ENV] ERROR — <mysql error text>`
