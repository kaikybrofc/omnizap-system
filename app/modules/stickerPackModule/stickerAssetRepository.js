import { executeQuery, TABLES } from '../../../database/index.js';
import { STICKER_DOMAIN_EVENTS } from './domainEvents.js';
import { publishStickerDomainEvent } from './stickerDomainEventBus.js';

/**
 * Converte valores numéricos/booleanos vindos do banco para booleano.
 *
 * @param {unknown} value Valor cru retornado da query.
 * @returns {boolean} Valor booleano normalizado.
 */
const toBool = (value) => value === true || value === 1;

/**
 * Normaliza uma linha da tabela de assets para o formato de domínio.
 *
 * @param {Record<string, unknown>|null|undefined} row Linha bruta da query.
 * @returns {object|null} Asset normalizado ou `null`.
 */
const normalizeStickerAssetRow = (row) => {
  if (!row) return null;

  return {
    id: row.id,
    owner_jid: row.owner_jid,
    sha256: row.sha256,
    mimetype: row.mimetype,
    is_animated: toBool(row.is_animated),
    width: row.width !== null && row.width !== undefined ? Number(row.width) : null,
    height: row.height !== null && row.height !== undefined ? Number(row.height) : null,
    size_bytes: row.size_bytes !== null && row.size_bytes !== undefined ? Number(row.size_bytes) : 0,
    storage_path: row.storage_path,
    created_at: row.created_at,
  };
};

/**
 * Busca um asset de figurinha pelo hash SHA-256.
 *
 * @param {string} sha256 Hash SHA-256 do arquivo.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Asset encontrado.
 */
export async function findStickerAssetBySha256(sha256, connection = null) {
  const rows = await executeQuery(
    `SELECT * FROM ${TABLES.STICKER_ASSET} WHERE sha256 = ? LIMIT 1`,
    [sha256],
    connection,
  );
  return normalizeStickerAssetRow(rows?.[0] || null);
}

/**
 * Busca um asset de figurinha pelo ID.
 *
 * @param {string} id ID do asset.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Asset encontrado.
 */
export async function findStickerAssetById(id, connection = null) {
  const rows = await executeQuery(`SELECT * FROM ${TABLES.STICKER_ASSET} WHERE id = ? LIMIT 1`, [id], connection);
  return normalizeStickerAssetRow(rows?.[0] || null);
}

/**
 * Busca múltiplos assets por ID preservando a ordem solicitada.
 *
 * @param {string[]} ids Lista de IDs.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object[]>} Lista de assets encontrados.
 */
export async function findStickerAssetsByIds(ids, connection = null) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await executeQuery(
    `SELECT * FROM ${TABLES.STICKER_ASSET} WHERE id IN (${placeholders})`,
    uniqueIds,
    connection,
  );

  const normalized = rows.map((row) => normalizeStickerAssetRow(row));
  const byId = new Map(normalized.map((row) => [row.id, row]));
  return uniqueIds.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Retorna o último asset salvo por um usuário.
 *
 * @param {string} ownerJid JID dono do asset.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Último asset encontrado.
 */
