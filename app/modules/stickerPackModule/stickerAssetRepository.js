import { executeQuery, TABLES } from '../../../database/index.js';

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
