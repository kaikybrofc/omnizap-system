ALTER TABLE rpg_player
  ADD COLUMN IF NOT EXISTS xp_pool_social BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER xp;

CREATE TABLE IF NOT EXISTS rpg_social_xp_daily (
  day_ref_date DATE NOT NULL,
  owner_jid VARCHAR(255) NOT NULL,
  chat_jid VARCHAR(255) NOT NULL,
  earned_xp INT UNSIGNED NOT NULL DEFAULT 0,
  converted_xp INT UNSIGNED NOT NULL DEFAULT 0,
  cap_hits INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_hash CHAR(40) NULL,
  last_earned_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (day_ref_date, owner_jid, chat_jid),
  INDEX idx_rpg_social_xp_owner_day (owner_jid, day_ref_date),
  INDEX idx_rpg_social_xp_chat_day (chat_jid, day_ref_date),
  CONSTRAINT fk_rpg_social_xp_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
