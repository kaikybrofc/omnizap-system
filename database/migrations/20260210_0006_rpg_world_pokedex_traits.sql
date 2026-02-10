ALTER TABLE rpg_player_pokemon
  ADD COLUMN nature_key VARCHAR(64) NULL AFTER moves_json,
  ADD COLUMN ability_key VARCHAR(64) NULL AFTER nature_key,
  ADD COLUMN ability_name VARCHAR(120) NULL AFTER ability_key;

CREATE TABLE IF NOT EXISTS rpg_player_pokedex (
  owner_jid VARCHAR(255) NOT NULL,
  poke_id INT UNSIGNED NOT NULL,
  first_captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_jid, poke_id),
  INDEX idx_rpg_pokedex_owner (owner_jid),
  CONSTRAINT fk_rpg_pokedex_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rpg_player_travel (
  owner_jid VARCHAR(255) PRIMARY KEY,
  region_key VARCHAR(120) NULL,
  location_key VARCHAR(120) NULL,
  location_area_key VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rpg_travel_owner
    FOREIGN KEY (owner_jid) REFERENCES rpg_player(jid)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
