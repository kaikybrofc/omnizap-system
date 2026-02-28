CREATE TABLE IF NOT EXISTS feature_flag (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  flag_name VARCHAR(120) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  rollout_percent TINYINT UNSIGNED NOT NULL DEFAULT 100,
  description VARCHAR(255) NULL,
  updated_by VARCHAR(120) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_feature_flag_name (flag_name),
  INDEX idx_feature_flag_enabled (is_enabled, rollout_percent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO feature_flag (flag_name, is_enabled, rollout_percent, description)
VALUES
  ('enable_ranking_snapshot_read', 1, 100, 'Leitura HTTP do ranking/sinais a partir de snapshot'),
  ('enable_domain_event_outbox', 1, 100, 'Publicacao e consumo de eventos de dominio via outbox interno'),
  ('enable_worker_dedicated_processes', 0, 100, 'Ativa workers dedicados por tipo de task'),
  ('enable_object_storage_delivery', 0, 100, 'Entrega de assets via object storage/CDN com URL segura')
ON DUPLICATE KEY UPDATE
  description = VALUES(description);
