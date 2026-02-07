CREATE TABLE IF NOT EXISTS user_xp (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sender_id VARCHAR(255) NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 1,
  messages_count INT NOT NULL DEFAULT 0,
  last_xp_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_xp_sender_id (sender_id),
  INDEX idx_user_xp_level (level),
  INDEX idx_user_xp_xp (xp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xp_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sender_id VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL,
  reason VARCHAR(255) NULL,
  actor_id VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_xp_transactions_sender_created (sender_id, created_at),
  INDEX idx_xp_transactions_actor_created (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
