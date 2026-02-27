import { executeQuery, TABLES } from '../../../database/index.js';

const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  if (Buffer.isBuffer(value)) {
    try {
      return JSON.parse(value.toString('utf8'));
    } catch {
      return fallback;
    }
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
};

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, Number(value)));

const deriveEntropyNormalized = (entropyValue, topLabels = []) => {
  const entropy = Number(entropyValue);
  if (!Number.isFinite(entropy) || entropy <= 0) return 0;
  const k = Array.isArray(topLabels) ? topLabels.length : 0;
  if (k > 1) {
    const maxEntropy = Math.log(k);
    if (maxEntropy > 0) return clampNumber(entropy / maxEntropy, 0, 1);
  }
  const legacyThreshold = 2.5;
  return clampNumber(entropy / legacyThreshold, 0, 1);
};

const normalizeClassificationRow = (row) => {
  if (!row) return null;

  const topLabels = parseJson(row.top_labels, []);
  const similarImages = parseJson(row.similar_images, []);
  const llmSubtags = parseJson(row.llm_subtags, []);
  const llmStyleTraits = parseJson(row.llm_style_traits, []);
  const llmEmotions = parseJson(row.llm_emotions, []);
  const llmPackSuggestions = parseJson(row.llm_pack_suggestions, []);
  const entropy = row.entropy !== null && row.entropy !== undefined ? Number(row.entropy) : null;

  return {
    asset_id: row.asset_id,
    provider: row.provider || 'clip',
    model_name: row.model_name || null,
    classification_version: row.classification_version || 'v1',
    category: row.category || null,
    confidence: row.confidence !== null && row.confidence !== undefined ? Number(row.confidence) : null,
    entropy,
    entropy_normalized: entropy !== null ? Number(deriveEntropyNormalized(entropy, topLabels).toFixed(6)) : null,
    confidence_margin: row.confidence_margin !== null && row.confidence_margin !== undefined ? Number(row.confidence_margin) : null,
    affinity_weight: row.affinity_weight !== null && row.affinity_weight !== undefined ? Number(row.affinity_weight) : null,
    nsfw_score: row.nsfw_score !== null && row.nsfw_score !== undefined ? Number(row.nsfw_score) : null,
    is_nsfw: row.is_nsfw === 1 || row.is_nsfw === true,
    ambiguous: row.ambiguous === 1 || row.ambiguous === true,
    image_hash: row.image_hash || null,
    all_scores: parseJson(row.all_scores, {}),
    top_labels: Array.isArray(topLabels) ? topLabels : [],
    similar_images: Array.isArray(similarImages) ? similarImages : [],
    llm_subtags: Array.isArray(llmSubtags) ? llmSubtags : [],
    llm_style_traits: Array.isArray(llmStyleTraits) ? llmStyleTraits : [],
    llm_emotions: Array.isArray(llmEmotions) ? llmEmotions : [],
    llm_pack_suggestions: Array.isArray(llmPackSuggestions) ? llmPackSuggestions : [],
    semantic_cluster_id:
      row.semantic_cluster_id !== null && row.semantic_cluster_id !== undefined
        ? Number(row.semantic_cluster_id)
        : null,
    semantic_cluster_slug: row.semantic_cluster_slug || null,
    classified_at: row.classified_at,
    updated_at: row.updated_at,
  };
};

export async function findStickerClassificationByAssetId(assetId, connection = null) {
  const rows = await executeQuery(
    `SELECT * FROM ${TABLES.STICKER_ASSET_CLASSIFICATION} WHERE asset_id = ? LIMIT 1`,
    [assetId],
    connection,
  );

  return normalizeClassificationRow(rows?.[0] || null);
}

export async function listStickerClassificationsByAssetIds(assetIds, connection = null) {
  if (!Array.isArray(assetIds) || !assetIds.length) return [];

  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await executeQuery(
    `SELECT * FROM ${TABLES.STICKER_ASSET_CLASSIFICATION} WHERE asset_id IN (${placeholders})`,
    uniqueIds,
    connection,
  );

  const normalized = rows.map((row) => normalizeClassificationRow(row));
  const byAssetId = new Map(normalized.map((entry) => [entry.asset_id, entry]));
  return uniqueIds.map((assetId) => byAssetId.get(assetId)).filter(Boolean);
}

