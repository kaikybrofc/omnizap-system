CREATE TABLE IF NOT EXISTS sticker_web_google_user (
  google_sub VARCHAR(80) PRIMARY KEY,
  owner_jid VARCHAR(120) NOT NULL,
  email VARCHAR(255) NULL,
  name VARCHAR(120) NULL,
  picture_url VARCHAR(1024) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_sticker_web_google_user_owner_jid (owner_jid),
  INDEX idx_sticker_web_google_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sticker_web_google_session (
  session_token CHAR(36) PRIMARY KEY,
  google_sub VARCHAR(80) NOT NULL,
  owner_jid VARCHAR(120) NOT NULL,
  email VARCHAR(255) NULL,
  name VARCHAR(120) NULL,
  picture_url VARCHAR(1024) NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_sticker_web_google_session_google_sub (google_sub),
  INDEX idx_sticker_web_google_session_owner_jid (owner_jid),
  INDEX idx_sticker_web_google_session_expires_at (expires_at),
  INDEX idx_sticker_web_google_session_revoked_expires (revoked_at, expires_at),
  CONSTRAINT fk_sticker_web_google_session_user
    FOREIGN KEY (google_sub) REFERENCES sticker_web_google_user(google_sub)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
