ALTER TABLE sticker_pack
  ADD COLUMN IF NOT EXISTS status ENUM('draft', 'uploading', 'processing', 'published', 'failed')
  NOT NULL DEFAULT 'published'
  AFTER visibility;

CREATE TABLE IF NOT EXISTS sticker_pack_web_upload (
  id CHAR(36) PRIMARY KEY,
  pack_id CHAR(36) NOT NULL,
  upload_id VARCHAR(120) NOT NULL,
  sticker_hash CHAR(64) NOT NULL,
  source_mimetype VARCHAR(64) NULL,
  upload_status ENUM('pending', 'processing', 'done', 'failed') NOT NULL DEFAULT 'pending',
  sticker_id CHAR(36) NULL,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(255) NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sticker_pack_web_upload_pack_upload_id (pack_id, upload_id),
  UNIQUE KEY uq_sticker_pack_web_upload_pack_hash (pack_id, sticker_hash),
  INDEX idx_sticker_pack_web_upload_pack_status (pack_id, upload_status),
  INDEX idx_sticker_pack_web_upload_pack_updated (pack_id, updated_at),
  CONSTRAINT fk_sticker_pack_web_upload_pack
    FOREIGN KEY (pack_id) REFERENCES sticker_pack(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sticker_pack_web_upload_sticker
    FOREIGN KEY (sticker_id) REFERENCES sticker_asset(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