export async function upsertStickerAssetClassification(payload, connection = null) {
  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_ASSET_CLASSIFICATION}
      (asset_id, provider, model_name, classification_version, category, confidence, entropy, confidence_margin, nsfw_score, is_nsfw, all_scores, top_labels, affinity_weight, image_hash, ambiguous, llm_subtags, llm_style_traits, llm_emotions, llm_pack_suggestions, semantic_cluster_id, semantic_cluster_slug, similar_images, classified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
      provider = VALUES(provider),
      model_name = VALUES(model_name),
      classification_version = VALUES(classification_version),
      category = VALUES(category),
      confidence = VALUES(confidence),
      entropy = VALUES(entropy),
      confidence_margin = VALUES(confidence_margin),
      nsfw_score = VALUES(nsfw_score),
      is_nsfw = VALUES(is_nsfw),
      all_scores = VALUES(all_scores),
      top_labels = VALUES(top_labels),
      affinity_weight = VALUES(affinity_weight),
      image_hash = VALUES(image_hash),
      ambiguous = VALUES(ambiguous),
      llm_subtags = VALUES(llm_subtags),
      llm_style_traits = VALUES(llm_style_traits),
      llm_emotions = VALUES(llm_emotions),
      llm_pack_suggestions = VALUES(llm_pack_suggestions),
      semantic_cluster_id = VALUES(semantic_cluster_id),
      semantic_cluster_slug = VALUES(semantic_cluster_slug),
      similar_images = VALUES(similar_images),
      classified_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP`,
    [
      payload.asset_id,
      payload.provider || 'clip',
      payload.model_name || null,
      payload.classification_version || 'v1',
      payload.category || null,
      payload.confidence ?? null,
      payload.entropy ?? null,
      payload.confidence_margin ?? null,
      payload.nsfw_score ?? null,
      payload.is_nsfw ? 1 : 0,
      payload.all_scores ? JSON.stringify(payload.all_scores) : JSON.stringify({}),
      payload.top_labels ? JSON.stringify(payload.top_labels) : JSON.stringify([]),
      payload.affinity_weight ?? null,
      payload.image_hash || null,
      payload.ambiguous ? 1 : 0,
      payload.llm_subtags ? JSON.stringify(payload.llm_subtags) : JSON.stringify([]),
      payload.llm_style_traits ? JSON.stringify(payload.llm_style_traits) : JSON.stringify([]),
      payload.llm_emotions ? JSON.stringify(payload.llm_emotions) : JSON.stringify([]),
      payload.llm_pack_suggestions ? JSON.stringify(payload.llm_pack_suggestions) : JSON.stringify([]),
      payload.semantic_cluster_id ?? null,
      payload.semantic_cluster_slug || null,
      payload.similar_images ? JSON.stringify(payload.similar_images) : JSON.stringify([]),
    ],
    connection,
  );

  return findStickerClassificationByAssetId(payload.asset_id, connection);
}

export async function updateStickerClassificationSemanticCluster(
  assetId,
  { semanticClusterId = null, semanticClusterSlug = null } = {},
  connection = null,
) {
  if (!assetId) return null;

  await executeQuery(
    `UPDATE ${TABLES.STICKER_ASSET_CLASSIFICATION}
     SET semantic_cluster_id = ?, semantic_cluster_slug = ?, updated_at = CURRENT_TIMESTAMP
     WHERE asset_id = ?`,
    [
      semanticClusterId ?? null,
      semanticClusterSlug || null,
      assetId,
    ],
    connection,
  );

  return findStickerClassificationByAssetId(assetId, connection);
}

export async function listClipImageEmbeddingsByImageHashes(imageHashes, connection = null) {
  const uniqueHashes = Array.from(
    new Set((Array.isArray(imageHashes) ? imageHashes : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => value.length === 64)),
  );
  if (!uniqueHashes.length) return [];

  const placeholders = uniqueHashes.map(() => '?').join(', ');
  try {
    const rows = await executeQuery(
      `SELECT image_hash, embedding, embedding_dim
       FROM clip_image_embedding_cache
       WHERE image_hash IN (${placeholders})`,
      uniqueHashes,
      connection,
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function deleteStickerAssetClassificationByAssetId(assetId, connection = null) {
  const result = await executeQuery(
    `DELETE FROM ${TABLES.STICKER_ASSET_CLASSIFICATION}
     WHERE asset_id = ?`,
    [assetId],
    connection,
  );

  return Number(result?.affectedRows || 0);
}

const clampInt = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

export async function listAssetsForModelUpgradeReprocess(
  { currentVersion, limit = 150, offset = 0 } = {},
  connection = null,
) {
  const normalizedVersion = String(currentVersion || '').trim();
  if (!normalizedVersion) return [];

  const safeLimit = clampInt(limit, 150, 1, 1000);
  const safeOffset = clampInt(offset, 0, 0, 500000);
  const rows = await executeQuery(
    `SELECT c.asset_id
     FROM ${TABLES.STICKER_ASSET_CLASSIFICATION} c
     LEFT JOIN ${TABLES.STICKER_ASSET_REPROCESS_QUEUE} q
       ON q.asset_id = c.asset_id
       AND q.reason = 'MODEL_UPGRADE'
       AND q.status IN ('pending', 'processing')
     WHERE c.classification_version <> ?
       AND q.id IS NULL
     ORDER BY c.updated_at ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [normalizedVersion],
    connection,
  );

  return rows.map((row) => row.asset_id).filter(Boolean);
}

