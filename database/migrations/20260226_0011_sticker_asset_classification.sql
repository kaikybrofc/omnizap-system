CREATE TABLE IF NOT EXISTS sticker_asset_classification (
  asset_id CHAR(36) PRIMARY KEY,
  provider VARCHAR(64) NOT NULL DEFAULT 'clip',
  model_name VARCHAR(120) NULL,
  category VARCHAR(120) NULL,
  confidence DECIMAL(6,5) NULL,
  nsfw_score DECIMAL(6,5) NULL,
  is_nsfw TINYINT(1) NOT NULL DEFAULT 0,
  all_scores JSON NULL,
  classified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sticker_asset_classification_asset
    FOREIGN KEY (asset_id) REFERENCES sticker_asset(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_sticker_asset_classification_category (category),
  INDEX idx_sticker_asset_classification_nsfw (is_nsfw)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
