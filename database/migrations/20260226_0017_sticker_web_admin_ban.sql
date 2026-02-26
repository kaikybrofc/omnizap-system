CREATE TABLE IF NOT EXISTS sticker_web_admin_ban (
  id CHAR(36) PRIMARY KEY,
  google_sub VARCHAR(80) NULL,
  email VARCHAR(255) NULL,
  owner_jid VARCHAR(255) NULL,
  reason VARCHAR(255) NULL,
  created_by_google_sub VARCHAR(80) NULL,
  created_by_email VARCHAR(255) NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_sticker_web_admin_ban_identity
    CHECK (
      google_sub IS NOT NULL
      OR email IS NOT NULL
      OR owner_jid IS NOT NULL
    ),
  INDEX idx_sticker_web_admin_ban_google_sub (google_sub, revoked_at, created_at),
  INDEX idx_sticker_web_admin_ban_email (email, revoked_at, created_at),
  INDEX idx_sticker_web_admin_ban_owner_jid (owner_jid, revoked_at, created_at),
  INDEX idx_sticker_web_admin_ban_revoked_created (revoked_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
