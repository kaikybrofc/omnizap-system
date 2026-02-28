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

const clampScore = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(6));
};

const normalizeNsfwLevel = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (['safe', 'suggestive', 'explicit'].includes(normalized)) return normalized;
  return 'safe';
};

const normalizeRow = (row) => {
  if (!row) return null;
  const scoresFromJson = parseJson(row.scores_json, {}) || {};
  return {
    pack_id: row.pack_id,
    ranking_score: clampScore(row.ranking_score),
    pack_score: clampScore(row.pack_score),
    trend_score: clampScore(row.trend_score),
    quality_score: clampScore(row.quality_score),
    engagement_score: clampScore(row.engagement_score),
    diversity_score: clampScore(row.diversity_score),
    cohesion_score: clampScore(row.cohesion_score),
    sensitive_content: row.sensitive_content === 1 || row.sensitive_content === true,
    nsfw_level: normalizeNsfwLevel(row.nsfw_level),
    sticker_count: Number(row.sticker_count || 0),
    tags: Array.isArray(parseJson(row.tags, [])) ? parseJson(row.tags, []) : [],
    source_version: row.source_version || 'v1',
    refreshed_at: row.refreshed_at || null,
    updated_at: row.updated_at || null,
    signals: {
      ...scoresFromJson,
      quality_score: clampScore(row.quality_score),
      engagement_score: clampScore(row.engagement_score),
      diversity_score: clampScore(row.diversity_score),
      cohesion_score: clampScore(row.cohesion_score),
      trend_score: clampScore(row.trend_score),
      pack_score: clampScore(row.pack_score),
      ranking_score: clampScore(row.ranking_score),
      nsfw_level: normalizeNsfwLevel(row.nsfw_level),
      sensitive_content: row.sensitive_content === 1 || row.sensitive_content === true,
    },
  };
};

const normalizeSnapshotInput = (entry) => {
  if (!entry?.pack_id) return null;
  const signals = entry?.signals && typeof entry.signals === 'object' ? entry.signals : {};
  return {
    pack_id: String(entry.pack_id),
    ranking_score: clampScore(signals.ranking_score),
    pack_score: clampScore(signals.pack_score),
    trend_score: clampScore(signals.trend_score),
    quality_score: clampScore(signals.quality_score),
    engagement_score: clampScore(signals.engagement_score),
    diversity_score: clampScore(signals.diversity_score),
    cohesion_score: clampScore(signals.cohesion_score),
    sensitive_content: signals.sensitive_content === true || signals.sensitive_content === 1 ? 1 : 0,
    nsfw_level: normalizeNsfwLevel(signals.nsfw_level),
    sticker_count: Math.max(0, Number(entry.sticker_count || 0)),
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 30) : [],
    source_version:
      String(entry.source_version || 'v1')
        .trim()
        .slice(0, 32) || 'v1',
    scores_json: signals,
  };
};

export async function upsertStickerPackScoreSnapshots(entries = [], connection = null) {
  const normalized = (Array.isArray(entries) ? entries : []).map((entry) => normalizeSnapshotInput(entry)).filter(Boolean);
  if (!normalized.length) return 0;

  let written = 0;
  for (let offset = 0; offset < normalized.length; offset += 100) {
    const chunk = normalized.slice(offset, offset + 100);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())').join(', ');
    const params = chunk.flatMap((entry) => [entry.pack_id, entry.ranking_score, entry.pack_score, entry.trend_score, entry.quality_score, entry.engagement_score, entry.diversity_score, entry.cohesion_score, entry.sensitive_content, entry.nsfw_level, entry.sticker_count, JSON.stringify(entry.tags || []), JSON.stringify(entry.scores_json || {}), entry.source_version]);
    const result = await executeQuery(
      `INSERT INTO ${TABLES.STICKER_PACK_SCORE_SNAPSHOT}
        (
          pack_id,
          ranking_score,
          pack_score,
          trend_score,
          quality_score,
          engagement_score,
          diversity_score,
          cohesion_score,
          sensitive_content,
          nsfw_level,
          sticker_count,
          tags,
          scores_json,
          source_version,
          refreshed_at
        )
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
        ranking_score = VALUES(ranking_score),
        pack_score = VALUES(pack_score),
        trend_score = VALUES(trend_score),
        quality_score = VALUES(quality_score),
        engagement_score = VALUES(engagement_score),
        diversity_score = VALUES(diversity_score),
        cohesion_score = VALUES(cohesion_score),
        sensitive_content = VALUES(sensitive_content),
        nsfw_level = VALUES(nsfw_level),
        sticker_count = VALUES(sticker_count),
        tags = VALUES(tags),
        scores_json = VALUES(scores_json),
        source_version = VALUES(source_version),
        refreshed_at = UTC_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP`,
      params,
      connection,
    );
    written += Number(result?.affectedRows || 0);
  }

  return written;
}

export async function listStickerPackScoreSnapshotsByPackIds(packIds = [], connection = null) {
  const ids = Array.from(new Set((Array.isArray(packIds) ? packIds : []).filter(Boolean)));
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.STICKER_PACK_SCORE_SNAPSHOT}
     WHERE pack_id IN (${placeholders})`,
    ids,
    connection,
  );
  const byPackId = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const normalized = normalizeRow(row);
    if (!normalized?.pack_id) return;
    byPackId.set(normalized.pack_id, normalized);
  });
  return byPackId;
}

export async function removeSnapshotsForDeletedPacks(connection = null) {
  const result = await executeQuery(
    `DELETE s
       FROM ${TABLES.STICKER_PACK_SCORE_SNAPSHOT} s
       LEFT JOIN ${TABLES.STICKER_PACK} p ON p.id = s.pack_id
      WHERE p.id IS NULL OR p.deleted_at IS NOT NULL`,
    [],
    connection,
  );
  return Number(result?.affectedRows || 0);
}
