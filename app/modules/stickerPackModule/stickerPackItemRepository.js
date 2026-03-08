import { executeQuery, TABLES } from '../../../database/index.js';

/**
 * Faz parse resiliente de JSON vindo do banco.
 *
 * @param {unknown} value Valor bruto.
 * @param {unknown} [fallback=null] Valor fallback em caso de erro.
 * @returns {unknown} Valor convertido ou fallback.
 */
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

/**
 * Normaliza um item do pack com dados opcionais de asset.
 *
 * @param {Record<string, unknown>|null|undefined} row Linha crua retornada da query.
 * @returns {object|null} Item normalizado.
 */
const normalizeItemRow = (row) => {
  if (!row) return null;

  return {
    id: row.id,
    pack_id: row.pack_id,
    sticker_id: row.sticker_id,
    position: Number(row.position || 0),
    emojis: parseJson(row.emojis, []),
    accessibility_label: row.accessibility_label || null,
    created_at: row.created_at,
    asset: row.asset_id
      ? {
          id: row.asset_id,
          owner_jid: row.asset_owner_jid,
          sha256: row.asset_sha256,
          mimetype: row.asset_mimetype,
          is_animated: row.asset_is_animated === 1 || row.asset_is_animated === true,
          width: row.asset_width !== null && row.asset_width !== undefined ? Number(row.asset_width) : null,
          height: row.asset_height !== null && row.asset_height !== undefined ? Number(row.asset_height) : null,
          size_bytes: row.asset_size_bytes !== null && row.asset_size_bytes !== undefined ? Number(row.asset_size_bytes) : 0,
          storage_path: row.asset_storage_path,
          created_at: row.asset_created_at,
        }
      : null,
  };
};

/**
 * Lista itens de um pack em ordem de posição.
 *
 * @param {string} packId ID do pack.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object[]>} Itens do pack.
 */
export async function listStickerPackItems(packId, connection = null) {
  const rows = await executeQuery(
    `SELECT
       i.*,
       a.id AS asset_id,
       a.owner_jid AS asset_owner_jid,
       a.sha256 AS asset_sha256,
       a.mimetype AS asset_mimetype,
       a.is_animated AS asset_is_animated,
       a.width AS asset_width,
       a.height AS asset_height,
       a.size_bytes AS asset_size_bytes,
       a.storage_path AS asset_storage_path,
       a.created_at AS asset_created_at
     FROM ${TABLES.STICKER_PACK_ITEM} i
     LEFT JOIN ${TABLES.STICKER_ASSET} a ON a.id = i.sticker_id
     WHERE i.pack_id = ?
     ORDER BY i.position ASC`,
    [packId],
    connection,
  );

  return rows.map((row) => normalizeItemRow(row));
}

/**
 * Lista itens de múltiplos packs em uma única consulta.
 *
 * @param {string[]} packIds IDs dos packs.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null]
 * @returns {Promise<object[]>}
 */
export async function listStickerPackItemsByPackIds(packIds, connection = null) {
  if (!Array.isArray(packIds) || packIds.length === 0) return [];
  const uniquePackIds = Array.from(new Set(packIds.filter(Boolean)));
  if (!uniquePackIds.length) return [];

  const placeholders = uniquePackIds.map(() => '?').join(', ');
  const rows = await executeQuery(
    `SELECT
       i.*,
       a.id AS asset_id,
       a.owner_jid AS asset_owner_jid,
       a.sha256 AS asset_sha256,
       a.mimetype AS asset_mimetype,
       a.is_animated AS asset_is_animated,
       a.width AS asset_width,
       a.height AS asset_height,
       a.size_bytes AS asset_size_bytes,
       a.storage_path AS asset_storage_path,
       a.created_at AS asset_created_at
     FROM ${TABLES.STICKER_PACK_ITEM} i
     LEFT JOIN ${TABLES.STICKER_ASSET} a ON a.id = i.sticker_id
     WHERE i.pack_id IN (${placeholders})
     ORDER BY i.pack_id ASC, i.position ASC`,
    uniquePackIds,
    connection,
  );

  return rows.map((row) => normalizeItemRow(row));
}

/**
 * Busca item do pack pelo sticker_id.
 *
 * @param {string} packId ID do pack.
 * @param {string} stickerId ID do asset/sticker.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Item encontrado.
 */
