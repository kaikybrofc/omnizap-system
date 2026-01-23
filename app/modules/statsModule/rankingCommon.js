import { executeQuery } from '../../../database/index.js';
import { getJidUser } from '../../config/baileysConfig.js';
import {
  primeLidCache,
  resolveUserIdCached,
  isLidUserId,
  isWhatsAppUserId,
} from '../../services/lidMapService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MESSAGE_TYPE_SQL = `
  CASE
    WHEN JSON_EXTRACT(m.raw_message, '$.message.conversation') IS NOT NULL THEN 'texto'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage') IS NOT NULL THEN 'texto'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.imageMessage') IS NOT NULL THEN 'imagem'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.videoMessage') IS NOT NULL THEN 'video'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.audioMessage') IS NOT NULL THEN 'audio'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.stickerMessage') IS NOT NULL THEN 'figurinha'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.documentMessage') IS NOT NULL THEN 'documento'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.locationMessage') IS NOT NULL THEN 'localizacao'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.reactionMessage') IS NOT NULL THEN 'reacao'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.pollCreationMessage') IS NOT NULL THEN 'enquete'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.listMessage') IS NOT NULL THEN 'lista'
    WHEN JSON_EXTRACT(m.raw_message, '$.message.buttonsMessage') IS NOT NULL THEN 'botoes'
    ELSE 'outros'
  END
`;

export const TIMESTAMP_TO_DATETIME_SQL = `
  CASE
    WHEN m.timestamp > 1000000000000 THEN FROM_UNIXTIME(m.timestamp / 1000)
    WHEN m.timestamp > 1000000000 THEN FROM_UNIXTIME(m.timestamp)
    ELSE m.timestamp
  END
