CREATE TABLE IF NOT EXISTS sticker_pack_engagement (
  pack_id CHAR(36) PRIMARY KEY,
  open_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  like_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  dislike_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMP NULL DEFAULT NULL,
  last_interacted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sticker_pack_engagement_pack
    FOREIGN KEY (pack_id) REFERENCES sticker_pack(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_sticker_pack_engagement_updated (updated_at),
  INDEX idx_sticker_pack_engagement_like (like_count),
  INDEX idx_sticker_pack_engagement_open (open_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
