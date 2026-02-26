CREATE TABLE IF NOT EXISTS sticker_asset_reprocess_queue (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  asset_id CHAR(36) NOT NULL,
  reason ENUM('MODEL_UPGRADE', 'LOW_CONFIDENCE', 'TREND_SHIFT', 'NSFW_REVIEW') NOT NULL,
  priority TINYINT UNSIGNED NOT NULL DEFAULT 50,
  scheduled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  worker_token CHAR(36) NULL,
  last_error VARCHAR(255) NULL,
  locked_at TIMESTAMP NULL DEFAULT NULL,
  processed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sticker_reprocess_asset
    FOREIGN KEY (asset_id) REFERENCES sticker_asset(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_sticker_reprocess_status_schedule (status, scheduled_at, priority),
  INDEX idx_sticker_reprocess_asset_reason (asset_id, reason),
  INDEX idx_sticker_reprocess_worker_token (worker_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sticker_worker_task_queue (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_type ENUM('classification_cycle', 'curation_cycle', 'rebuild_cycle') NOT NULL,
  payload JSON NULL,
  priority TINYINT UNSIGNED NOT NULL DEFAULT 50,
  scheduled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  worker_token CHAR(36) NULL,
  last_error VARCHAR(255) NULL,
  locked_at TIMESTAMP NULL DEFAULT NULL,
  processed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sticker_worker_task_type_status_schedule (task_type, status, scheduled_at, priority),
  INDEX idx_sticker_worker_task_status_schedule (status, scheduled_at, priority),
  INDEX idx_sticker_worker_task_worker_token (worker_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
