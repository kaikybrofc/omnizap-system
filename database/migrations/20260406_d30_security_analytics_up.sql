-- D+30 (2026-04-06) - Larger migration
-- Scope: auth session hardening, daily aggregate table, data-retention events, consistency checks

SET @migration_key := '20260406_d30_security_analytics';

DROP PROCEDURE IF EXISTS __ensure_column;
DROP PROCEDURE IF EXISTS __ensure_index;
DROP PROCEDURE IF EXISTS __exec_when;

DELIMITER $$
CREATE PROCEDURE __ensure_column(IN p_table_name VARCHAR(64), IN p_column_name VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = p_table_name
       AND column_name = p_column_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE __ensure_index(IN p_table_name VARCHAR(64), IN p_index_name VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = p_table_name
       AND index_name = p_index_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE __exec_when(IN p_condition BOOLEAN, IN p_ddl TEXT, IN p_skip_message VARCHAR(255))
BEGIN
  IF p_condition THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  ELSE
    SELECT CONCAT('SKIPPED: ', p_skip_message) AS info_message;
  END IF;
END$$
DELIMITER ;

-- 1) Session token hardening (backward-compatible)
CALL __ensure_column('web_google_session', 'session_token_hash', 'ALTER TABLE web_google_session ADD COLUMN session_token_hash BINARY(32) NULL AFTER session_token');

UPDATE web_google_session
   SET session_token_hash = UNHEX(SHA2(session_token, 256))
 WHERE session_token_hash IS NULL
   AND session_token IS NOT NULL;

CALL __ensure_index('web_google_session', 'uq_web_google_session_token_hash', 'CREATE UNIQUE INDEX uq_web_google_session_token_hash ON web_google_session (session_token_hash)');

-- 2) Daily aggregate table for ranking/analytics
CREATE TABLE IF NOT EXISTS message_activity_daily (
  day_ref_date DATE NOT NULL,
  chat_id VARCHAR(255) NOT NULL,
  canonical_sender_id VARCHAR(255) NOT NULL,
  total_messages INT UNSIGNED NOT NULL DEFAULT 0,
  first_message_at DATETIME DEFAULT NULL,
  last_message_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (day_ref_date, chat_id, canonical_sender_id),
  KEY idx_message_activity_daily_sender_day (canonical_sender_id, day_ref_date),
  KEY idx_message_activity_daily_chat_day (chat_id, day_ref_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Initial rebuild for last 90 days (adjust as needed)
DELETE FROM message_activity_daily
 WHERE day_ref_date >= CURRENT_DATE - INTERVAL 90 DAY;

INSERT INTO message_activity_daily (
  day_ref_date,
  chat_id,
  canonical_sender_id,
  total_messages,
  first_message_at,
  last_message_at
)
SELECT
  DATE(m.timestamp) AS day_ref_date,
  m.chat_id,
  COALESCE(m.canonical_sender_id, lm.jid, m.sender_id) AS canonical_sender_id,
  COUNT(*) AS total_messages,
  MIN(m.timestamp) AS first_message_at,
  MAX(m.timestamp) AS last_message_at
FROM messages m
LEFT JOIN lid_map lm
  ON lm.lid = m.sender_id
 AND lm.jid IS NOT NULL
WHERE m.timestamp >= CURRENT_DATE - INTERVAL 90 DAY
  AND m.timestamp IS NOT NULL
  AND m.chat_id IS NOT NULL
  AND COALESCE(m.canonical_sender_id, lm.jid, m.sender_id) IS NOT NULL
GROUP BY DATE(m.timestamp), m.chat_id, COALESCE(m.canonical_sender_id, lm.jid, m.sender_id)
ON DUPLICATE KEY UPDATE
  total_messages = VALUES(total_messages),
  first_message_at = VALUES(first_message_at),
  last_message_at = VALUES(last_message_at),
  updated_at = CURRENT_TIMESTAMP;

-- 3) Consistency checks (applies only when data is already clean)
SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'feature_flag'
     AND constraint_name = 'chk_feature_flag_rollout_percent'
);
SET @bad := (SELECT COUNT(*) FROM feature_flag WHERE rollout_percent < 0 OR rollout_percent > 100);
CALL __exec_when(@exists = 0 AND @bad = 0,
  'ALTER TABLE feature_flag ADD CONSTRAINT chk_feature_flag_rollout_percent CHECK (rollout_percent BETWEEN 0 AND 100)',
  'feature_flag rollout check not applied');

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'domain_event_outbox'
     AND constraint_name = 'chk_domain_event_outbox_attempts'
);
SET @bad := (SELECT COUNT(*) FROM domain_event_outbox WHERE attempts > max_attempts);
CALL __exec_when(@exists = 0 AND @bad = 0,
  'ALTER TABLE domain_event_outbox ADD CONSTRAINT chk_domain_event_outbox_attempts CHECK (attempts <= max_attempts)',
  'domain_event_outbox attempts check not applied');

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'email_outbox'
     AND constraint_name = 'chk_email_outbox_attempts'
);
SET @bad := (SELECT COUNT(*) FROM email_outbox WHERE attempts > max_attempts);
CALL __exec_when(@exists = 0 AND @bad = 0,
  'ALTER TABLE email_outbox ADD CONSTRAINT chk_email_outbox_attempts CHECK (attempts <= max_attempts)',
  'email_outbox attempts check not applied');

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'sticker_worker_task_queue'
     AND constraint_name = 'chk_sticker_worker_task_queue_attempts'
);
SET @bad := (SELECT COUNT(*) FROM sticker_worker_task_queue WHERE attempts > max_attempts);
CALL __exec_when(@exists = 0 AND @bad = 0,
  'ALTER TABLE sticker_worker_task_queue ADD CONSTRAINT chk_sticker_worker_task_queue_attempts CHECK (attempts <= max_attempts)',
  'sticker_worker_task_queue attempts check not applied');

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'sticker_asset_reprocess_queue'
     AND constraint_name = 'chk_sticker_asset_reprocess_queue_attempts'
);
SET @bad := (SELECT COUNT(*) FROM sticker_asset_reprocess_queue WHERE attempts > max_attempts);
CALL __exec_when(@exists = 0 AND @bad = 0,
  'ALTER TABLE sticker_asset_reprocess_queue ADD CONSTRAINT chk_sticker_asset_reprocess_queue_attempts CHECK (attempts <= max_attempts)',
  'sticker_asset_reprocess_queue attempts check not applied');

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'rpg_karma_vote_history'
     AND constraint_name = 'chk_rpg_karma_vote_value'
);
SET @bad := (SELECT COUNT(*) FROM rpg_karma_vote_history WHERE vote_value NOT IN (-1, 1));
CALL __exec_when(@exists = 0 AND @bad = 0,
  'ALTER TABLE rpg_karma_vote_history ADD CONSTRAINT chk_rpg_karma_vote_value CHECK (vote_value IN (-1, 1))',
  'rpg_karma_vote_history vote check not applied');

