ALTER TABLE sticker_asset
  ADD INDEX idx_sticker_asset_created_at (created_at);

ALTER TABLE sticker_asset_classification
  ADD INDEX idx_sticker_asset_classification_confidence (confidence),
  ADD INDEX idx_sticker_asset_classification_updated_at (updated_at),
  ADD INDEX idx_sticker_asset_classification_version_updated (classification_version, updated_at);

ALTER TABLE sticker_pack_item
  ADD INDEX idx_sticker_pack_item_sticker_id (sticker_id);

ALTER TABLE sticker_pack
  ADD INDEX idx_sticker_pack_catalog_lookup (deleted_at, status, pack_status, visibility, updated_at);

ALTER TABLE sticker_pack_interaction_event
  ADD INDEX idx_sticker_pack_interaction_created_at (created_at);
