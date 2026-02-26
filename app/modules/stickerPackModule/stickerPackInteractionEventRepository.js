import { executeQuery, TABLES } from '../../../database/index.js';

const clamp = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const normalizeInteraction = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['open', 'like', 'dislike'].includes(normalized)) return normalized;
  return null;
};

const sanitizeKey = (value, maxLength = 120) => {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
  return normalized || null;
};

export async function createStickerPackInteractionEvent(
  { packId, interaction, actorKey = null, sessionKey = null, source = null },
  connection = null,
) {
  const normalizedInteraction = normalizeInteraction(interaction);
  if (!packId || !normalizedInteraction) return false;

  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_PACK_INTERACTION_EVENT}
      (pack_id, interaction, actor_key, session_key, source)
     VALUES (?, ?, ?, ?, ?)`,
    [packId, normalizedInteraction, sanitizeKey(actorKey), sanitizeKey(sessionKey), sanitizeKey(source, 32)],
    connection,
  );
  return true;
}

export async function listStickerPackInteractionStatsByPackIds(
  packIds,
  { horizonHours = 24, baselineDays = 7 } = {},
  connection = null,
) {
  const ids = Array.from(new Set((Array.isArray(packIds) ? packIds : []).filter(Boolean)));
  if (!ids.length) return new Map();

  const safeHorizonHours = clamp(horizonHours, 24, 1, 240);
  const safeBaselineDays = clamp(baselineDays, 7, 2, 60);
  const placeholders = ids.map(() => '?').join(', ');

  const rows = await executeQuery(
    `SELECT
       pack_id,
       SUM(CASE WHEN interaction = 'open' AND created_at >= (UTC_TIMESTAMP() - INTERVAL ${safeHorizonHours} HOUR) THEN 1 ELSE 0 END) AS open_horizon,
       SUM(CASE WHEN interaction = 'open' AND created_at >= (UTC_TIMESTAMP() - INTERVAL ${safeBaselineDays} DAY) THEN 1 ELSE 0 END) AS open_baseline,
       SUM(CASE WHEN interaction = 'like' AND created_at >= (UTC_TIMESTAMP() - INTERVAL ${safeHorizonHours} HOUR) THEN 1 ELSE 0 END) AS like_horizon,
       SUM(CASE WHEN interaction = 'like' AND created_at >= (UTC_TIMESTAMP() - INTERVAL ${safeBaselineDays} DAY) THEN 1 ELSE 0 END) AS like_baseline,
       SUM(CASE WHEN interaction = 'dislike' AND created_at >= (UTC_TIMESTAMP() - INTERVAL ${safeHorizonHours} HOUR) THEN 1 ELSE 0 END) AS dislike_horizon,
       SUM(CASE WHEN interaction = 'dislike' AND created_at >= (UTC_TIMESTAMP() - INTERVAL ${safeBaselineDays} DAY) THEN 1 ELSE 0 END) AS dislike_baseline
     FROM ${TABLES.STICKER_PACK_INTERACTION_EVENT}
     WHERE pack_id IN (${placeholders})
     GROUP BY pack_id`,
    ids,
    connection,
  );

  const byPackId = new Map();
  for (const row of rows) {
    byPackId.set(row.pack_id, {
      pack_id: row.pack_id,
      open_horizon: Number(row.open_horizon || 0),
      open_baseline: Number(row.open_baseline || 0),
      like_horizon: Number(row.like_horizon || 0),
      like_baseline: Number(row.like_baseline || 0),
      dislike_horizon: Number(row.dislike_horizon || 0),
      dislike_baseline: Number(row.dislike_baseline || 0),
    });
  }
  return byPackId;
}

export async function listViewerRecentPackIds(
  viewerKey,
  { days = 30, limit = 120 } = {},
  connection = null,
) {
  const normalizedViewer = sanitizeKey(viewerKey);
  if (!normalizedViewer) return [];

  const safeDays = clamp(days, 30, 1, 180);
  const safeLimit = clamp(limit, 120, 5, 500);
  const rows = await executeQuery(
    `SELECT pack_id, COUNT(*) AS interactions, MAX(created_at) AS last_interaction_at
     FROM ${TABLES.STICKER_PACK_INTERACTION_EVENT}
     WHERE actor_key = ?
       AND created_at >= (UTC_TIMESTAMP() - INTERVAL ${safeDays} DAY)
     GROUP BY pack_id
     ORDER BY interactions DESC, last_interaction_at DESC
     LIMIT ${safeLimit}`,
    [normalizedViewer],
    connection,
  );

  return rows.map((row) => ({
    pack_id: row.pack_id,
    interactions: Number(row.interactions || 0),
    last_interaction_at: row.last_interaction_at || null,
  }));
}
