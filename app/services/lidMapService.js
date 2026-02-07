import logger from '../utils/logger/loggerModule.js';
import { executeQuery, TABLES } from '../../database/index.js';
import { getJidServer, normalizeJid, isGroupJid } from '../config/baileysConfig.js';
import { buildRowPlaceholders, createFlushRunner } from './queueUtils.js';
import { recordError, setQueueDepth } from '../observability/metrics.js';

const CACHE_TTL_MS = 20 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const STORE_COOLDOWN_MS = 10 * 60 * 1000;
const BATCH_LIMIT = 800;
const BACKFILL_DEFAULT_BATCH = 50000;
const BACKFILL_SOURCE = 'backfill';

const LID_SERVERS = new Set(['lid', 'hosted.lid']);
const PN_SERVERS = new Set(['s.whatsapp.net', 'c.us', 'hosted']);

const lidCache = new Map();
const lidWriteBuffer = new Map();

let backfillPromise = null;

const updateLidQueueMetric = () => {
  setQueueDepth('lid_map', lidWriteBuffer.size);
};

/**
 * Retorna timestamp atual em ms.
 * @returns {number}
 */
const now = () => Date.now();

/**
 * Verifica se o JID e do tipo LID (lid/hosted.lid).
 * @param {string|null|undefined} jid
 * @returns {boolean}
 */
const isLidJid = (jid) => LID_SERVERS.has(getJidServer(jid));

/**
 * Verifica se o JID e do WhatsApp (s.whatsapp.net/c.us/hosted).
 * @param {string|null|undefined} jid
 * @returns {boolean}
 */
const isWhatsAppJid = (jid) => PN_SERVERS.has(getJidServer(jid));

const normalizeLid = (lid) => {
  if (!lid || !isLidJid(lid)) return null;
  const normalized = normalizeJid(lid);
  return normalized || null;
};

