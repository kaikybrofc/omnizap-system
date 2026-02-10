CREATE TABLE IF NOT EXISTS rpg_raid_state (
  chat_jid VARCHAR(255) PRIMARY KEY,
  created_by_jid VARCHAR(255) NOT NULL,
  biome_key VARCHAR(64) NULL,
  boss_snapshot_json JSON NOT NULL,
  max_hp INT UNSIGNED NOT NULL,
  current_hp INT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rpg_raid_ends_at (ends_at),
  CONSTRAINT fk_rpg_raid_creator
    FOREIGN KEY (created_by_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_raid_participant (
  chat_jid VARCHAR(255) NOT NULL,
  owner_jid VARCHAR(255) NOT NULL,
  total_damage INT UNSIGNED NOT NULL DEFAULT 0,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_jid, owner_jid),
  INDEX idx_rpg_raid_part_owner (owner_jid),
  CONSTRAINT fk_rpg_raid_part_chat
    FOREIGN KEY (chat_jid) REFERENCES rpg_raid_state(chat_jid)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_raid_part_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_pvp_challenge (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  chat_jid VARCHAR(255) NULL,
  challenger_jid VARCHAR(255) NOT NULL,
  opponent_jid VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  turn_jid VARCHAR(255) NULL,
  winner_jid VARCHAR(255) NULL,
  battle_snapshot_json JSON NOT NULL,
  started_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rpg_pvp_status_expires (status, expires_at),
  INDEX idx_rpg_pvp_challenger (challenger_jid),
  INDEX idx_rpg_pvp_opponent (opponent_jid),
  CONSTRAINT fk_rpg_pvp_challenger
    FOREIGN KEY (challenger_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rpg_pvp_opponent
    FOREIGN KEY (opponent_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
