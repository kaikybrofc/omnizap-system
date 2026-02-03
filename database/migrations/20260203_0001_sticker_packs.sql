CREATE TABLE IF NOT EXISTS sticker_asset (
  id CHAR(36) PRIMARY KEY,
  owner_jid VARCHAR(255) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  mimetype VARCHAR(64) NOT NULL,
  is_animated TINYINT(1) NOT NULL DEFAULT 0,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  size_bytes INT UNSIGNED NOT NULL,
  storage_path VARCHAR(1024) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sticker_asset_sha256 (sha256),
  INDEX idx_sticker_asset_owner_created (owner_jid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sticker_pack (
  id CHAR(36) PRIMARY KEY,
  owner_jid VARCHAR(255) NOT NULL,
  name VARCHAR(120) NOT NULL,
  publisher VARCHAR(120) NOT NULL,
  description TEXT NULL,
  pack_key VARCHAR(160) NOT NULL,
  cover_sticker_id CHAR(36) NULL,
  visibility ENUM('private', 'public', 'unlisted') NOT NULL DEFAULT 'private',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_sticker_pack_pack_key (pack_key),
  INDEX idx_sticker_pack_owner_deleted (owner_jid, deleted_at),
  INDEX idx_sticker_pack_owner_updated (owner_jid, updated_at),
  CONSTRAINT fk_sticker_pack_cover
    FOREIGN KEY (cover_sticker_id) REFERENCES sticker_asset(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sticker_pack_item (
  id CHAR(36) PRIMARY KEY,
  pack_id CHAR(36) NOT NULL,
  sticker_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL,
  emojis JSON NULL,
  accessibility_label VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sticker_pack_item_pack_sticker (pack_id, sticker_id),
  UNIQUE KEY uq_sticker_pack_item_pack_position (pack_id, position),
  INDEX idx_sticker_pack_item_pack_position (pack_id, position),
  CONSTRAINT fk_sticker_pack_item_pack
    FOREIGN KEY (pack_id) REFERENCES sticker_pack(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sticker_pack_item_asset
    FOREIGN KEY (sticker_id) REFERENCES sticker_asset(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