SET @exists := (
  SELECT COUNT(*)
    FROM information_schema.table_constraints
   WHERE table_schema = DATABASE()
     AND table_name = 'rpg_social_link'
     AND constraint_name = 'chk_rpg_social_link_distinct_users'
);
SET @bad := (SELECT COUNT(*) FROM rpg_social_link WHERE user_a_jid = user_b_jid);
SET @is_mariadb := (SELECT IF(VERSION() LIKE '%MariaDB%', 1, 0));
SET @has_fk_referential_actions := (
  SELECT COUNT(*)
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_schema = kcu.constraint_schema
     AND rc.table_name = kcu.table_name
     AND rc.constraint_name = kcu.constraint_name
   WHERE kcu.table_schema = DATABASE()
     AND kcu.table_name = 'rpg_social_link'
     AND kcu.column_name IN ('user_a_jid', 'user_b_jid')
     AND (
       rc.update_rule NOT IN ('RESTRICT', 'NO ACTION')
       OR rc.delete_rule NOT IN ('RESTRICT', 'NO ACTION')
     )
);
CALL __exec_when(@exists = 0 AND @bad = 0 AND @is_mariadb = 0 AND @has_fk_referential_actions = 0,
  'ALTER TABLE rpg_social_link ADD CONSTRAINT chk_rpg_social_link_distinct_users CHECK (user_a_jid <> user_b_jid)',
  'rpg_social_link distinct user check not applied (MariaDB/FK actions compatibility or dirty data)');

