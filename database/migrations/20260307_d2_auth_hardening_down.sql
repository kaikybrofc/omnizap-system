-- D2 rollback

SET @migration_key := '20260307_d2_auth_hardening';

DROP PROCEDURE IF EXISTS __drop_column_if_exists;
DROP PROCEDURE IF EXISTS __drop_index_if_exists;

DELIMITER $$
CREATE PROCEDURE __drop_column_if_exists(IN p_table_name VARCHAR(64), IN p_column_name VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF EXISTS (
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

CREATE PROCEDURE __drop_index_if_exists(IN p_table_name VARCHAR(64), IN p_index_name VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF EXISTS (
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

CALL __drop_index_if_exists(
  'web_user_password_recovery_code',
  'idx_web_user_password_recovery_email_hash_created',
  'DROP INDEX idx_web_user_password_recovery_email_hash_created ON web_user_password_recovery_code'
);

CALL __drop_column_if_exists(
  'web_user_password_recovery_code',
  'email_hash',
  'ALTER TABLE web_user_password_recovery_code DROP COLUMN email_hash'
);

CALL __drop_column_if_exists(
  'web_user_password_recovery_code',
  'requested_ip_hash',
  'ALTER TABLE web_user_password_recovery_code DROP COLUMN requested_ip_hash'
);

CALL __drop_column_if_exists(
  'web_user_password_recovery_code',
  'requested_user_agent_hash',
  'ALTER TABLE web_user_password_recovery_code DROP COLUMN requested_user_agent_hash'
);

DROP TABLE IF EXISTS web_user_password_login_throttle;

DROP PROCEDURE IF EXISTS __drop_column_if_exists;
DROP PROCEDURE IF EXISTS __drop_index_if_exists;

UPDATE schema_change_log
   SET status = 'rolled_back',
       notes = 'D2 rollback executado',
       updated_at = CURRENT_TIMESTAMP
 WHERE migration_key = @migration_key;