`;

/**
 * Formata data para pt-BR (America/Sao_Paulo).
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export const formatDate = (value) => {
  if (!value) return 'N/D';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/D';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
};

/**
 * Converte timestamp em ms (aceita segundos/ms/string).
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export const toMillis = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Retorna o nome exibido (pushName) ou fallback.
 * @param {string|null|undefined} pushName
 * @param {string|null|undefined} mentionId
 * @returns {string}
 */
export const getDisplayName = (pushName, mentionId) => {
  const mentionUser = getJidUser(mentionId);
  const base = mentionUser ? `@${mentionUser}` : null;
  if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
    const clean = pushName.trim();
    return base ? `${base} (${clean})` : clean;
  }
  return base || 'Desconhecido';
};

const resolveSenderIdsCanonical = (rawJid) => {
  if (!rawJid) return { displayId: null, mentionId: null, key: null };
  const canonical = resolveUserIdCached({ lid: rawJid, jid: rawJid, participantAlt: null });
  const displayId = canonical || rawJid;
  const mentionId = isWhatsAppUserId(canonical) ? canonical : null;
  const key = canonical || rawJid;
  return { displayId, mentionId, key };
};

const buildWhere = ({ scope, remoteJid, botJid }) => {
  const where = ['m.sender_id IS NOT NULL'];
  const params = [];
  if (scope === 'group') {
    where.push('m.chat_id = ?');
    params.push(remoteJid);
  }
  if (botJid) {
    where.push('m.sender_id <> ?');
    params.push(botJid);
  }
  return { where, params };
};

const buildCanonicalWhere = ({ scope, remoteJid, botJid, canonicalId }) => {
  const where = ['COALESCE(lm.jid, m.sender_id) = ?'];
  const params = [canonicalId];
  if (scope === 'group') {
    where.push('m.chat_id = ?');
    params.push(remoteJid);
  }
  if (botJid) {
    where.push('COALESCE(lm.jid, m.sender_id) <> ?');
    params.push(botJid);
  }
  return { where, params };
};

/**
 * Busca total de mensagens conforme escopo.
 * @param {{scope: 'group'|'global', remoteJid?: string|null, botJid?: string|null}} params
 * @returns {Promise<number>}
 */
export const getTotalMessages = async ({ scope, remoteJid, botJid }) => {
  const { where, params } = buildWhere({ scope, remoteJid, botJid });
  const sql = `SELECT COUNT(*) AS total FROM messages m WHERE ${where.join(' AND ')}`;
  const [row] = await executeQuery(sql, params);
  return Number(row?.total || 0);
};

/**
 * Busca o tipo de mensagem mais usado conforme escopo.
 * @param {{scope: 'group'|'global', remoteJid?: string|null, botJid?: string|null}} params
 * @returns {Promise<{label: string, count: number}|null>}
 */
export const getTopMessageType = async ({ scope, remoteJid, botJid }) => {
  const { where, params } = buildWhere({ scope, remoteJid, botJid });
  const [row] = await executeQuery(
    `SELECT
        ${MESSAGE_TYPE_SQL} AS message_type,
        COUNT(*) AS total
      FROM messages m
      WHERE ${where.join(' AND ')}
        AND m.raw_message IS NOT NULL
      GROUP BY message_type
      ORDER BY total DESC
      LIMIT 1`,
    params,
  );
  if (!row?.message_type) return null;
  return { label: row.message_type, count: Number(row.total || 0) };
};

/**
 * Busca inicio do banco conforme escopo.
 * @param {{scope: 'group'|'global', remoteJid?: string|null, botJid?: string|null}} params
 * @returns {Promise<any>}
 */
export const getDbStart = async ({ scope, remoteJid, botJid }) => {
  const { where, params } = buildWhere({ scope, remoteJid, botJid });
  const sql = `SELECT MIN(m.timestamp) AS db_start FROM messages m WHERE ${where.join(' AND ')}`;
  const rows = await executeQuery(sql, params);
  return rows?.[0]?.db_start || null;
};

/**
 * Busca os ultimos pushNames por sender_id.
 * @param {Array<string>} senderIds
 * @returns {Promise<Map<string, string>>}
 */
export const fetchLatestPushNames = async (senderIds) => {
  if (!senderIds || !senderIds.length) return new Map();
  const placeholders = senderIds.map(() => '?').join(',');
  const rows = await executeQuery(
    `SELECT t.sender_id,
            JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.pushName')) AS pushName
       FROM (
         SELECT sender_id, MAX(id) AS max_id
           FROM messages
          WHERE sender_id IN (${placeholders})
            AND raw_message IS NOT NULL
            AND JSON_EXTRACT(raw_message, '$.pushName') IS NOT NULL
          GROUP BY sender_id
       ) t
       JOIN messages m ON m.id = t.max_id`,
    senderIds,
  );
  const map = new Map();
  (rows || []).forEach((row) => {
    if (row?.sender_id && row?.pushName) {
      map.set(row.sender_id, row.pushName);
    }
  });
  return map;
};

/**
 * Monta ranking base com normalizacao por lid_map.
 * @param {{scope: 'group'|'global', remoteJid?: string|null, botJid?: string|null, limit?: number|null}} params
 * @returns {Promise<{rows: Array<any>}>}
 */
export const getRankingBase = async ({ scope, remoteJid, botJid, limit = null }) => {
  const { where, params } = buildWhere({ scope, remoteJid, botJid });
  const limitClause = limit ? `LIMIT ${Number(limit)}` : '';
  const rankingRows = await executeQuery(
    `SELECT
        m.sender_id,
        COUNT(*) AS total_messages,
        MIN(m.timestamp) AS first_message,
        MAX(m.timestamp) AS last_message
      FROM messages m
      WHERE ${where.join(' AND ')}
      GROUP BY m.sender_id
      ORDER BY total_messages DESC
      ${limitClause}`,
    params,
  );

  const senderIds = rankingRows.map((row) => row.sender_id).filter(Boolean);
  const lidsToPrime = senderIds.filter((id) => isLidUserId(id));
  if (lidsToPrime.length > 0) {
    await primeLidCache(lidsToPrime);
  }

  const pushNameBySender = await fetchLatestPushNames(senderIds);
  const normalizedTotals = new Map();

  rankingRows.forEach((row) => {
    const rawJid = row.sender_id || '';
    if (!rawJid) return;
    const { displayId, mentionId, key } = resolveSenderIdsCanonical(rawJid);
    if (!displayId || !key) return;
    const total = Number(row.total_messages || 0);
    const firstMs = toMillis(row.first_message);
    const lastMs = toMillis(row.last_message);
    const current = normalizedTotals.get(key) || {
      sender_id: displayId,
      mention_id: mentionId,
      display_name: null,
      total_messages: 0,
      first_message: null,
      last_message: null,
    };
    current.total_messages += total;
    if (firstMs !== null) {
      current.first_message = current.first_message === null ? firstMs : Math.min(current.first_message, firstMs);
    }
    if (lastMs !== null) {
      current.last_message = current.last_message === null ? lastMs : Math.max(current.last_message, lastMs);
    }
    if (!current.mention_id && mentionId) {
      current.mention_id = mentionId;
    }
    if (isWhatsAppUserId(rawJid)) {
      current.mention_id = rawJid;
    }
    if (!current.display_name) {
      const pushName = pushNameBySender.get(rawJid);
      if (pushName) current.display_name = pushName;
    }
    normalizedTotals.set(key, current);
  });

  const rows = Array.from(normalizedTotals.values()).sort((a, b) => b.total_messages - a.total_messages);
  return { rows: limit ? rows.slice(0, limit) : rows };
};

const computeStreak = (days) => {
  if (!days.length) return 0;
  let best = 1;
  let current = 1;
  let prev = new Date(`${days[0]}T00:00:00Z`).getTime();
  for (let i = 1; i < days.length; i += 1) {
    const currentDay = new Date(`${days[i]}T00:00:00Z`).getTime();
    const diff = currentDay - prev;
    if (diff === DAY_MS) {
      current += 1;
    } else {
      current = 1;
    }
    if (current > best) best = current;
    prev = currentDay;
  }
  return best;
};

/**
 * Enriquecer ranking com dias ativos, streak, media/dia e favorito.
 * @param {{rows: Array<any>, scope: 'group'|'global', remoteJid?: string|null, botJid?: string|null}} params
 * @returns {Promise<void>}
 */
export const enrichRankingRows = async ({ rows, scope, remoteJid, botJid }) => {
  for (const row of rows) {
    const rawJid = row.sender_id;
    if (!rawJid) continue;

    const { where, params } = buildCanonicalWhere({ scope, remoteJid, botJid, canonicalId: rawJid });

    const daysRows = await executeQuery(
      `SELECT DISTINCT DATE(ts) AS day
         FROM (
           SELECT ${TIMESTAMP_TO_DATETIME_SQL} AS ts
             FROM messages m
             LEFT JOIN lid_map lm
               ON lm.lid = m.sender_id
              AND lm.jid IS NOT NULL
            WHERE ${where.join(' AND ')}
              AND m.timestamp IS NOT NULL
         ) d
        WHERE d.ts IS NOT NULL
        ORDER BY day ASC`,
      params,
    );

    const days = (daysRows || []).map((item) => item.day).filter(Boolean);
    row.active_days = days.length;
    row.streak = computeStreak(days);

    const total = Number(row.total_messages || 0);
    const firstMs = toMillis(row.first_message);
    const lastMs = toMillis(row.last_message);
    if (firstMs !== null && lastMs !== null && total > 0) {
      const rangeDays = Math.max(1, Math.ceil((lastMs - firstMs) / DAY_MS) + 1);
      row.avg_per_day = (total / rangeDays).toFixed(2);
    } else {
      row.avg_per_day = '0.00';
    }

    const [favRow] = await executeQuery(
      `SELECT
          ${MESSAGE_TYPE_SQL} AS message_type,
          COUNT(*) AS total
        FROM messages m
        LEFT JOIN lid_map lm
          ON lm.lid = m.sender_id
         AND lm.jid IS NOT NULL
        WHERE ${where.join(' AND ')}
          AND m.raw_message IS NOT NULL
        GROUP BY message_type
        ORDER BY total DESC
        LIMIT 1`,
      params,
    );

    row.favorite_type = favRow?.message_type || null;
    row.favorite_count = Number(favRow?.total || 0);
  }
};

/**
 * Monta um relatorio completo do ranking conforme escopo.
 * @param {{scope: 'group'|'global', remoteJid?: string|null, botJid?: string|null, limit?: number|null}} params
 * @returns {Promise<{rows: Array<any>, totalMessages: number, topType: {label: string, count: number}|null, topTotal: number, dbStart: any}>}
 */
export const getRankingReport = async ({ scope, remoteJid, botJid, limit = null }) => {
  const totalMessages = await getTotalMessages({ scope, remoteJid, botJid });
  const topType = await getTopMessageType({ scope, remoteJid, botJid });
  const { rows } = await getRankingBase({ scope, remoteJid, botJid, limit });
  await enrichRankingRows({ rows, scope, remoteJid, botJid });
  const topTotal = rows.reduce((acc, row) => acc + Number(row.total_messages || 0), 0);
  const dbStart = await getDbStart({ scope, remoteJid, botJid });
  return { rows, totalMessages, topType, topTotal, dbStart };
};

/**
 * Monta mensagem detalhada do ranking.
 * @param {{scope: 'group'|'global', limit: number, rows: Array<any>, totalMessages: number, topTotal: number, topType: {label: string, count: number}|null, dbStart: any}} params
 * @returns {string}
 */
export const buildRankingMessage = ({ scope, limit, rows, totalMessages, topTotal, topType, dbStart }) => {
  const scopeTitle = scope === 'global' ? 'Global' : 'Grupo';
  const scopeLabel = scope === 'global' ? 'global' : 'grupo';

  if (!rows.length) {
    return `Nao ha mensagens suficientes para gerar o ranking ${scopeLabel}.\n\nInicio do banco (primeira mensagem): ${formatDate(dbStart)}`;
  }

  const totalLabel = Number(totalMessages || 0);
  const topShare = totalLabel > 0 ? ((Number(topTotal || 0) / totalLabel) * 100).toFixed(2) : '0.00';
  const topTypeLabel = topType?.label ? `${topType.label} (${topType.count})` : 'N/D';

  const lines = [
    `🏆 *Ranking ${scopeTitle} Top ${limit} (mensagens)*`,
    `📦 Total de mensagens (${scopeLabel}): ${totalLabel}`,
    `📊 Top ${limit} = ${topShare}% do total`,
    `🔥 Tipo mais usado: ${topTypeLabel}`,
    '',
  ];

  rows.forEach((row, index) => {
    const handle = getDisplayName(row.display_name, row.mention_id || row.sender_id);
    const total = row.total_messages || 0;
    const percent = totalLabel > 0 ? ((Number(total || 0) / totalLabel) * 100).toFixed(2) : '0.00';
    const first = formatDate(row.first_message);
    const last = formatDate(row.last_message);
    const avgPerDay = row.avg_per_day || '0.00';
    const activeDays = row.active_days ?? 0;
    const streak = row.streak ?? 0;
    const favoriteType = row.favorite_type ? `${row.favorite_type} (${row.favorite_count || 0})` : 'N/D';
    const position = `${index + 1}`.padStart(2, '0');
    lines.push(
      `${position}. ${handle}`,
      `   💬 ${total} msg(s)`,
      `   📊 ${percent}% do total`,
      `   📆 dias ativos: ${activeDays}`,
      `   📈 media/dia: ${avgPerDay}`,
      `   🔥 favorito: ${favoriteType}`,
      `   🔗 streak: ${streak} dia(s)`,
      `   📅 primeira: ${first}`,
      `   🕘 ultima: ${last}`,
      '',
    );
  });

  lines.push(`Inicio do banco (primeira mensagem): ${formatDate(dbStart)}`);
  return lines.join('\n');
};
