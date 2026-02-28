ALTER TABLE sticker_worker_task_queue
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180) NULL AFTER task_type;

CREATE UNIQUE INDEX uq_sticker_worker_task_idempotency_key
  ON sticker_worker_task_queue (idempotency_key);

CREATE TABLE IF NOT EXISTS sticker_worker_task_dlq (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NULL,
  task_type ENUM('classification_cycle', 'curation_cycle', 'rebuild_cycle') NOT NULL,
  payload JSON NULL,
  idempotency_key VARCHAR(180) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  priority TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  failed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sticker_worker_task_dlq_task_id (task_id),
  INDEX idx_sticker_worker_task_dlq_type_failed_at (task_type, failed_at),
  INDEX idx_sticker_worker_task_dlq_task_id (task_id),
  INDEX idx_sticker_worker_task_dlq_idempotency_key (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
