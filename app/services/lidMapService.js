import logger from '../utils/logger/loggerModule.js';
import { executeQuery, TABLES } from '../../database/index.js';
import { getJidServer, normalizeJid } from '../config/baileysConfig.js';

const CACHE_TTL_MS = 20 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const STORE_COOLDOWN_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 800;
const BACKFILL_DEFAULT_BATCH = 50000;
const BACKFILL_SOURCE = 'backfill';

const lidCache = new Map();

let backfillPromise = null;

/**
 * Retorna timestamp atual em ms.
 * @returns {number}
 */
const now = () => Date.now();

/**
 * Verifica se o JID e do tipo LID.
 * @param {string|null|undefined} jid
 * @returns {boolean}
 */
const isLidJid = (jid) => getJidServer(jid) === 'lid';

/**
 * Verifica se o JID e do WhatsApp (s.whatsapp.net).
 * @param {string|null|undefined} jid
 * @returns {boolean}
 */
const isWhatsAppJid = (jid) => getJidServer(jid) === 's.whatsapp.net';

/**
 * Mascara um JID para logs.
 * @param {string|null|undefined} jid
 * @returns {string|null}
 */
const maskJid = (jid) => {
  if (!jid || typeof jid !== 'string') return null;
  const [user, server] = jid.split('@');
  if (!user || !server) return jid;
  const head = user.slice(0, 3);
  const tail = user.slice(-2);
  return `${head}***${tail}@${server}`;
};

/**
 * Busca entrada do cache (com expiração).
 * @param {string|null|undefined} lid
 * @returns {{jid: string|null, expiresAt: number, lastStoredAt: number|null}|null}
 */
const getCacheEntry = (lid) => {
  if (!lid) return null;
  const entry = lidCache.get(lid);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < now()) {
    lidCache.delete(lid);
    return null;
  }
  return entry;
};

/**
 * Atualiza cache local do LID.
 * @param {string} lid
 * @param {string|null} jid
 * @param {number} ttlMs
 * @param {number|null} lastStoredAt
 * @returns {void}
 */
const setCacheEntry = (lid, jid, ttlMs, lastStoredAt) => {
  if (!lid) return;
  lidCache.set(lid, {
    jid: jid ?? null,
    expiresAt: now() + (ttlMs || CACHE_TTL_MS),
    lastStoredAt: lastStoredAt ?? lidCache.get(lid)?.lastStoredAt ?? null,
  });
};

/**
 * Retorna JID do cache para um LID.
 * @param {string|null|undefined} lid
 * @returns {string|null|undefined} undefined quando nao cacheado.
 */
export const getCachedJidForLid = (lid) => {
  const entry = getCacheEntry(lid);
  if (!entry) return undefined;
  return entry.jid ?? null;
};

/**
 * Divide lista em batches.
 * @param {Array<any>} items
 * @param {number} [limit=BATCH_LIMIT]
 * @returns {Array<Array<any>>}
 */
const buildChunks = (items, limit = BATCH_LIMIT) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += limit) {
    chunks.push(items.slice(i, i + limit));
  }
  return chunks;
};

/**
 * Pré-carrega cache a partir do banco.
 * @param {Array<string>} [lids=[]]
 * @returns {Promise<Map<string, string|null>>}
 */
export const primeLidCache = async (lids = []) => {
  const uniqueLids = Array.from(new Set((lids || []).filter(Boolean)));
  if (!uniqueLids.length) return new Map();

  const pending = uniqueLids.filter((lid) => isLidJid(lid) && getCachedJidForLid(lid) === undefined);
  if (!pending.length) {
    const map = new Map();
    uniqueLids.forEach((lid) => map.set(lid, getCachedJidForLid(lid) ?? null));
    return map;
  }

  const results = new Map();
  const chunks = buildChunks(pending);

  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await executeQuery(
      `SELECT lid, jid FROM ${TABLES.LID_MAP} WHERE lid IN (${placeholders})`,
      chunk,
    );

    const found = new Map();
    (rows || []).forEach((row) => {
      if (!row?.lid) return;
      const jid = row.jid && isWhatsAppJid(row.jid) ? normalizeJid(row.jid) : null;
      found.set(row.lid, jid);
      setCacheEntry(row.lid, jid, CACHE_TTL_MS);
      results.set(row.lid, jid);
    });

    chunk.forEach((lid) => {
      if (found.has(lid)) return;
      setCacheEntry(lid, null, NEGATIVE_TTL_MS);
      results.set(lid, null);
    });
  }

  uniqueLids.forEach((lid) => {
    if (!results.has(lid)) {
      results.set(lid, getCachedJidForLid(lid) ?? null);
    }
  });

  return results;
};

/**
 * Retorna o primeiro JID valido do WhatsApp.
 * @param {...string} candidates
 * @returns {string|null}
 */
