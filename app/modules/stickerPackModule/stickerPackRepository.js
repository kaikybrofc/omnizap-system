import { executeQuery, TABLES } from '../../../database/index.js';

const normalizeStickerPackRow = (row) => {
  if (!row) return null;

  return {
    id: row.id,
    owner_jid: row.owner_jid,
    name: row.name,
    publisher: row.publisher,
    description: row.description,
    pack_key: row.pack_key,
    cover_sticker_id: row.cover_sticker_id,
    visibility: row.visibility,
    version: Number(row.version || 1),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    sticker_count: row.sticker_count !== null && row.sticker_count !== undefined ? Number(row.sticker_count) : undefined,
  };
};

export async function findStickerPackById(packId, { includeDeleted = false, connection = null } = {}) {
  const rows = await executeQuery(
    `SELECT p.*,
      (SELECT COUNT(*) FROM ${TABLES.STICKER_PACK_ITEM} i WHERE i.pack_id = p.id) AS sticker_count
     FROM ${TABLES.STICKER_PACK} p
     WHERE p.id = ? ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
     LIMIT 1`,
    [packId],
    connection,
  );

  return normalizeStickerPackRow(rows?.[0] || null);
}

export async function findStickerPackByPackKey(packKey, { includeDeleted = false, connection = null } = {}) {
  const rows = await executeQuery(
    `SELECT p.*,
      (SELECT COUNT(*) FROM ${TABLES.STICKER_PACK_ITEM} i WHERE i.pack_id = p.id) AS sticker_count
     FROM ${TABLES.STICKER_PACK} p
     WHERE p.pack_key = ? ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
     LIMIT 1`,
    [packKey],
    connection,
  );

  return normalizeStickerPackRow(rows?.[0] || null);
}

export async function findStickerPackByOwnerAndIdentifier(
  ownerJid,
  identifier,
  { includeDeleted = false, connection = null } = {},
) {
  if (!identifier) return null;

  const idOrPack = await executeQuery(
    `SELECT p.*,
      (SELECT COUNT(*) FROM ${TABLES.STICKER_PACK_ITEM} i WHERE i.pack_id = p.id) AS sticker_count
     FROM ${TABLES.STICKER_PACK} p
     WHERE p.owner_jid = ?
       ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
       AND (p.id = ? OR p.pack_key = ?)
     ORDER BY p.updated_at DESC
     LIMIT 1`,
    [ownerJid, identifier, identifier],
    connection,
  );

  if (idOrPack?.[0]) {
    return normalizeStickerPackRow(idOrPack[0]);
  }

  const byName = await executeQuery(
    `SELECT p.*,
      (SELECT COUNT(*) FROM ${TABLES.STICKER_PACK_ITEM} i WHERE i.pack_id = p.id) AS sticker_count
     FROM ${TABLES.STICKER_PACK} p
     WHERE p.owner_jid = ?
       ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
       AND LOWER(p.name) = LOWER(?)
     ORDER BY p.updated_at DESC
     LIMIT 1`,
    [ownerJid, identifier],
    connection,
  );

  return normalizeStickerPackRow(byName?.[0] || null);
}

export async function listStickerPacksByOwner(
  ownerJid,
  { includeDeleted = false, limit = 50, offset = 0, connection = null } = {},
) {
  const safeLimit = Math.max(1, Number(limit) || 50);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const rows = await executeQuery(
    `SELECT p.*,
      (SELECT COUNT(*) FROM ${TABLES.STICKER_PACK_ITEM} i WHERE i.pack_id = p.id) AS sticker_count
     FROM ${TABLES.STICKER_PACK} p
     WHERE p.owner_jid = ? ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
     ORDER BY p.updated_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [ownerJid],
    connection,
  );

  return rows.map((row) => normalizeStickerPackRow(row));
}

export async function createStickerPack(pack, connection = null) {
  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_PACK}
      (id, owner_jid, name, publisher, description, pack_key, cover_sticker_id, visibility, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pack.id,
      pack.owner_jid,
      pack.name,
      pack.publisher,
      pack.description ?? null,
      pack.pack_key,
      pack.cover_sticker_id ?? null,
      pack.visibility,
      pack.version ?? 1,
    ],
    connection,
  );

  return findStickerPackById(pack.id, { includeDeleted: true, connection });
}

const UPDATE_FIELD_MAP = {
  name: 'name',
  publisher: 'publisher',
  description: 'description',
  pack_key: 'pack_key',
  cover_sticker_id: 'cover_sticker_id',
  visibility: 'visibility',
  deleted_at: 'deleted_at',
};

export async function updateStickerPackFields(packId, fields, connection = null) {
  const setClauses = [];
  const params = [];

  for (const [field, column] of Object.entries(UPDATE_FIELD_MAP)) {
    if (!(field in fields)) continue;
    setClauses.push(`${column} = ?`);
    params.push(fields[field]);
  }

  if (!setClauses.length) {
    return findStickerPackById(packId, { includeDeleted: true, connection });
  }

  setClauses.push('version = version + 1');
  setClauses.push('updated_at = CURRENT_TIMESTAMP');

  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK}
     SET ${setClauses.join(', ')}
     WHERE id = ?`,
    [...params, packId],
    connection,
  );

  return findStickerPackById(packId, { includeDeleted: true, connection });
}

export async function softDeleteStickerPack(packId, connection = null) {
  return updateStickerPackFields(
    packId,
    {
      deleted_at: new Date(),
    },
    connection,
  );
}

export async function ensureUniquePackKey(packKey, connection = null) {
  const existing = await findStickerPackByPackKey(packKey, { includeDeleted: true, connection });
  return !existing;
}

export async function bumpStickerPackVersion(packId, connection = null) {
  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK}
     SET version = version + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [packId],
    connection,
  );

  return findStickerPackById(packId, { includeDeleted: true, connection });
}
