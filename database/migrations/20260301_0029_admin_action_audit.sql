CREATE TABLE IF NOT EXISTS admin_action_audit (
  id CHAR(36) PRIMARY KEY,
  admin_role VARCHAR(32) NOT NULL DEFAULT 'owner',
  admin_google_sub VARCHAR(255) NULL,
  admin_email VARCHAR(255) NULL,
  admin_owner_jid VARCHAR(255) NULL,
  action VARCHAR(96) NOT NULL,
  target_type VARCHAR(64) NULL,
  target_id VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_action_audit_created (created_at),
  INDEX idx_admin_action_audit_action_created (action, created_at),
  INDEX idx_admin_action_audit_admin_created (admin_google_sub, admin_email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