const normalizeWhatsAppJid = (jid) => {
  if (!jid || !isWhatsAppJid(jid)) return null;
  const normalized = normalizeJid(jid);
  return normalized || null;
};

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
  const nowTs = now();
  const entry = lidCache.get(lid);
  if (entry) {
    if (entry.expiresAt && entry.expiresAt < nowTs) {
      lidCache.delete(lid);
    } else {
      return entry;
    }
  }

  const baseLid = normalizeLid(lid);
  if (!baseLid || baseLid === lid) return null;
  const baseEntry = lidCache.get(baseLid);
  if (!baseEntry) return null;
  if (baseEntry.expiresAt && baseEntry.expiresAt < nowTs) {
    lidCache.delete(baseLid);
    return null;
  }
  return baseEntry;
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
  const normalizedJid = normalizeWhatsAppJid(jid);
  const baseLid = normalizeLid(lid);
  const previousEntry = lidCache.get(lid) || (baseLid ? lidCache.get(baseLid) : null);
  const entry = {
    jid: normalizedJid ?? null,
    expiresAt: now() + (ttlMs || CACHE_TTL_MS),
    lastStoredAt: lastStoredAt ?? previousEntry?.lastStoredAt ?? null,
  };
  lidCache.set(lid, entry);
  if (baseLid && baseLid !== lid) {
    lidCache.set(baseLid, entry);
  }
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

  const pending = uniqueLids.filter(
    (lid) => isLidJid(lid) && getCachedJidForLid(lid) === undefined,
  );
  if (!pending.length) {
    const map = new Map();
    uniqueLids.forEach((lid) => map.set(lid, getCachedJidForLid(lid) ?? null));
    return map;
  }

  const results = new Map();
  const baseByLid = new Map();
  const lookupSet = new Set();
  pending.forEach((lid) => {
    const base = normalizeLid(lid);
    baseByLid.set(lid, base);
    lookupSet.add(lid);
    if (base && base !== lid) lookupSet.add(base);
  });

  const lookupList = Array.from(lookupSet);
  const chunks = buildChunks(lookupList);
  const rowMap = new Map();

  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await executeQuery(
      `SELECT lid, jid FROM ${TABLES.LID_MAP} WHERE lid IN (${placeholders})`,
      chunk,
    );

    (rows || []).forEach((row) => {
      if (!row?.lid) return;
      const jid = row.jid && isWhatsAppJid(row.jid) ? normalizeJid(row.jid) : null;
      rowMap.set(row.lid, jid);
    });
  }

  for (const lid of pending) {
    const base = baseByLid.get(lid);
    const direct = rowMap.has(lid) ? rowMap.get(lid) : undefined;
    const baseValue =
      base && base !== lid && rowMap.has(base) ? rowMap.get(base) : undefined;
    const resolved = direct ?? baseValue ?? null;
    setCacheEntry(lid, resolved, resolved ? CACHE_TTL_MS : NEGATIVE_TTL_MS);
    results.set(lid, resolved);
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

const buildLidUpsertSql = (rows) => {
  const placeholders = buildRowPlaceholders(rows, '(?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)');
  return `
    INSERT INTO ${TABLES.LID_MAP} (lid, jid, first_seen, last_seen, source)
    VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      jid = COALESCE(VALUES(jid), jid),
      last_seen = VALUES(last_seen),
      source = VALUES(source)
  `;
};

/**
 * Enfileira atualizacao do lid_map (com cooldown e dedupe).
 * @param {string} lid
 * @param {string|null} jid
 * @param {string} [source='message']
 * @returns {{queued: boolean, reconciled: boolean}}
 */
export const queueLidUpdate = (lid, jid, source = 'message') => {
  let resolvedLid = lid;
  let resolvedJid = jid;

  if (!isLidJid(resolvedLid) && isLidJid(resolvedJid) && isWhatsAppJid(resolvedLid)) {
    resolvedLid = jid;
    resolvedJid = lid;
  }

  if (!resolvedLid || !isLidJid(resolvedLid)) {
    return { queued: false, reconciled: false };
  }

  const normalizedJid = resolvedJid && isWhatsAppJid(resolvedJid) ? normalizeJid(resolvedJid) : null;
  const lidsToUpdate = new Set([resolvedLid]);
  const baseLid = normalizeLid(resolvedLid);
  if (baseLid && baseLid !== resolvedLid) lidsToUpdate.add(baseLid);

  let queued = false;
  let reconciled = false;

  for (const targetLid of lidsToUpdate) {
    const cacheEntry = getCacheEntry(targetLid);
    const cachedJid = cacheEntry?.jid ?? null;
    const lastStoredAt = cacheEntry?.lastStoredAt || 0;
    const nowTs = now();

    const mappingChanged = Boolean(normalizedJid && normalizedJid !== cachedJid);
    const mappingSame = normalizedJid === cachedJid;

    if (mappingSame && nowTs - lastStoredAt < STORE_COOLDOWN_MS) {
      continue;
    }

    const buffered = lidWriteBuffer.get(targetLid);
    const effectiveJid = normalizedJid ?? buffered?.jid ?? cachedJid ?? null;
    const entry = {
      lid: targetLid,
      jid: effectiveJid,
      source,
      queuedAt: nowTs,
      reconcileJid: mappingChanged ? normalizedJid : null,
    };

    lidWriteBuffer.set(targetLid, entry);
    setCacheEntry(targetLid, effectiveJid, CACHE_TTL_MS, nowTs);
    queued = true;
    reconciled = reconciled || Boolean(entry.reconcileJid);
  }

  if (queued) updateLidQueueMetric();

  return { queued, reconciled };
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
 * Extrai informacoes do remetente a partir de uma mensagem do Baileys.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg
 * @returns {{lid: string|null, jid: string|null, participantAlt: string|null, remoteJid: string|null, groupMessage: boolean}}
 */
export const extractSenderInfoFromMessage = (msg) => {
  const remoteJid = msg?.key?.remoteJid || null;
  const participant = msg?.key?.participant || null;
  const participantAlt = msg?.key?.participantAlt || null;
  const groupMessage = isGroupJid(remoteJid);

  let lid = null;
  let jid = null;

  if (groupMessage) {
    if (isWhatsAppJid(participant)) jid = participant;
    if (isLidJid(participant)) lid = participant;
    if (isWhatsAppJid(participantAlt)) jid = participantAlt;
    if (!lid && isLidJid(participantAlt)) lid = participantAlt;
  } else {
    if (isWhatsAppJid(remoteJid)) jid = remoteJid;
    if (!jid && isWhatsAppJid(participant)) jid = participant;
    if (isLidJid(participant)) lid = participant;
  }

  return { lid, jid, participantAlt, remoteJid, groupMessage };
};

/**
 * Busca JID para um LID no banco e atualiza cache.
 * @param {string} lid
 * @returns {Promise<string|null>}
 */
const fetchJidByLid = async (lid) => {
  const cached = getCachedJidForLid(lid);
  if (cached !== undefined) return cached || null;

  const candidates = [lid];
  const base = normalizeLid(lid);
  if (base && base !== lid) candidates.push(base);

  const placeholders = candidates.map(() => '?').join(', ');
  const rows = await executeQuery(
    `SELECT lid, jid FROM ${TABLES.LID_MAP} WHERE lid IN (${placeholders})`,
    candidates,
  );

  const rowMap = new Map();
  (rows || []).forEach((row) => {
    if (!row?.lid) return;
    const jid = row.jid && isWhatsAppJid(row.jid) ? normalizeJid(row.jid) : null;
    rowMap.set(row.lid, jid);
  });

  const direct = rowMap.has(lid) ? rowMap.get(lid) : undefined;
  const baseValue = base && base !== lid && rowMap.has(base) ? rowMap.get(base) : undefined;
  let resolved = direct ?? baseValue ?? null;

  if (!resolved) {
    const normalized = base || lid;
    const [rawUser, rawServer] = String(normalized).split('@');
    const rootUser = rawUser ? rawUser.split(':')[0] : '';
    const server = rawServer || '';

    if (rootUser && server) {
      const derivedRows = await executeQuery(
        `SELECT jid
           FROM ${TABLES.LID_MAP}
          WHERE jid IS NOT NULL
            AND (
              lid = ?
              OR lid = ?
              OR lid = ?
              OR lid LIKE ?
            )
          ORDER BY last_seen DESC
          LIMIT 1`,
        [lid, base || lid, `${rootUser}@${server}`, `${rootUser}:%@${server}`],
      );
      const derivedJid = derivedRows?.[0]?.jid;
      if (derivedJid && isWhatsAppJid(derivedJid)) {
        resolved = normalizeJid(derivedJid);
      }
    }
  }

  const shouldSeedDerived = Boolean(resolved && direct === undefined);

  setCacheEntry(
    lid,
    resolved,
    resolved ? CACHE_TTL_MS : NEGATIVE_TTL_MS,
    shouldSeedDerived ? 0 : undefined,
  );

  if (shouldSeedDerived) {
    queueLidUpdate(lid, resolved, 'derived');
  }

  return resolved;
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

const flushLidQueueCore = async () => {
  if (lidWriteBuffer.size === 0) return;
  const entries = Array.from(lidWriteBuffer.values());
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const batch = entries.slice(i, i + BATCH_LIMIT);
    if (!batch.length) continue;

    const sql = buildLidUpsertSql(batch.length);
    const params = [];
    for (const entry of batch) {
      params.push(entry.lid, entry.jid, entry.source);
    }

    try {
      await executeQuery(sql, params);
    } catch (error) {
      logger.error('Falha ao persistir batch do lid_map.', { error: error.message });
      recordError('lid_map');
      break;
    }

    const reconcileTargets = [];
    for (const entry of batch) {
      const current = lidWriteBuffer.get(entry.lid);
      if (!current || current.queuedAt === entry.queuedAt) {
        lidWriteBuffer.delete(entry.lid);
      }
      if (entry.reconcileJid) {
        reconcileTargets.push({ lid: entry.lid, jid: entry.reconcileJid, source: entry.source });
      }
    }

    updateLidQueueMetric();
    if (reconcileTargets.length > 0) {
      setImmediate(() => {
        for (const target of reconcileTargets) {
          reconcileLidToJid(target).catch((error) => {
            logger.warn('Falha ao reconciliar lid->jid.', { error: error.message });
            recordError('lid_map_reconcile');
          });
        }
      });
    }
  }
};

const lidFlushRunner = createFlushRunner({
  onFlush: flushLidQueueCore,
  onError: (error) => {
    logger.error('Falha ao executar flush do lid_map.', { error: error.message });
    recordError('lid_map');
  },
  onFinally: () => {
    updateLidQueueMetric();
  },
});

/**
 * Executa o flush do buffer lid_map em batch.
 * @returns {Promise<void>}
 */
export const flushLidQueue = async () => {
  await lidFlushRunner.run();
};

export const maybeStoreLidMap = async (lid, jid, source = 'message') => {
  const result = queueLidUpdate(lid, jid, source);
  return { stored: result.queued, reconciled: result.reconciled };
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
    WHERE (s.lid LIKE '%@lid' OR s.lid LIKE '%@hosted.lid')
      AND (s.jid LIKE '%@s.whatsapp.net' OR s.jid LIKE '%@c.us' OR s.jid LIKE '%@hosted')
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

updateLidQueueMetric();
