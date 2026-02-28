SET @db_name = DATABASE();

SET @has_user_owner_phone := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'sticker_web_google_user'
    AND COLUMN_NAME = 'owner_phone'
);
SET @sql_user_owner_phone := IF(
  @has_user_owner_phone = 0,
  'ALTER TABLE sticker_web_google_user ADD COLUMN owner_phone VARCHAR(20) NULL AFTER owner_jid',
  'SELECT 1'
);
PREPARE stmt_user_owner_phone FROM @sql_user_owner_phone;
EXECUTE stmt_user_owner_phone;
DEALLOCATE PREPARE stmt_user_owner_phone;

SET @has_user_owner_phone_idx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'sticker_web_google_user'
    AND INDEX_NAME = 'idx_sticker_web_google_user_owner_phone'
);
SET @sql_user_owner_phone_idx := IF(
  @has_user_owner_phone_idx = 0,
  'ALTER TABLE sticker_web_google_user ADD INDEX idx_sticker_web_google_user_owner_phone (owner_phone)',
  'SELECT 1'
);
PREPARE stmt_user_owner_phone_idx FROM @sql_user_owner_phone_idx;
EXECUTE stmt_user_owner_phone_idx;
DEALLOCATE PREPARE stmt_user_owner_phone_idx;

SET @has_session_owner_phone := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'sticker_web_google_session'
    AND COLUMN_NAME = 'owner_phone'
);
SET @sql_session_owner_phone := IF(
  @has_session_owner_phone = 0,
  'ALTER TABLE sticker_web_google_session ADD COLUMN owner_phone VARCHAR(20) NULL AFTER owner_jid',
  'SELECT 1'
);
PREPARE stmt_session_owner_phone FROM @sql_session_owner_phone;
EXECUTE stmt_session_owner_phone;
DEALLOCATE PREPARE stmt_session_owner_phone;

SET @has_session_owner_phone_idx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'sticker_web_google_session'
    AND INDEX_NAME = 'idx_sticker_web_google_session_owner_phone'
);
SET @sql_session_owner_phone_idx := IF(
  @has_session_owner_phone_idx = 0,
  'ALTER TABLE sticker_web_google_session ADD INDEX idx_sticker_web_google_session_owner_phone (owner_phone)',
  'SELECT 1'
);
PREPARE stmt_session_owner_phone_idx FROM @sql_session_owner_phone_idx;
EXECUTE stmt_session_owner_phone_idx;
DEALLOCATE PREPARE stmt_session_owner_phone_idx;

UPDATE sticker_web_google_user
SET owner_phone = CASE
  WHEN SUBSTRING_INDEX(SUBSTRING_INDEX(owner_jid, '@', 1), ':', 1) REGEXP '^[0-9]{10,20}$'
    THEN SUBSTRING_INDEX(SUBSTRING_INDEX(owner_jid, '@', 1), ':', 1)
  ELSE NULL
END
WHERE (owner_phone IS NULL OR owner_phone = '')
  AND owner_jid IS NOT NULL;

UPDATE sticker_web_google_session
SET owner_phone = CASE
  WHEN SUBSTRING_INDEX(SUBSTRING_INDEX(owner_jid, '@', 1), ':', 1) REGEXP '^[0-9]{10,20}$'
    THEN SUBSTRING_INDEX(SUBSTRING_INDEX(owner_jid, '@', 1), ':', 1)
  ELSE NULL
END
WHERE (owner_phone IS NULL OR owner_phone = '')
  AND owner_jid IS NOT NULL;
