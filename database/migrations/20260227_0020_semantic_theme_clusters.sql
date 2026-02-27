CREATE TABLE IF NOT EXISTS semantic_theme_clusters (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  canonical_slug VARCHAR(255) NOT NULL,
  embedding_dim SMALLINT UNSIGNED NOT NULL,
  embedding MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_semantic_theme_clusters_slug (canonical_slug),
  INDEX idx_semantic_theme_clusters_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS semantic_theme_suggestion_cache (
  suggestion_hash CHAR(64) PRIMARY KEY,
  suggestion_text VARCHAR(512) NOT NULL,
  normalized_text VARCHAR(512) NOT NULL,
  semantic_cluster_id BIGINT UNSIGNED NOT NULL,
  canonical_slug VARCHAR(255) NOT NULL,
  embedding_dim SMALLINT UNSIGNED NOT NULL,
  embedding MEDIUMBLOB NOT NULL,
  last_similarity DECIMAL(8,6) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_semantic_theme_cache_normalized (normalized_text),
  INDEX idx_semantic_theme_cache_cluster (semantic_cluster_id),
  CONSTRAINT fk_semantic_theme_cache_cluster
    FOREIGN KEY (semantic_cluster_id) REFERENCES semantic_theme_clusters(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sticker_asset_classification
  ADD COLUMN IF NOT EXISTS semantic_cluster_id BIGINT UNSIGNED NULL AFTER llm_pack_suggestions,
  ADD COLUMN IF NOT EXISTS semantic_cluster_slug VARCHAR(255) NULL AFTER semantic_cluster_id;

ALTER TABLE sticker_asset_classification
  ADD INDEX idx_sticker_asset_classification_semantic_cluster (semantic_cluster_id);
