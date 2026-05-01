
# cc-status — Commander Collector Version & Changelog Status

Fetch and display the current version and recent changelog entries from both dev and prod, then compare against `package.json`.

## Inputs

- `scope` — `latest` (default) or `all`

## Steps

1. **Read local package version** from `commander-collector/apps/core/package.json` — the `"version"` field.

2. **Query dev DB** (connection `commander_dev`) using `db_read`:

   Latest release + changes:
   ```sql
   SELECT r.version, r.date, r.title FROM changelog_releases r ORDER BY r.sort_order DESC LIMIT 1;
   SELECT c.type, c.text FROM changelog_changes c JOIN changelog_releases r ON c.release_id = r.id ORDER BY r.sort_order DESC, c.sort_order ASC LIMIT 20;
   ```

   If `scope` is `all`, fetch last 3 releases (LIMIT 3 / LIMIT 60).

3. **Query prod DB** (connection `commander_prod`) using `db_read` — same SQL.

4. **Display results:**

   ```
   ## Commander Collector Status

   package.json:  v4.1.1

   ### Dev DB
   Latest release: v4.1.0 — 2026-03-31 — "Double-Faced Cards & Flexible Deck Saving"
   Changes:
     [added]    Double-faced card support...
     [improved] Stale DFC cache entries...

   ### Production DB
   Latest release: v4.1.0 — 2026-03-31 — "..."
   Changes:
     ...

   ### Gap
   package.json is ahead of both DBs by X versions — changelog entries needed.
   ```

5. **Highlight any gap** between `package.json` and the latest `changelog_releases` version in either env. If dev and prod differ from each other, call that out too.
