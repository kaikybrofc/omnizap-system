ALTER TABLE sticker_pack
  ADD COLUMN IF NOT EXISTS pack_status ENUM('building', 'ready', 'archived')
  NOT NULL DEFAULT 'ready'
  AFTER status,
  ADD COLUMN IF NOT EXISTS pack_theme_key VARCHAR(96) NULL
  AFTER pack_status,
  ADD COLUMN IF NOT EXISTS pack_volume INT UNSIGNED NULL
  AFTER pack_theme_key,
  ADD COLUMN IF NOT EXISTS is_auto_pack TINYINT(1) NOT NULL DEFAULT 0
  AFTER pack_volume,
  ADD COLUMN IF NOT EXISTS last_rebalanced_at TIMESTAMP NULL DEFAULT NULL
  AFTER is_auto_pack;

CREATE INDEX idx_sticker_pack_auto_theme_status
  ON sticker_pack (is_auto_pack, pack_theme_key, pack_status, pack_volume);

CREATE INDEX idx_sticker_pack_auto_owner_status
  ON sticker_pack (owner_jid, is_auto_pack, pack_status, updated_at);