-- 4) Automatic rollup and retention events
-- Note: requires EVENT_SCHEDULER=ON at server level.

CREATE EVENT IF NOT EXISTS ev_rollup_message_activity_daily
ON SCHEDULE EVERY 1 DAY
STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 5 MINUTE)
DO
  INSERT INTO message_activity_daily (
    day_ref_date,
    chat_id,
    canonical_sender_id,
    total_messages,
    first_message_at,
    last_message_at
  )
  SELECT
    DATE(m.timestamp) AS day_ref_date,
    m.chat_id,
    COALESCE(m.canonical_sender_id, lm.jid, m.sender_id) AS canonical_sender_id,
    COUNT(*) AS total_messages,
    MIN(m.timestamp) AS first_message_at,
    MAX(m.timestamp) AS last_message_at
  FROM messages m
  LEFT JOIN lid_map lm
    ON lm.lid = m.sender_id
   AND lm.jid IS NOT NULL
  WHERE m.timestamp >= CURRENT_DATE - INTERVAL 2 DAY
    AND m.timestamp < CURRENT_DATE + INTERVAL 1 DAY
    AND m.timestamp IS NOT NULL
    AND m.chat_id IS NOT NULL
    AND COALESCE(m.canonical_sender_id, lm.jid, m.sender_id) IS NOT NULL
  GROUP BY DATE(m.timestamp), m.chat_id, COALESCE(m.canonical_sender_id, lm.jid, m.sender_id)
  ON DUPLICATE KEY UPDATE
    total_messages = VALUES(total_messages),
    first_message_at = VALUES(first_message_at),
    last_message_at = VALUES(last_message_at),
    updated_at = CURRENT_TIMESTAMP;

CREATE EVENT IF NOT EXISTS ev_purge_baileys_event_journal
ON SCHEDULE EVERY 1 DAY
DO
  DELETE FROM baileys_event_journal
   WHERE created_at < NOW() - INTERVAL 30 DAY
   LIMIT 50000;

CREATE EVENT IF NOT EXISTS ev_purge_message_analysis_event
ON SCHEDULE EVERY 1 DAY
DO
  DELETE FROM message_analysis_event
   WHERE created_at < NOW() - INTERVAL 90 DAY
   LIMIT 50000;

CREATE EVENT IF NOT EXISTS ev_purge_web_visit_event
ON SCHEDULE EVERY 1 DAY
DO
  DELETE FROM web_visit_event
   WHERE created_at < NOW() - INTERVAL 120 DAY
   LIMIT 100000;

CREATE EVENT IF NOT EXISTS ev_purge_sticker_pack_interaction_event
ON SCHEDULE EVERY 1 DAY
DO
  DELETE FROM sticker_pack_interaction_event
   WHERE created_at < NOW() - INTERVAL 180 DAY
   LIMIT 100000;

INSERT INTO schema_change_log (migration_key, phase, status, notes)
VALUES (@migration_key, 'D+30', 'applied', 'session hash + daily aggregate + checks + retention events')
ON DUPLICATE KEY UPDATE
  phase = VALUES(phase),
  status = 'applied',
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

DROP PROCEDURE IF EXISTS __ensure_column;
DROP PROCEDURE IF EXISTS __ensure_index;
DROP PROCEDURE IF EXISTS __exec_when;