export async function findLatestStickerAssetByOwner(ownerJid, connection = null) {
  const rows = await executeQuery(
    `SELECT * FROM ${TABLES.STICKER_ASSET}
     WHERE owner_jid = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [ownerJid],
    connection,
  );

  return normalizeStickerAssetRow(rows?.[0] || null);
}

/**
 * Lista assets que ainda não possuem classificação associada.
 *
 * @param {{ limit?: number, connection?: import('mysql2/promise').PoolConnection|null }} [options]
 * @returns {Promise<object[]>} Assets pendentes de classificação.
 */
export async function listStickerAssetsPendingClassification({ limit = 50, connection = null } = {}) {
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 50));

  const rows = await executeQuery(
    `SELECT a.*
     FROM ${TABLES.STICKER_ASSET} a
     LEFT JOIN ${TABLES.STICKER_ASSET_CLASSIFICATION} c ON c.asset_id = a.id
     WHERE c.asset_id IS NULL
     ORDER BY a.created_at ASC
     LIMIT ${safeLimit}`,
    [],
    connection,
  );

  return rows.map((row) => normalizeStickerAssetRow(row));
}

/**
 * Lista assets que ainda não pertencem a nenhum pack.
 *
 * @param {{
 *   search?: string,
 *   limit?: number,
 *   offset?: number,
 *   connection?: import('mysql2/promise').PoolConnection|null,
 * }} [options] Filtros de listagem.
 * @returns {Promise<{ assets: object[], hasMore: boolean, total: number }>} Resultado paginado.
 */
export async function listStickerAssetsWithoutPack({ search = '', limit = 120, offset = 0, connection = null } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 120));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimitWithSentinel = safeLimit + 1;
  const normalizedSearch = String(search || '').trim().toLowerCase().slice(0, 140);

  const whereClauses = ['i.sticker_id IS NULL'];
  const params = [];

  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    whereClauses.push('(LOWER(a.sha256) LIKE ? OR LOWER(a.owner_jid) LIKE ? OR LOWER(a.storage_path) LIKE ?)');
    params.push(like, like, like);
  }

  const rows = await executeQuery(
    `SELECT a.*
     FROM ${TABLES.STICKER_ASSET} a
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i ON i.sticker_id = a.id
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT ${safeLimitWithSentinel} OFFSET ${safeOffset}`,
    params,
    connection,
  );

  const countRows = await executeQuery(
    `SELECT COUNT(*) AS total
     FROM ${TABLES.STICKER_ASSET} a
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i ON i.sticker_id = a.id
     WHERE ${whereClauses.join(' AND ')}`,
    params,
    connection,
  );

  const hasMore = rows.length > safeLimit;
  const total = Number(countRows?.[0]?.total || 0);
  return {
    assets: rows.slice(0, safeLimit).map((row) => normalizeStickerAssetRow(row)),
    hasMore,
    total,
  };
}

/**
 * Lista assets sem pack que já possuem classificação.
 *
 * @param {{
 *   search?: string,
 *   limit?: number,
 *   offset?: number,
 *   connection?: import('mysql2/promise').PoolConnection|null,
 * }} [options] Filtros de listagem.
 * @returns {Promise<{ assets: object[], hasMore: boolean, total: number }>} Resultado paginado.
 */
export async function listClassifiedStickerAssetsWithoutPack({ search = '', limit = 120, offset = 0, connection = null } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 120));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimitWithSentinel = safeLimit + 1;
  const normalizedSearch = String(search || '').trim().toLowerCase().slice(0, 140);

  const whereClauses = ['i.sticker_id IS NULL'];
  const params = [];

  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    whereClauses.push('(LOWER(a.sha256) LIKE ? OR LOWER(a.owner_jid) LIKE ? OR LOWER(a.storage_path) LIKE ?)');
    params.push(like, like, like);
  }

  const rows = await executeQuery(
    `SELECT a.*
     FROM ${TABLES.STICKER_ASSET} a
     INNER JOIN ${TABLES.STICKER_ASSET_CLASSIFICATION} c ON c.asset_id = a.id
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i ON i.sticker_id = a.id
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT ${safeLimitWithSentinel} OFFSET ${safeOffset}`,
    params,
    connection,
  );

  const countRows = await executeQuery(
    `SELECT COUNT(*) AS total
     FROM ${TABLES.STICKER_ASSET} a
     INNER JOIN ${TABLES.STICKER_ASSET_CLASSIFICATION} c ON c.asset_id = a.id
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i ON i.sticker_id = a.id
     WHERE ${whereClauses.join(' AND ')}`,
    params,
    connection,
  );

  const hasMore = rows.length > safeLimit;
  const total = Number(countRows?.[0]?.total || 0);

  return {
    assets: rows.slice(0, safeLimit).map((row) => normalizeStickerAssetRow(row)),
    hasMore,
    total,
  };
}

/**
 * Conta quantos assets classificados ainda não pertencem a nenhum pack.
 *
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<number>} Quantidade de assets classificados sem pack.
 */
export async function countClassifiedStickerAssetsWithoutPack(connection = null) {
  const rows = await executeQuery(
    `SELECT COUNT(*) AS total
     FROM ${TABLES.STICKER_ASSET} a
     INNER JOIN ${TABLES.STICKER_ASSET_CLASSIFICATION} c ON c.asset_id = a.id
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i ON i.sticker_id = a.id
     WHERE i.sticker_id IS NULL`,
    [],
    connection,
  );

  return Number(rows?.[0]?.total || 0);
}

/**
 * Lista assets classificados para curadoria (inclui com/sem pack) com paginação.
 *
 * @param {{
 *   limit?: number,
 *   offset?: number,
 *   includePacked?: boolean,
 *   includeUnpacked?: boolean,
 *   onlyVersionMismatch?: string|null,
 *   connection?: import('mysql2/promise').PoolConnection|null,
 * }} [options]
 * @returns {Promise<{ assets: object[], hasMore: boolean, total: number }>}
 */
export async function listClassifiedStickerAssetsForCuration({
  limit = 200,
  offset = 0,
  includePacked = true,
  includeUnpacked = true,
  onlyVersionMismatch = null,
  connection = null,
} = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimitWithSentinel = safeLimit + 1;

  const whereClauses = [];
  const params = [];

  if (!includePacked && includeUnpacked) {
    whereClauses.push('i_any.sticker_id IS NULL');
  } else if (includePacked && !includeUnpacked) {
    whereClauses.push('i_any.sticker_id IS NOT NULL');
  }

  const normalizedVersion = String(onlyVersionMismatch || '').trim();
  if (normalizedVersion) {
    whereClauses.push('c.classification_version <> ?');
    params.push(normalizedVersion);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const rows = await executeQuery(
    `SELECT DISTINCT a.*
     FROM ${TABLES.STICKER_ASSET} a
     INNER JOIN ${TABLES.STICKER_ASSET_CLASSIFICATION} c ON c.asset_id = a.id
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i_any ON i_any.sticker_id = a.id
     ${whereSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${safeLimitWithSentinel} OFFSET ${safeOffset}`,
    params,
    connection,
  );

  const countRows = await executeQuery(
    `SELECT COUNT(DISTINCT a.id) AS total
     FROM ${TABLES.STICKER_ASSET} a
     INNER JOIN ${TABLES.STICKER_ASSET_CLASSIFICATION} c ON c.asset_id = a.id
     LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i_any ON i_any.sticker_id = a.id
     ${whereSql}`,
    params,
    connection,
  );

  const hasMore = rows.length > safeLimit;
  const total = Number(countRows?.[0]?.total || 0);
  return {
    assets: rows.slice(0, safeLimit).map((row) => normalizeStickerAssetRow(row)),
    hasMore,
    total,
  };
}

/**
 * Cria um novo asset de figurinha.
 *
 * @param {object} asset Payload de criação do asset.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Asset criado.
 */
export async function createStickerAsset(asset, connection = null) {
  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_ASSET}
      (id, owner_jid, sha256, mimetype, is_animated, width, height, size_bytes, storage_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asset.id,
      asset.owner_jid,
      asset.sha256,
      asset.mimetype,
      asset.is_animated ? 1 : 0,
      asset.width ?? null,
      asset.height ?? null,
      asset.size_bytes,
      asset.storage_path,
    ],
    connection,
  );

  await publishStickerDomainEvent(
    {
      eventType: STICKER_DOMAIN_EVENTS.STICKER_ASSET_CREATED,
      aggregateType: 'sticker_asset',
      aggregateId: asset.id,
      payload: {
        asset_id: asset.id,
        owner_jid: asset.owner_jid,
        sha256: asset.sha256,
        mimetype: asset.mimetype,
      },
      priority: 85,
      idempotencyKey: `sticker_asset_created:${asset.id}`,
    },
    { connection },
  );

  return findStickerAssetById(asset.id, connection);
}

/**
 * Atualiza o caminho físico (storage_path) de um asset.
 *
 * @param {string} id ID do asset.
 * @param {string} storagePath Caminho em disco do arquivo.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<object|null>} Asset atualizado.
 */
export async function updateStickerAssetStoragePath(id, storagePath, connection = null) {
  await executeQuery(
    `UPDATE ${TABLES.STICKER_ASSET}
     SET storage_path = ?
     WHERE id = ?`,
    [storagePath, id],
    connection,
  );

  return findStickerAssetById(id, connection);
}

/**
 * Remove um asset pelo ID.
 *
 * @param {string} id ID do asset.
 * @param {import('mysql2/promise').PoolConnection|null} [connection=null] Conexão transacional opcional.
 * @returns {Promise<number>} Quantidade de linhas removidas.
 */
export async function deleteStickerAssetById(id, connection = null) {
  const result = await executeQuery(
    `DELETE FROM ${TABLES.STICKER_ASSET}
     WHERE id = ?`,
    [id],
    connection,
  );

  return Number(result?.affectedRows || 0);
}
