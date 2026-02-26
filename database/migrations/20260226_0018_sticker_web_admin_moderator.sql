CREATE TABLE IF NOT EXISTS sticker_web_admin_moderator (
  google_sub VARCHAR(80) PRIMARY KEY,
  owner_jid VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(120) NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_by_google_sub VARCHAR(80) NULL,
  created_by_email VARCHAR(255) NULL,
  updated_by_google_sub VARCHAR(80) NULL,
  updated_by_email VARCHAR(255) NULL,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sticker_web_admin_moderator_email (email),
  INDEX idx_sticker_web_admin_moderator_owner_jid (owner_jid),
  INDEX idx_sticker_web_admin_moderator_revoked_updated (revoked_at, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
