CREATE TABLE IF NOT EXISTS rpg_player_mission_progress (
  owner_jid VARCHAR(255) PRIMARY KEY,
  daily_ref_date DATE NOT NULL,
  daily_progress_json JSON NOT NULL,
  daily_claimed_at DATETIME NULL,
  weekly_ref_date DATE NOT NULL,
  weekly_progress_json JSON NOT NULL,
  weekly_claimed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rpg_mission_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