const pickWhatsAppJid = (...candidates) => {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    if (isWhatsAppJid(candidate)) return normalizeJid(candidate);
  }
  return null;
};

/**
 * Retorna o primeiro LID valido.
 * @param {...string} candidates
 * @returns {string|null}
 */
const pickLid = (...candidates) => {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    if (isLidJid(candidate)) return candidate;
  }
  return null;
};

/**
 * Resolve ID canônico usando apenas cache.
 * @param {{lid?: string|null, jid?: string|null, participantAlt?: string|null}} [params]
 * @returns {string|null}
 */
export const resolveUserIdCached = ({ lid, jid, participantAlt } = {}) => {
  const directJid = pickWhatsAppJid(jid, participantAlt, lid);
  if (directJid) return directJid;

  const lidValue = pickLid(lid, jid, participantAlt);
  if (!lidValue) return jid || participantAlt || lid || null;

  const mapped = getCachedJidForLid(lidValue);
  if (mapped !== undefined) return mapped || lidValue;
  return lidValue;
};

/**
 * Busca JID para um LID no banco e atualiza cache.
 * @param {string} lid
 * @returns {Promise<string|null>}
 */
const fetchJidByLid = async (lid) => {
  const cached = getCachedJidForLid(lid);
  if (cached !== undefined) return cached || null;

  const rows = await executeQuery(
    `SELECT jid FROM ${TABLES.LID_MAP} WHERE lid = ? LIMIT 1`,
    [lid],
  );
  const jid = rows?.[0]?.jid && isWhatsAppJid(rows[0].jid) ? normalizeJid(rows[0].jid) : null;
  setCacheEntry(lid, jid, jid ? CACHE_TTL_MS : NEGATIVE_TTL_MS);
  return jid;
};

/**
 * Resolve ID canônico consultando banco se necessário.
 * @param {{lid?: string|null, jid?: string|null, participantAlt?: string|null}} [params]
 * @returns {Promise<string|null>}
 */
export const resolveUserId = async ({ lid, jid, participantAlt } = {}) => {
  const directJid = pickWhatsAppJid(jid, participantAlt, lid);
  if (directJid) return directJid;

  const lidValue = pickLid(lid, jid, participantAlt);
  if (!lidValue) return jid || participantAlt || lid || null;

  const mapped = await fetchJidByLid(lidValue);
  return mapped || lidValue;
};

/**
 * Reconcilia mensagens antigas do LID para o JID real.
 * @param {{lid?: string|null, jid?: string|null, source?: string}} [params]
 * @returns {Promise<{updated: number}>}
 */
export const reconcileLidToJid = async ({ lid, jid, source = 'map' } = {}) => {
  if (!lid || !jid) return { updated: 0 };
  const result = await executeQuery(
    `UPDATE ${TABLES.MESSAGES} SET sender_id = ? WHERE sender_id = ?`,
    [jid, lid],
  );
  const updated = Number(result?.affectedRows || 0);
  if (updated > 0) {
    logger.info('Reconciliação lid->jid aplicada.', {
      lid: maskJid(lid),
      jid: maskJid(jid),
      updated,
      source,
    });
  }
  return { updated };
};

/**
 * Persiste mapeamento LID->JID (com cooldown e reconciliação).
 * @param {string} lid
 * @param {string|null} jid
 * @param {string} [source='message']
 * @returns {Promise<{stored: boolean, reconciled: boolean}>}
 */
export const maybeStoreLidMap = async (lid, jid, source = 'message') => {
  if (!lid || !isLidJid(lid)) return { stored: false, reconciled: false };

  const normalizedJid = jid && isWhatsAppJid(jid) ? normalizeJid(jid) : null;
  const cacheEntry = getCacheEntry(lid);
  const nowTs = now();

  const cachedJid = cacheEntry?.jid ?? null;
  if (cachedJid === normalizedJid) {
    const lastStoredAt = cacheEntry?.lastStoredAt || 0;
    if (nowTs - lastStoredAt < STORE_COOLDOWN_MS) {
      return { stored: false, reconciled: false };
    }
  }

  const result = await executeQuery(
    `INSERT INTO ${TABLES.LID_MAP} (lid, jid, first_seen, last_seen, source)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
     ON DUPLICATE KEY UPDATE
       jid = COALESCE(VALUES(jid), jid),
       last_seen = VALUES(last_seen),
       source = VALUES(source)`,
    [lid, normalizedJid, source],
  );

  const cacheJid = normalizedJid ?? cachedJid ?? null;
  setCacheEntry(lid, cacheJid, CACHE_TTL_MS, nowTs);

  const shouldReconcile = Boolean(normalizedJid && (!cacheEntry || cacheEntry.jid !== normalizedJid));
  if (shouldReconcile) {
    await reconcileLidToJid({ lid, jid: normalizedJid, source });
  }

  const stored = Number(result?.affectedRows || 0) > 0;
  return { stored, reconciled: shouldReconcile };
};