export async function getStickerPackItemByStickerId(packId, stickerId, connection = null) {
  const rows = await executeQuery(
    `SELECT i.* FROM ${TABLES.STICKER_PACK_ITEM} i
     WHERE i.pack_id = ? AND i.sticker_id = ?
     LIMIT 1`,
    [packId, stickerId],
    connection,
  );

  return normalizeItemRow(rows?.[0] || null);
}

/**
 * Busca item pela posição ordinal no pack.
 *
 * @param {string} packId ID do pack.
 * @param {number} position Posição do item.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Item encontrado.
 */
export async function getStickerPackItemByPosition(packId, position, connection = null) {
  const rows = await executeQuery(
    `SELECT i.* FROM ${TABLES.STICKER_PACK_ITEM} i
     WHERE i.pack_id = ? AND i.position = ?
     LIMIT 1`,
    [packId, position],
    connection,
  );

  return normalizeItemRow(rows?.[0] || null);
}

/**
 * Conta quantos itens existem em um pack.
 *
 * @param {string} packId ID do pack.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<number>} Total de itens.
 */
export async function countStickerPackItems(packId, connection = null) {
  const rows = await executeQuery(`SELECT COUNT(*) AS total FROM ${TABLES.STICKER_PACK_ITEM} WHERE pack_id = ?`, [packId], connection);

  return Number(rows?.[0]?.total || 0);
}

/**
 * Conta quantas referências um sticker possui em todos os packs.
 *
 * @param {string} stickerId ID do sticker/asset.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<number>} Total de referências em packs.
 */
export async function countStickerPackItemRefsByStickerId(stickerId, connection = null) {
  const rows = await executeQuery(`SELECT COUNT(*) AS total FROM ${TABLES.STICKER_PACK_ITEM} WHERE sticker_id = ?`, [stickerId], connection);

  return Number(rows?.[0]?.total || 0);
}

/**
 * Lista IDs de packs que referenciam um sticker.
 *
 * @param {string} stickerId ID do sticker/asset.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null]
 * @returns {Promise<string[]>}
 */
export async function listPackIdsByStickerId(stickerId, connection = null) {
  const rows = await executeQuery(
    `SELECT DISTINCT pack_id
     FROM ${TABLES.STICKER_PACK_ITEM}
     WHERE sticker_id = ?`,
    [stickerId],
    connection,
  );
  return (Array.isArray(rows) ? rows : []).map((row) => String(row?.pack_id || '')).filter(Boolean);
}

/**
 * Obtém a maior posição atualmente usada no pack.
 *
 * @param {string} packId ID do pack.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<number>} Maior posição encontrada.
 */
export async function getMaxStickerPackPosition(packId, connection = null) {
  const rows = await executeQuery(`SELECT MAX(position) AS max_position FROM ${TABLES.STICKER_PACK_ITEM} WHERE pack_id = ?`, [packId], connection);

  const maxValue = rows?.[0]?.max_position;
  return maxValue !== null && maxValue !== undefined ? Number(maxValue) : 0;
}

/**
 * Cria um novo item dentro de um pack.
 *
 * @param {object} item Dados do item.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Item criado.
 */
export async function createStickerPackItem(item, connection = null) {
  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_PACK_ITEM}
      (id, pack_id, sticker_id, position, emojis, accessibility_label)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [item.id, item.pack_id, item.sticker_id, item.position, item.emojis ? JSON.stringify(item.emojis) : JSON.stringify([]), item.accessibility_label ?? null],
    connection,
  );

  return getStickerPackItemByStickerId(item.pack_id, item.sticker_id, connection);
}

/**
 * Atualiza metadados do item (emojis/acessibilidade).
 *
 * @param {string} packId ID do pack.
 * @param {string} stickerId ID do sticker.
 * @param {Record<string, unknown>} fields Campos alteráveis.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Item atualizado.
 */
