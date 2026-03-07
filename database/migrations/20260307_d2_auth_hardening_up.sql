-- D2 (2026-03-07) - Auth hardening follow-up
-- Scope: distributed login throttle + hashed sensitive metadata for password recovery

SET @migration_key := '20260307_d2_auth_hardening';

DROP PROCEDURE IF EXISTS __ensure_column;
DROP PROCEDURE IF EXISTS __ensure_index;

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
DELIMITER ;

CREATE TABLE IF NOT EXISTS web_user_password_login_throttle (
  identity_hash BINARY(32) NOT NULL,
  failed_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMP NULL DEFAULT NULL,
  locked_until TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (identity_hash),
  KEY idx_web_user_password_login_throttle_locked_until (locked_until),
  KEY idx_web_user_password_login_throttle_failed (failed_attempts, last_failed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL __ensure_column(
  'web_user_password_recovery_code',
  'email_hash',
  'ALTER TABLE web_user_password_recovery_code ADD COLUMN email_hash BINARY(32) NULL AFTER email'
);

CALL __ensure_column(
  'web_user_password_recovery_code',
  'requested_ip_hash',
  'ALTER TABLE web_user_password_recovery_code ADD COLUMN requested_ip_hash BINARY(32) NULL AFTER requested_ip'
);

CALL __ensure_column(
  'web_user_password_recovery_code',
  'requested_user_agent_hash',
  'ALTER TABLE web_user_password_recovery_code ADD COLUMN requested_user_agent_hash BINARY(32) NULL AFTER requested_user_agent'
);

CALL __ensure_index(
  'web_user_password_recovery_code',
  'idx_web_user_password_recovery_email_hash_created',
  'CREATE INDEX idx_web_user_password_recovery_email_hash_created ON web_user_password_recovery_code (email_hash, created_at)'
);

CALL __ensure_index(
  'web_user_password_login_throttle',
  'idx_web_user_password_login_throttle_locked_until',
  'CREATE INDEX idx_web_user_password_login_throttle_locked_until ON web_user_password_login_throttle (locked_until)'
);

CALL __ensure_index(
  'web_user_password_login_throttle',
  'idx_web_user_password_login_throttle_failed',
  'CREATE INDEX idx_web_user_password_login_throttle_failed ON web_user_password_login_throttle (failed_attempts, last_failed_at)'
);

DROP PROCEDURE IF EXISTS __ensure_column;
DROP PROCEDURE IF EXISTS __ensure_index;

INSERT INTO schema_change_log (migration_key, phase, status, notes)
VALUES (@migration_key, 'D2', 'applied', 'Distributed login throttle + hashed recovery sensitive metadata')
ON DUPLICATE KEY UPDATE
  phase = VALUES(phase),
  status = 'applied',
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
