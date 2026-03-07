-- D+7 (2026-03-14) - Small migration
-- Scope: canonical sender column for high-volume ranking/analytics queries

SET @migration_key := '20260314_d7_canonical_sender';

DROP PROCEDURE IF EXISTS __ensure_column;
DROP PROCEDURE IF EXISTS __drop_column_if_exists;
DROP PROCEDURE IF EXISTS __ensure_index;
DROP PROCEDURE IF EXISTS __backfill_messages_canonical_sender;

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

CREATE PROCEDURE __drop_column_if_exists(IN p_table_name VARCHAR(64), IN p_column_name VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = p_table_name
       AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` DROP COLUMN `', p_column_name, '`');
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

CREATE PROCEDURE __backfill_messages_canonical_sender(IN p_batch_size BIGINT UNSIGNED)
BEGIN
  DECLARE v_min BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_max BIGINT UNSIGNED DEFAULT 0;
  DECLARE v_cursor BIGINT UNSIGNED DEFAULT 0;

  SELECT COALESCE(MIN(id), 0), COALESCE(MAX(id), 0)
    INTO v_min, v_max
    FROM messages
   WHERE canonical_sender_id IS NULL;

  SET v_cursor = v_min;

  WHILE v_cursor > 0 AND v_cursor <= v_max DO
    UPDATE messages m
    LEFT JOIN lid_map lm
      ON lm.lid = m.sender_id
     AND lm.jid IS NOT NULL
       SET m.canonical_sender_id = COALESCE(lm.jid, m.sender_id)
     WHERE m.id BETWEEN v_cursor AND (v_cursor + p_batch_size - 1)
       AND m.canonical_sender_id IS NULL;

    SET v_cursor = v_cursor + p_batch_size;
  END WHILE;
END$$
DELIMITER ;

CALL __ensure_column('messages', 'canonical_sender_id', 'ALTER TABLE messages ADD COLUMN canonical_sender_id VARCHAR(255) NULL AFTER sender_id');

CALL __ensure_index('messages', 'idx_messages_canonical_sender_timestamp', 'CREATE INDEX idx_messages_canonical_sender_timestamp ON messages (canonical_sender_id, timestamp)');
CALL __ensure_index('messages', 'idx_messages_chat_canonical_sender_timestamp', 'CREATE INDEX idx_messages_chat_canonical_sender_timestamp ON messages (chat_id, canonical_sender_id, timestamp)');

-- Backfill in chunks (adjust batch size according to table size / write pressure)
CALL __backfill_messages_canonical_sender(50000);

-- Safety pass for rows inserted during chunk loop
UPDATE messages m
LEFT JOIN lid_map lm
  ON lm.lid = m.sender_id
 AND lm.jid IS NOT NULL
   SET m.canonical_sender_id = COALESCE(lm.jid, m.sender_id)
 WHERE m.canonical_sender_id IS NULL;

INSERT INTO schema_change_log (migration_key, phase, status, notes)
VALUES (@migration_key, 'D+7', 'applied', 'messages.canonical_sender_id + backfill + indexes')
ON DUPLICATE KEY UPDATE
  phase = VALUES(phase),
  status = 'applied',
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

DROP PROCEDURE IF EXISTS __ensure_column;
DROP PROCEDURE IF EXISTS __drop_column_if_exists;
DROP PROCEDURE IF EXISTS __ensure_index;
DROP PROCEDURE IF EXISTS __backfill_messages_canonical_sender;
