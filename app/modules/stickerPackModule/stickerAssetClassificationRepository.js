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

const normalizeClassificationRow = (row) => {
  if (!row) return null;

  return {
    asset_id: row.asset_id,
    provider: row.provider || 'clip',
    model_name: row.model_name || null,
    classification_version: row.classification_version || 'v1',
    category: row.category || null,
    confidence: row.confidence !== null && row.confidence !== undefined ? Number(row.confidence) : null,
    nsfw_score: row.nsfw_score !== null && row.nsfw_score !== undefined ? Number(row.nsfw_score) : null,
    is_nsfw: row.is_nsfw === 1 || row.is_nsfw === true,
    all_scores: parseJson(row.all_scores, {}),
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
      (asset_id, provider, model_name, classification_version, category, confidence, nsfw_score, is_nsfw, all_scores, classified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
      provider = VALUES(provider),
      model_name = VALUES(model_name),
      classification_version = VALUES(classification_version),
      category = VALUES(category),
      confidence = VALUES(confidence),
      nsfw_score = VALUES(nsfw_score),
      is_nsfw = VALUES(is_nsfw),
      all_scores = VALUES(all_scores),
      classified_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP`,
    [
      payload.asset_id,
      payload.provider || 'clip',
      payload.model_name || null,
      payload.classification_version || 'v1',
      payload.category || null,
      payload.confidence ?? null,
      payload.nsfw_score ?? null,
      payload.is_nsfw ? 1 : 0,
      payload.all_scores ? JSON.stringify(payload.all_scores) : JSON.stringify({}),
    ],
    connection,
  );

  return findStickerClassificationByAssetId(payload.asset_id, connection);
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
