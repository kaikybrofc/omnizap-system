import { executeQuery, TABLES } from '../../../database/index.js';

const normalizeEngagementRow = (row) => ({
  pack_id: row?.pack_id || null,
  open_count: Number(row?.open_count || 0),
  like_count: Number(row?.like_count || 0),
  dislike_count: Number(row?.dislike_count || 0),
  score: Number(row?.like_count || 0) - Number(row?.dislike_count || 0),
  updated_at: row?.updated_at || null,
});

const EMPTY_ENGAGEMENT = Object.freeze({
  open_count: 0,
  like_count: 0,
  dislike_count: 0,
  score: 0,
  updated_at: null,
});

export const getEmptyStickerPackEngagement = () => ({ ...EMPTY_ENGAGEMENT });

export async function listStickerPackEngagementByPackIds(packIds, connection = null) {
  const ids = Array.from(new Set((Array.isArray(packIds) ? packIds : []).filter(Boolean)));
  if (!ids.length) return new Map();

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await executeQuery(
    `SELECT pack_id, open_count, like_count, dislike_count, updated_at
     FROM ${TABLES.STICKER_PACK_ENGAGEMENT}
     WHERE pack_id IN (${placeholders})`,
    ids,
    connection,
  );

  const byPackId = new Map();
  rows.forEach((row) => {
    const normalized = normalizeEngagementRow(row);
    if (normalized.pack_id) byPackId.set(normalized.pack_id, normalized);
  });
  return byPackId;
}

export async function getStickerPackEngagementByPackId(packId, connection = null) {
  if (!packId) return getEmptyStickerPackEngagement();
  const rows = await executeQuery(
    `SELECT pack_id, open_count, like_count, dislike_count, updated_at
     FROM ${TABLES.STICKER_PACK_ENGAGEMENT}
     WHERE pack_id = ?
     LIMIT 1`,
    [packId],
    connection,
  );

  if (!rows?.[0]) return getEmptyStickerPackEngagement();
  return normalizeEngagementRow(rows[0]);
}

export async function incrementStickerPackOpen(packId, connection = null) {
  if (!packId) return getEmptyStickerPackEngagement();

  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_PACK_ENGAGEMENT}
      (pack_id, open_count, like_count, dislike_count, last_opened_at)
     VALUES (?, 1, 0, 0, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       open_count = open_count + 1,
       last_opened_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [packId],
    connection,
  );

  return getStickerPackEngagementByPackId(packId, connection);
}

export async function incrementStickerPackLike(packId, connection = null) {
  if (!packId) return getEmptyStickerPackEngagement();

  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_PACK_ENGAGEMENT}
      (pack_id, open_count, like_count, dislike_count)
     VALUES (?, 0, 1, 0)
     ON DUPLICATE KEY UPDATE
       like_count = like_count + 1,
       updated_at = CURRENT_TIMESTAMP`,
    [packId],
    connection,
  );

  return getStickerPackEngagementByPackId(packId, connection);
}

export async function incrementStickerPackDislike(packId, connection = null) {
  if (!packId) return getEmptyStickerPackEngagement();

  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_PACK_ENGAGEMENT}
      (pack_id, open_count, like_count, dislike_count)
     VALUES (?, 0, 0, 1)
     ON DUPLICATE KEY UPDATE
       dislike_count = dislike_count + 1,
       updated_at = CURRENT_TIMESTAMP`,
    [packId],
    connection,
  );

  return getStickerPackEngagementByPackId(packId, connection);
}