export async function listAssetsForLowConfidenceReprocess(
  { confidenceThreshold = 0.65, staleHours = 48, limit = 150, offset = 0 } = {},
  connection = null,
) {
  const threshold = Number(confidenceThreshold);
  if (!Number.isFinite(threshold)) return [];

  const safeStaleHours = clampInt(staleHours, 48, 1, 24 * 365);
  const safeLimit = clampInt(limit, 150, 1, 1000);
  const safeOffset = clampInt(offset, 0, 0, 500000);

  const rows = await executeQuery(
    `SELECT c.asset_id
     FROM ${TABLES.STICKER_ASSET_CLASSIFICATION} c
     LEFT JOIN ${TABLES.STICKER_ASSET_REPROCESS_QUEUE} q
       ON q.asset_id = c.asset_id
       AND q.reason = 'LOW_CONFIDENCE'
       AND q.status IN ('pending', 'processing')
     WHERE c.confidence IS NOT NULL
       AND c.confidence < ?
       AND c.updated_at <= (UTC_TIMESTAMP() - INTERVAL ${safeStaleHours} HOUR)
       AND q.id IS NULL
     ORDER BY c.confidence ASC, c.updated_at ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [threshold],
    connection,
  );

  return rows.map((row) => row.asset_id).filter(Boolean);
}

export async function listAssetsForPrioritySignalBackfillReprocess(
  { limit = 200, offset = 0 } = {},
  connection = null,
) {
  const safeLimit = clampInt(limit, 200, 1, 2000);
  const safeOffset = clampInt(offset, 0, 0, 500000);
  const rows = await executeQuery(
    `SELECT
       c.asset_id,
       MAX(
         (CASE WHEN c.category IS NULL OR TRIM(c.category) = '' THEN 1 ELSE 0 END)
         + (CASE WHEN c.confidence IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN c.entropy IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN c.confidence_margin IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN c.affinity_weight IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN c.image_hash IS NULL OR TRIM(c.image_hash) = '' THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(JSON_LENGTH(c.all_scores), 0) = 0 THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(JSON_LENGTH(c.top_labels), 0) = 0 THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(JSON_LENGTH(c.llm_subtags), 0) = 0 THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(JSON_LENGTH(c.llm_style_traits), 0) = 0 THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(JSON_LENGTH(c.llm_emotions), 0) = 0 THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(JSON_LENGTH(c.llm_pack_suggestions), 0) = 0 THEN 1 ELSE 0 END)
         + (CASE WHEN c.semantic_cluster_id IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN c.semantic_cluster_slug IS NULL OR TRIM(c.semantic_cluster_slug) = '' THEN 1 ELSE 0 END)
       ) AS missing_signal_score
     FROM ${TABLES.STICKER_ASSET_CLASSIFICATION} c
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i ON i.sticker_id = c.asset_id
     LEFT JOIN ${TABLES.STICKER_PACK} p ON p.id = i.pack_id AND p.deleted_at IS NULL
     LEFT JOIN ${TABLES.STICKER_PACK_ENGAGEMENT} e ON e.pack_id = p.id
     LEFT JOIN ${TABLES.STICKER_ASSET_REPROCESS_QUEUE} q
       ON q.asset_id = c.asset_id
       AND q.reason = 'MODEL_UPGRADE'
       AND q.status IN ('pending', 'processing')
     WHERE q.id IS NULL
     GROUP BY c.asset_id
     HAVING missing_signal_score > 0
     ORDER BY
       missing_signal_score DESC,
       MAX(CASE WHEN p.pack_status = 'ready' THEN 1 ELSE 0 END) DESC,
       MAX(CASE WHEN p.visibility = 'public' THEN 1 ELSE 0 END) DESC,
       MAX(COALESCE(e.like_count, 0) + COALESCE(e.open_count, 0) * 0.02) DESC,
       COUNT(i.pack_id) DESC,
       MAX(c.updated_at) ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [],
    connection,
  );

  return rows.map((row) => row.asset_id).filter(Boolean);
}

