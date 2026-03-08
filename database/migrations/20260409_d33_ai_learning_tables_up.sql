CREATE TABLE IF NOT EXISTS ai_learning_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_question VARCHAR(512) NOT NULL,
  normalized_question VARCHAR(512) NOT NULL,
  tool_suggested VARCHAR(64) NOT NULL,
  tool_executed VARCHAR(64) NOT NULL,
  success TINYINT(1) NOT NULL DEFAULT 1,
  confidence DECIMAL(5,4) DEFAULT NULL,
  processed TINYINT(1) NOT NULL DEFAULT 0,
  processed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_learning_events_processed_created (processed, created_at),
  KEY idx_ai_learning_events_tool_created (tool_executed, created_at),
  KEY idx_ai_learning_events_norm_question (normalized_question)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_learned_patterns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pattern VARCHAR(512) NOT NULL,
  tool VARCHAR(64) NOT NULL,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
  source_event_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_learned_patterns_event_pattern (source_event_id, tool, pattern),
  KEY idx_ai_learned_patterns_tool_created (tool, created_at),
  KEY idx_ai_learned_patterns_tool_confidence (tool, confidence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_learned_keywords (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  keyword VARCHAR(128) NOT NULL,
  tool VARCHAR(64) NOT NULL,
  weight DECIMAL(6,4) NOT NULL DEFAULT 1.0000,
  source_event_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_learned_keywords_event_keyword (source_event_id, tool, keyword),
  KEY idx_ai_learned_keywords_tool_created (tool, created_at),
  KEY idx_ai_learned_keywords_tool_weight (tool, weight)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_question_embeddings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  question VARCHAR(512) NOT NULL,
  embedding LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(embedding)),
  tool VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_question_embeddings_tool_created (tool, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
