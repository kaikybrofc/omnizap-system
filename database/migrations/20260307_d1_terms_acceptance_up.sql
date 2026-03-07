-- D1 (2026-03-07) - Registro versionado de aceite juridico
-- Scope: trilha probatoria de aceite de Termos/Politicas (hash da versao + timestamp + IP + user agent)

SET @migration_key := '20260307_d1_terms_acceptance';

CREATE TABLE IF NOT EXISTS web_terms_acceptance_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  document_key VARCHAR(64) NOT NULL,
  document_version VARCHAR(64) NOT NULL,
  document_version_hash CHAR(64) NOT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at_client TIMESTAMP NULL DEFAULT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'web_login',
  google_sub VARCHAR(80) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  owner_jid VARCHAR(120) DEFAULT NULL,
  session_key VARCHAR(80) DEFAULT NULL,
  ip_address VARCHAR(64) DEFAULT NULL,
  user_agent VARCHAR(512) DEFAULT NULL,
  metadata LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(metadata)),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_web_terms_acceptance_event_id (event_id),
  KEY idx_web_terms_acceptance_doc_version (document_key, document_version, accepted_at),
  KEY idx_web_terms_acceptance_identity (google_sub, email, owner_jid, accepted_at),
  KEY idx_web_terms_acceptance_source_created (source, created_at),
  KEY idx_web_terms_acceptance_session_created (session_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_change_log (migration_key, phase, status, notes)
VALUES (@migration_key, 'D1', 'applied', 'Tabela de aceite versionado de termos/politicas')
ON DUPLICATE KEY UPDATE
  phase = VALUES(phase),
  status = 'applied',
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
