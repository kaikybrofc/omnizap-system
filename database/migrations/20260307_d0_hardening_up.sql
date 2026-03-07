-- D0 (2026-03-07) - Non-breaking hardening
-- Scope: indexes for queue reclaim/perf, remove redundant indexes, migration audit table
-- Run with mysql client:
--   mysql -u$DB_USER -p$DB_PASSWORD -h$DB_HOST $DB_NAME < database/migrations/20260307_d0_hardening_up.sql

SET @migration_key := '20260307_d0_hardening';

CREATE TABLE IF NOT EXISTS schema_change_log (
  migration_key VARCHAR(128) NOT NULL,
  phase VARCHAR(32) NOT NULL,
  status ENUM('applied', 'rolled_back') NOT NULL DEFAULT 'applied',
  notes VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (migration_key),
  KEY idx_schema_change_log_phase_status (phase, status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS __ensure_index;
DROP PROCEDURE IF EXISTS __drop_index_if_exists;

DELIMITER $$
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

CREATE PROCEDURE __drop_index_if_exists(IN p_table_name VARCHAR(64), IN p_index_name VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = p_table_name
       AND index_name = p_index_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` DROP INDEX `', p_index_name, '`');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- Performance indexes (non-breaking)
CALL __ensure_index('messages', 'idx_messages_sender_timestamp', 'CREATE INDEX idx_messages_sender_timestamp ON messages (sender_id, timestamp)');
CALL __ensure_index('messages', 'idx_messages_chat_sender_timestamp', 'CREATE INDEX idx_messages_chat_sender_timestamp ON messages (chat_id, sender_id, timestamp)');

CALL __ensure_index('domain_event_outbox', 'idx_domain_event_outbox_status_locked', 'CREATE INDEX idx_domain_event_outbox_status_locked ON domain_event_outbox (status, locked_at)');
CALL __ensure_index('email_outbox', 'idx_email_outbox_status_locked', 'CREATE INDEX idx_email_outbox_status_locked ON email_outbox (status, locked_at)');
CALL __ensure_index('sticker_worker_task_queue', 'idx_sticker_worker_task_queue_status_locked', 'CREATE INDEX idx_sticker_worker_task_queue_status_locked ON sticker_worker_task_queue (status, locked_at)');
CALL __ensure_index('sticker_asset_reprocess_queue', 'idx_sticker_asset_reprocess_queue_status_locked', 'CREATE INDEX idx_sticker_asset_reprocess_queue_status_locked ON sticker_asset_reprocess_queue (status, locked_at)');

-- Remove redundant indexes (safe)
CALL __drop_index_if_exists('sticker_pack_item', 'idx_sticker_pack_item_pack_position');
CALL __drop_index_if_exists('domain_event_outbox_dlq', 'idx_domain_event_outbox_dlq_outbox_event_id');
CALL __drop_index_if_exists('sticker_worker_task_dlq', 'idx_sticker_worker_task_dlq_task_id');

INSERT INTO schema_change_log (migration_key, phase, status, notes)
VALUES (@migration_key, 'D0', 'applied', 'Indexes hardening + redundant index cleanup')
ON DUPLICATE KEY UPDATE
  phase = VALUES(phase),
  status = 'applied',
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

DROP PROCEDURE IF EXISTS __ensure_index;
DROP PROCEDURE IF EXISTS __drop_index_if_exists;
