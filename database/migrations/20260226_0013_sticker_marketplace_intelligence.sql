CREATE TABLE IF NOT EXISTS sticker_pack_interaction_event (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  pack_id CHAR(36) NOT NULL,
  interaction ENUM('open', 'like', 'dislike') NOT NULL,
  actor_key VARCHAR(120) NULL,
  session_key VARCHAR(120) NULL,
  source VARCHAR(32) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sticker_pack_interaction_pack
    FOREIGN KEY (pack_id) REFERENCES sticker_pack(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_sticker_pack_interaction_pack_created (pack_id, created_at),
  INDEX idx_sticker_pack_interaction_actor_created (actor_key, created_at),
  INDEX idx_sticker_pack_interaction_session_created (session_key, created_at),
  INDEX idx_sticker_pack_interaction_type_created (interaction, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sticker_asset_classification
  ADD COLUMN IF NOT EXISTS classification_version VARCHAR(32) NOT NULL DEFAULT 'v1' AFTER model_name;
