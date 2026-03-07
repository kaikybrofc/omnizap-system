# Production DB Evolution Runbook (2026 Q1)

Scope: phased schema hardening and evolution for MySQL/InnoDB with zero destructive changes in early phases.

Target files:

- `database/migrations/20260307_d0_hardening_up.sql`
- `database/migrations/20260307_d0_hardening_down.sql`
- `database/migrations/20260314_d7_canonical_sender_up.sql`
- `database/migrations/20260314_d7_canonical_sender_down.sql`
- `database/migrations/20260406_d30_security_analytics_up.sql`
- `database/migrations/20260406_d30_security_analytics_down.sql`

## 1) Preconditions

1. Confirm engine/version:

```sql
SELECT VERSION() AS mysql_version;
```

Recommended: MySQL 8.0.16+ (for CHECK constraints and `DROP CHECK`).

2. Confirm event scheduler policy:

```sql
SHOW VARIABLES LIKE 'event_scheduler';
```

If your policy allows DB-driven retention/rollup jobs, set `event_scheduler=ON` at server level.

3. Backup before each phase:

- Logical backup of target schema.
- Point-in-time recovery configured (binlog/backup chain).

4. Maintenance posture:

- Execute during low write pressure windows.
- Keep app online for D0.
- D+7 and D+30 can run online, but monitor write latency.

## 2) Execution commands

Use mysql CLI (recommended):

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/<file>.sql
```

## 3) Phase D0 - Non-breaking hardening

### Apply

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d0_hardening_up.sql
```

### Validate

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260307_d0_hardening';

SHOW INDEX FROM messages;
SHOW INDEX FROM domain_event_outbox;
SHOW INDEX FROM email_outbox;
SHOW INDEX FROM sticker_worker_task_queue;
SHOW INDEX FROM sticker_asset_reprocess_queue;
```

### Rollback

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260307_d0_hardening_down.sql
```

## 4) Phase D+7 - Canonical sender migration

### Apply

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260314_d7_canonical_sender_up.sql
```

### Validate

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260314_d7_canonical_sender';

SHOW COLUMNS FROM messages LIKE 'canonical_sender_id';
SHOW INDEX FROM messages;

SELECT COUNT(*) AS null_canonical_sender
  FROM messages
 WHERE canonical_sender_id IS NULL;
```

### App rollout checkpoint

After D+7, deploy app/query changes that prefer `messages.canonical_sender_id` in ranking/analytics paths.

### Rollback

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260314_d7_canonical_sender_down.sql
```

## 5) Phase D+30 - Security + analytics + retention

### Apply

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260406_d30_security_analytics_up.sql
```

### Validate

```sql
SELECT migration_key, phase, status, updated_at
  FROM schema_change_log
 WHERE migration_key = '20260406_d30_security_analytics';

SHOW COLUMNS FROM web_google_session LIKE 'session_token_hash';
SHOW INDEX FROM web_google_session;

SELECT COUNT(*) AS null_session_hash
  FROM web_google_session
 WHERE session_token_hash IS NULL;

SELECT COUNT(*) AS message_activity_daily_rows
  FROM message_activity_daily;

SHOW EVENTS
 WHERE Db = DATABASE()
   AND Name IN (
     'ev_rollup_message_activity_daily',
     'ev_purge_baileys_event_journal',
     'ev_purge_message_analysis_event',
     'ev_purge_web_visit_event',
     'ev_purge_sticker_pack_interaction_event'
   );
```

### Constraint post-checks

If any CHECK was skipped, the migration script prints `SKIPPED` messages. Fix violating data, then re-run D+30 `up`.

### Rollback

```bash
mysql -u"$DB_USER" -p"$DB_PASSWORD" -h"$DB_HOST" "$DB_NAME" < database/migrations/20260406_d30_security_analytics_down.sql
```

## 6) Monitoring checklist (all phases)

Track for 30-60 minutes after each phase:

- `Threads_running`, InnoDB row lock waits, query latency p95/p99.
- Queue depth and stuck workers (`status='processing' AND locked_at` stale).
- Slow query log spikes on `messages` and queue tables.

Recommended quick checks:

```sql
SELECT status, COUNT(*) FROM domain_event_outbox GROUP BY status;
SELECT status, COUNT(*) FROM email_outbox GROUP BY status;
SELECT status, COUNT(*) FROM sticker_worker_task_queue GROUP BY status;
```

## 7) Roll-forward policy

If rollback is not strictly required and data is healthy:

1. Keep phase applied.
2. Patch app queries to use new indexes/columns.
3. Re-run validation queries.
4. Register postmortem notes in `schema_change_log.notes`.

## 8) Safety notes

- DDL in MySQL auto-commits. Rollback scripts are logical rollbacks, not transaction undo.
- Do not run `db:init` as a migration mechanism in production, because it replays consolidated schema and can mask drift.
- Keep migration files immutable after production execution. If changes are needed, create new migration files.
