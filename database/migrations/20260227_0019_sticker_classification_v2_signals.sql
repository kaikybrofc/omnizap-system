ALTER TABLE sticker_asset_classification
  ADD COLUMN IF NOT EXISTS entropy DECIMAL(8,6) NULL AFTER confidence,
  ADD COLUMN IF NOT EXISTS confidence_margin DECIMAL(8,6) NULL AFTER entropy,
  ADD COLUMN IF NOT EXISTS top_labels JSON NULL AFTER all_scores,
  ADD COLUMN IF NOT EXISTS affinity_weight DECIMAL(8,6) NULL AFTER top_labels,
  ADD COLUMN IF NOT EXISTS image_hash CHAR(64) NULL AFTER affinity_weight,
  ADD COLUMN IF NOT EXISTS ambiguous TINYINT(1) NOT NULL DEFAULT 0 AFTER image_hash,
  ADD COLUMN IF NOT EXISTS llm_subtags JSON NULL AFTER ambiguous,
  ADD COLUMN IF NOT EXISTS llm_style_traits JSON NULL AFTER llm_subtags,
  ADD COLUMN IF NOT EXISTS llm_emotions JSON NULL AFTER llm_style_traits,
  ADD COLUMN IF NOT EXISTS llm_pack_suggestions JSON NULL AFTER llm_emotions,
  ADD COLUMN IF NOT EXISTS similar_images JSON NULL AFTER llm_pack_suggestions;