export async function updateStickerPackItemMetadata(packId, stickerId, fields, connection = null) {
  const clauses = [];
  const params = [];

  if ('emojis' in fields) {
    clauses.push('emojis = ?');
    params.push(fields.emojis ? JSON.stringify(fields.emojis) : JSON.stringify([]));
  }

  if ('accessibility_label' in fields) {
    clauses.push('accessibility_label = ?');
    params.push(fields.accessibility_label ?? null);
  }

  if (!clauses.length) {
    return getStickerPackItemByStickerId(packId, stickerId, connection);
  }

  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK_ITEM}
     SET ${clauses.join(', ')}
     WHERE pack_id = ? AND sticker_id = ?`,
    [...params, packId, stickerId],
    connection,
  );

  return getStickerPackItemByStickerId(packId, stickerId, connection);
}

/**
 * Remove item por sticker_id e retorna o item removido.
 *
 * @param {string} packId ID do pack.
 * @param {string} stickerId ID do sticker.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Item removido.
 */
export async function removeStickerPackItemByStickerId(packId, stickerId, connection = null) {
  const item = await getStickerPackItemByStickerId(packId, stickerId, connection);
  if (!item) return null;

  await executeQuery(
    `DELETE FROM ${TABLES.STICKER_PACK_ITEM}
     WHERE pack_id = ? AND sticker_id = ?`,
    [packId, stickerId],
    connection,
  );

  return item;
}

/**
 * Remove item por posição e retorna o item removido.
 *
 * @param {string} packId ID do pack.
 * @param {number} position Posição do item.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Item removido.
 */
export async function removeStickerPackItemByPosition(packId, position, connection = null) {
  const item = await getStickerPackItemByPosition(packId, position, connection);
  if (!item) return null;

  await executeQuery(
    `DELETE FROM ${TABLES.STICKER_PACK_ITEM}
     WHERE pack_id = ? AND position = ?`,
    [packId, position],
    connection,
  );

  return item;
}

/**
 * Remove todos os itens de um pack.
 *
 * @param {string} packId ID do pack.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<number>} Quantidade de linhas removidas.
 */
export async function removeStickerPackItemsByPackId(packId, connection = null) {
  const result = await executeQuery(
    `DELETE FROM ${TABLES.STICKER_PACK_ITEM}
     WHERE pack_id = ?`,
    [packId],
    connection,
  );

  return Number(result?.affectedRows || 0);
}

/**
 * Reordena automaticamente os itens após remover uma posição.
 *
 * @param {string} packId ID do pack.
 * @param {number} removedPosition Posição removida.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<void>}
 */
export async function shiftStickerPackPositionsAfter(packId, removedPosition, connection = null) {
  const SHIFT_OFFSET = 10000;

  // Fase 1: move posições para uma faixa temporária, evitando colisão no índice único (pack_id, position).
  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK_ITEM}
     SET position = position + ?
     WHERE pack_id = ? AND position > ?`,
    [SHIFT_OFFSET, packId, removedPosition],
    connection,
  );

  // Fase 2: normaliza removendo o offset e deslocando 1 posição para preencher o "gap" do item removido.
  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK_ITEM}
     SET position = position - ?
     WHERE pack_id = ? AND position > ?`,
    [SHIFT_OFFSET + 1, packId, removedPosition + SHIFT_OFFSET],
    connection,
  );
}

/**
 * Aplica uma nova ordem explícita para os stickers do pack.
 *
 * @param {string} packId ID do pack.
 * @param {string[]} orderedStickerIds IDs na ordem desejada.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<void>}
 */
export async function bulkUpdateStickerPackPositions(packId, orderedStickerIds, connection = null) {
  if (!Array.isArray(orderedStickerIds) || orderedStickerIds.length === 0) return;

  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK_ITEM}
     SET position = position + 10000
     WHERE pack_id = ?`,
    [packId],
    connection,
  );

  for (let index = 0; index < orderedStickerIds.length; index += 1) {
    const stickerId = orderedStickerIds[index];
    await executeQuery(
      `UPDATE ${TABLES.STICKER_PACK_ITEM}
       SET position = ?
       WHERE pack_id = ? AND sticker_id = ?`,
      [index + 1, packId, stickerId],
      connection,
    );
  }
}

/**
 * Clona todos os itens de um pack para outro.
 *
 * @param {string} sourcePackId Pack de origem.
 * @param {string} targetPackId Pack de destino.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<void>}
 */
export async function cloneStickerPackItems(sourcePackId, targetPackId, connection = null) {
  const items = await listStickerPackItems(sourcePackId, connection);
  for (const item of items) {
    await executeQuery(
      `INSERT INTO ${TABLES.STICKER_PACK_ITEM}
        (id, pack_id, sticker_id, position, emojis, accessibility_label)
       VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [targetPackId, item.sticker_id, item.position, item.emojis ? JSON.stringify(item.emojis) : JSON.stringify([]), item.accessibility_label ?? null],
      connection,
    );
  }
}
