-- Migration: add lid_map table for LID -> JID resolution
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS lid_map (
  lid VARCHAR(64) PRIMARY KEY,
  jid VARCHAR(64) NULL,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  source VARCHAR(32),
  INDEX idx_lid_map_jid (jid),
  INDEX idx_lid_map_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
