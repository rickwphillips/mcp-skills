
# Write Record — DB Write Connector

Accept a write request (plain English or raw SQL), enforce safety rules, execute, log. Stop.

**Prefer the `db_write` MCP tool when the connection is already configured server-side** — it has the prod confirmation flow and audit log built in. Fall back to the shell pattern below for ad-hoc work.

**Always show `[DEV]` or `[PROD]` prominently. For prod, show `⚠️ PRODUCTION` before any diff or prompt.**

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

# Auth
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

**Connect using cached credentials (short queries via -e):**
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

**Large content or quoting issues: pipe SQL through stdin instead of -e.**
When a query contains file content, markdown, or any text with quotes/backslashes that makes `-e` quoting unreliable, pipe the SQL directly:

```bash
echo "SET NAMES utf8mb4; INSERT INTO ..." | ssh rickwphillips "mysql -h127.0.0.1 -u$PROD_PF_USER -p$PROD_PF_PASS $PROD_PF_DB --default-character-set=utf8mb4" 2>/dev/null
```

Or generate the SQL with Python and pipe it:
```bash
python3 -c "... print(sql)" | ssh rickwphillips "mysql -h127.0.0.1 -u\$USER -p\$PASS \$DB --default-character-set=utf8mb4" 2>/dev/null
```

**Error handling for `-e` failures:**
1. On exit code 1, **re-run without `2>/dev/null`** to see the actual MySQL error message.
2. If the error is a table/column name issue (e.g. `Table doesn't exist`), run `SHOW TABLES` and fix the name.
3. If the error is a quoting/syntax issue, switch to stdin piping immediately. Do not retry `-e` with different quoting.
4. Never present a bare "exit code 1" to the user without the error text.

---

## Schema Discovery

One preflight allowed if column names are needed:

```bash
$MYSQL ... -t -e "SHOW TABLES" 2>/dev/null
$MYSQL ... -t -e "DESCRIBE table_name" 2>/dev/null
```

**Common table name gotcha:** Portfolio blog posts are in `blog_posts`, not `posts`. Always run `SHOW TABLES` first if unsure.

---

## Confirmation Rules

| Scope | Env | Required |
|-------|-----|----------|
| Any write (any scope) | dev | None — execute immediately |
| Any write (any scope) | prod | Show full plan + before state once, type `CONFIRM`, then execute everything without further interruption |

**For multi-step prod operations:** read all current state upfront, show the complete plan in one diff, get one `CONFIRM`, then execute all steps to completion without pausing again.

---

## Batch INSERTs

Always use multi-row INSERT syntax — never loop single-row inserts:

```sql
INSERT INTO lists (player_id, name, created_at) VALUES
  (1, 'Deck A', '2025-01-01 00:00:00'),
  (1, 'Deck B', '2025-01-02 00:00:00'),
  (1, 'Deck C', '2025-01-03 00:00:00');
```

Build the full VALUES list first, then execute once. Same for `deck_cards`, `list_cards`, and any other multi-row insert.

---

## Transactions for Bulk Writes

Wrap all bulk operations (including batch INSERTs) in a transaction:

```sql
START TRANSACTION;
-- batch SQL here
COMMIT;
```

On any error, execute `ROLLBACK` immediately and report which statement failed. Single-record writes do not need transaction wrapping.

---

## Read-Before-Write on Prod

Before any prod write, SELECT the affected rows and display:

```
⚠️ PRODUCTION  [PROD] Update deck #2

  CURRENT STATE:
    id: 2  name: "Big Sweaty Balls"  colors: "BRG"

  SQL TO EXECUTE:
    UPDATE decks SET colors = 'BR' WHERE id = 2;

  PROJECTED CHANGE:
    colors: "BRG" → "BR"

Type CONFIRM to proceed, anything else to cancel.
```

---

## Execution Rules

1. Raw SQL → apply confirmation rules, then execute
2. Plain English → one `DESCRIBE` if needed, construct SQL, apply confirmation rules, execute
3. Bulk writes → wrap in transaction
4. Write audit log entry
5. Prune audit log
6. Output rollback
7. Stop

---

## Audit Log

**Location:** `~/.claude/projects/-Users-rick-FreddyRhetorickProjects/write-audit.jsonl`

Append after every successful write:

```json
{
  "ts": "2026-04-03T14:22:00Z",
  "env": "prod",
  "db": "commander_collector",
  "op": "UPDATE",
  "sql": "UPDATE decks SET colors = 'BR' WHERE id = 2",
  "before": { "id": 2, "colors": "BRG" },
  "rollback": "UPDATE decks SET colors = 'BRG' WHERE id = 2"
}
```

Self-prune to 30 days after every write:

```bash
python3 -c "
import json, os
from datetime import datetime, timezone, timedelta
cutoff = datetime.now(timezone.utc) - timedelta(days=30)
path = os.path.expanduser('~/.claude/projects/-Users-rick-FreddyRhetorickProjects/write-audit.jsonl')
try:
    with open(path) as f:
        lines = [l for l in f if l.strip()]
    kept = [l for l in lines if datetime.fromisoformat(json.loads(l)['ts'].replace('Z','+00:00')) > cutoff]
    with open(path, 'w') as f: f.writelines(kept)
except FileNotFoundError:
    pass
"
```

---

## After Every Successful Write

Always output the rollback SQL inline:

```
✅ Done. Rollback: UPDATE decks SET colors = 'BRG' WHERE id = 2
```