/**
 * Extrai lid/jid/participantAlt de um objeto ou string.
 * @param {object|string|null|undefined} value
 * @returns {{lid: string|null, jid: string|null, participantAlt: string|null, raw: string|null}}
 */
export const extractUserIdInfo = (value) => {
  if (!value) return { lid: null, jid: null, participantAlt: null, raw: null };
  if (typeof value === 'string') {
    return {
      lid: isLidJid(value) ? value : null,
      jid: isWhatsAppJid(value) ? value : null,
      participantAlt: null,
      raw: value,
    };
  }

  const participantAlt = typeof value.participantAlt === 'string' ? value.participantAlt : null;
  const participant = typeof value.participant === 'string' ? value.participant : null;
  const jidCandidate = value.jid || value.id || participantAlt || participant || null;
  const lidCandidate = value.lid || participant || null;

  return {
    lid: pickLid(lidCandidate, participantAlt, participant),
    jid: pickWhatsAppJid(jidCandidate, participantAlt, participant),
    participantAlt,
    raw: jidCandidate || lidCandidate,
  };
};

/**
 * Alias: verifica se valor e LID.
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export const isLidUserId = (value) => isLidJid(value);

/**
 * Alias: verifica se valor e JID do WhatsApp.
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export const isWhatsAppUserId = (value) => isWhatsAppJid(value);

/**
 * Sleep utilitario.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retorna o range de IDs da tabela messages.
 * @returns {Promise<{minId: number, maxId: number}>}
 */
const getMessageIdRange = async () => {
  const rows = await executeQuery(
    `SELECT MIN(id) AS min_id, MAX(id) AS max_id FROM ${TABLES.MESSAGES}`,
  );
  const minId = Number(rows?.[0]?.min_id || 0);
  const maxId = Number(rows?.[0]?.max_id || 0);
  return { minId, maxId };
};

/**
 * Executa um batch do backfill lid_map.
 * @param {number} fromId
 * @param {number} toId
 * @returns {Promise<any>}
 */
const runBackfillBatch = async (fromId, toId) => {
  const sql = `
    INSERT INTO ${TABLES.LID_MAP} (lid, jid, first_seen, last_seen, source)
    SELECT
      s.lid,
      s.jid,
      MIN(s.ts) AS first_seen,
      MAX(s.ts) AS last_seen,
      ?
    FROM (
      SELECT
        JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.key.participant')) AS lid,
        JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.key.participantAlt')) AS jid,
        m.timestamp AS ts
      FROM ${TABLES.MESSAGES} m
      WHERE m.id BETWEEN ? AND ?
        AND m.raw_message IS NOT NULL
        AND m.timestamp IS NOT NULL
    ) s
    WHERE s.lid LIKE '%@lid'
      AND s.jid LIKE '%@s.whatsapp.net'
    GROUP BY s.lid, s.jid
    ON DUPLICATE KEY UPDATE
      jid = COALESCE(VALUES(jid), ${TABLES.LID_MAP}.jid),
      last_seen = GREATEST(${TABLES.LID_MAP}.last_seen, VALUES(last_seen)),
      source = VALUES(source)
  `;

  return executeQuery(sql, [BACKFILL_SOURCE, fromId, toId]);
};

/**
 * Backfill do lid_map a partir de messages.raw_message.
 * @param {{batchSize?: number, sleepMs?: number, maxBatches?: number|null}} [options]
 * @returns {Promise<{batches: number, minId?: number, maxId?: number}>}
 */
export const backfillLidMapFromMessages = async ({
  batchSize = BACKFILL_DEFAULT_BATCH,
  sleepMs = 50,
  maxBatches = null,
} = {}) => {
  const { minId, maxId } = await getMessageIdRange();
  if (!minId || !maxId || maxId < minId) {
    logger.info('Backfill lid_map ignorado: tabela messages vazia.');
    return { batches: 0 };
  }

  let batches = 0;
  for (let start = minId; start <= maxId; start += batchSize) {
    const end = Math.min(start + batchSize - 1, maxId);
    await runBackfillBatch(start, end);
    batches += 1;
    if (maxBatches && batches >= maxBatches) break;
    if (sleepMs > 0) await sleep(sleepMs);
  }

  logger.info('Backfill lid_map finalizado.', { batches, minId, maxId });
  return { batches, minId, maxId };
};

/**
 * Garante que o backfill rode apenas uma vez por processo.
 * @param {{batchSize?: number, sleepMs?: number, maxBatches?: number|null}} [options]
 * @returns {Promise<{batches: number, minId?: number, maxId?: number}>}
 */
export const backfillLidMapFromMessagesOnce = async (options = {}) => {
  if (!backfillPromise) {
    backfillPromise = backfillLidMapFromMessages(options).catch((error) => {
      logger.warn('Falha no backfill lid_map.', { error: error.message });
      throw error;
    });
  }
  return backfillPromise;
};
