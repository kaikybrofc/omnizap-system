CREATE TABLE IF NOT EXISTS sticker_pack_score_snapshot (
  pack_id CHAR(36) PRIMARY KEY,
  ranking_score DECIMAL(10,6) NOT NULL DEFAULT 0,
  pack_score DECIMAL(10,6) NOT NULL DEFAULT 0,
  trend_score DECIMAL(10,6) NOT NULL DEFAULT 0,
  quality_score DECIMAL(10,6) NOT NULL DEFAULT 0,
  engagement_score DECIMAL(10,6) NOT NULL DEFAULT 0,
  diversity_score DECIMAL(10,6) NOT NULL DEFAULT 0,
  cohesion_score DECIMAL(10,6) NOT NULL DEFAULT 0,
  sensitive_content TINYINT(1) NOT NULL DEFAULT 0,
  nsfw_level ENUM('safe', 'suggestive', 'explicit') NOT NULL DEFAULT 'safe',
  sticker_count INT UNSIGNED NOT NULL DEFAULT 0,
  tags JSON NULL,
  scores_json JSON NULL,
  source_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  refreshed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sticker_pack_score_snapshot_pack
    FOREIGN KEY (pack_id) REFERENCES sticker_pack(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_sticker_pack_score_snapshot_ranking (ranking_score),
  INDEX idx_sticker_pack_score_snapshot_trend (trend_score),
  INDEX idx_sticker_pack_score_snapshot_refresh (refreshed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