export async function listStickerClassificationsForDeterministicReprocess(
  {
    limit = 250,
    cursorAssetId = '',
    entropyThreshold = 0.8,
    affinityThreshold = 0.3,
  } = {},
  connection = null,
) {
  const safeLimit = clampInt(limit, 250, 1, 2000);
  const normalizedCursor = String(cursorAssetId || '').trim();
  const normalizedEntropyThreshold = Number.isFinite(Number(entropyThreshold))
    ? Number(entropyThreshold)
    : 0.8;
  const normalizedAffinityThreshold = Number.isFinite(Number(affinityThreshold))
    ? Number(affinityThreshold)
    : 0.3;

  const params = [normalizedEntropyThreshold, normalizedAffinityThreshold];
  const cursorClause = normalizedCursor ? 'AND c.asset_id > ?' : '';
  if (normalizedCursor) {
    params.push(normalizedCursor);
  }

  const rows = await executeQuery(
    `SELECT
       c.asset_id,
       c.top_labels,
       c.llm_subtags,
       c.llm_style_traits,
       c.llm_emotions,
       c.llm_pack_suggestions,
       c.affinity_weight,
       c.entropy,
       c.ambiguous
     FROM ${TABLES.STICKER_ASSET_CLASSIFICATION} c
     WHERE (
       c.ambiguous = 1
       OR COALESCE(c.entropy, 0) > ?
       OR COALESCE(c.affinity_weight, 0) < ?
     )
     ${cursorClause}
     ORDER BY c.asset_id ASC
     LIMIT ${safeLimit}`,
    params,
    connection,
  );

  return rows.map((row) => normalizeClassificationRow(row));
}

export async function updateStickerClassificationDeterministicSignals(
  assetId,
  { llmSubtags = [], affinityWeight = null, ambiguous = 0 } = {},
  connection = null,
) {
  if (!assetId) return null;
  const normalizedAffinityWeight = Number.isFinite(Number(affinityWeight))
    ? Math.max(0, Math.min(1, Number(affinityWeight)))
    : null;
  const normalizedAmbiguous = ambiguous === 1 || ambiguous === true ? 1 : 0;
  const normalizedSubtags = Array.isArray(llmSubtags)
    ? llmSubtags.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  await executeQuery(
    `UPDATE ${TABLES.STICKER_ASSET_CLASSIFICATION}
     SET llm_subtags = ?, affinity_weight = ?, ambiguous = ?, updated_at = CURRENT_TIMESTAMP
     WHERE asset_id = ?`,
    [
      JSON.stringify(normalizedSubtags),
      normalizedAffinityWeight,
      normalizedAmbiguous,
      assetId,
    ],
    connection,
  );

  return findStickerClassificationByAssetId(assetId, connection);
}

export async function listClassificationCategoryDistribution({ days = 7 } = {}, connection = null) {
  const safeDays = clampInt(days, 7, 1, 365);
  const rows = await executeQuery(
    `SELECT
       LOWER(TRIM(COALESCE(category, 'unknown'))) AS category,
       COUNT(*) AS total
     FROM ${TABLES.STICKER_ASSET_CLASSIFICATION}
     WHERE updated_at >= (UTC_TIMESTAMP() - INTERVAL ${safeDays} DAY)
     GROUP BY LOWER(TRIM(COALESCE(category, 'unknown')))`,
    [],
    connection,
  );

  const distribution = new Map();
  let total = 0;
  for (const row of rows) {
    const category = String(row.category || 'unknown').trim() || 'unknown';
    const count = Number(row.total || 0);
    if (!count) continue;
    distribution.set(category, count);
    total += count;
  }

  return {
    days: safeDays,
    total,
    categories: distribution,
  };
}
