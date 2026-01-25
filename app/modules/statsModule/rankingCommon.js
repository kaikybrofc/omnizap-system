import { createCanvas, loadImage } from 'canvas';
import { executeQuery } from '../../../database/index.js';
import { getJidUser, getProfilePicBuffer } from '../../config/baileysConfig.js';
import {
  primeLidCache,
  resolveUserIdCached,
  isLidUserId,
  isWhatsAppUserId,
} from '../../services/lidMapService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_CACHE_LIMIT = 2000;
const PROFILE_PIC_CACHE = globalThis.__omnizapProfilePicCache || new Map();
globalThis.__omnizapProfilePicCache = PROFILE_PIC_CACHE;
const RANKING_IMAGE_WIDTH = 1600;
const RANKING_IMAGE_HEIGHT = 900;
const RANKING_IMAGE_SCALE = 2;

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

const getShortName = (row) => {
  if (row?.display_name && row.display_name.trim()) return row.display_name.trim();
  const mentionUser = getJidUser(row?.mention_id || row?.sender_id);
  return mentionUser ? `@${mentionUser}` : 'Desconhecido';
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

const getCachedProfilePic = (jid) => {
  const entry = PROFILE_PIC_CACHE.get(jid);
  if (!entry) return null;
  const lastAccess = entry.lastAccess || entry.createdAt || 0;
  if (Date.now() - lastAccess > PROFILE_CACHE_TTL_MS) {
    PROFILE_PIC_CACHE.delete(jid);
    return null;
  }
  entry.lastAccess = Date.now();
  return entry.buffer || null;
};

const setCachedProfilePic = (jid, buffer) => {
  if (!jid || !buffer) return;
  PROFILE_PIC_CACHE.set(jid, { buffer, createdAt: Date.now(), lastAccess: Date.now() });
  if (PROFILE_PIC_CACHE.size > PROFILE_CACHE_LIMIT) {
    const oldestKey = Array.from(PROFILE_PIC_CACHE.entries()).sort(
      (a, b) => (a[1].lastAccess || a[1].createdAt || 0) - (b[1].lastAccess || b[1].createdAt || 0),
    )[0]?.[0];
    if (oldestKey) PROFILE_PIC_CACHE.delete(oldestKey);
  }
};

const fetchProfileBuffer = async (sock, jid, remoteJid) => {
  const cached = getCachedProfilePic(jid);
  if (cached) return cached;
  const buffer = await getProfilePicBuffer(sock, { key: { participant: jid, remoteJid } });
  if (buffer) setCachedProfilePic(jid, buffer);
  return buffer;
};

const loadProfileImages = async ({ sock, jids, remoteJid, concurrency = 6 }) => {
  const results = new Map();
  if (!sock) return results;
  const queue = Array.from(new Set((jids || []).filter(Boolean)));
  let index = 0;

  const worker = async () => {
    while (index < queue.length) {
      const jid = queue[index];
      index += 1;
      if (results.has(jid)) continue;
      try {
        const buffer = await fetchProfileBuffer(sock, jid, remoteJid);
        if (!buffer) continue;
        const image = await loadImage(buffer);
        results.set(jid, image);
      } catch {
        // Ignora falhas de imagem
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
};

const drawRoundedRect = (ctx, x, y, w, h, r) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

const drawTrackedText = (ctx, text, x, y, tracking = 0) => {
  if (!text) return 0;
  let cursor = x;
  const chars = String(text).split('');
  chars.forEach((char) => {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + tracking;
  });
  return cursor - x;
};

const fitText = (ctx, text, maxWidth) => {
  if (!text) return '';
  const base = String(text);
  if (ctx.measureText(base).width <= maxWidth) return base;
  let trimmed = base;
  while (trimmed.length > 0 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed ? `${trimmed}…` : '';
};

const getInitials = (label) => {
  if (!label) return '?';
  const clean = label.replace('@', '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const formatCompactNumber = (value) => {
  const num = Number(value || 0);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return `${num}`;
};

const pickAvatarJid = (row) => {
  if (!row) return null;
  if (isWhatsAppUserId(row.mention_id)) return row.mention_id;
  if (isWhatsAppUserId(row.sender_id)) return row.sender_id;
  return null;
};

const drawAvatar = (ctx, { x, y, radius, image, fallbackLabel, borderColor = '#38bdf8' }) => {
  const glow = ctx.createRadialGradient(
    x - radius * 0.2,
    y - radius * 0.2,
    radius * 0.4,
    x,
    y,
    radius * 1.2,
  );
  glow.addColorStop(0, 'rgba(226, 232, 240, 0.25)');
  glow.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.save();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, '#1f2937');
    gradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.font = `bold ${Math.max(16, radius * 0.7)}px Poppins, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getInitials(fallbackLabel), x, y);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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
      current.first_message =
        current.first_message === null ? firstMs : Math.min(current.first_message, firstMs);
    }
    if (lastMs !== null) {
      current.last_message =
        current.last_message === null ? lastMs : Math.max(current.last_message, lastMs);
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

  const rows = Array.from(normalizedTotals.values()).sort(
    (a, b) => b.total_messages - a.total_messages,
  );
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

    const { where, params } = buildCanonicalWhere({
      scope,
      remoteJid,
      botJid,
      canonicalId: rawJid,
    });

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
export const buildRankingMessage = ({
  scope,
  limit,
  rows,
  totalMessages,
  topTotal,
  topType,
  dbStart,
}) => {
  const scopeTitle = scope === 'global' ? 'Global' : 'Grupo';
  const scopeLabel = scope === 'global' ? 'global' : 'grupo';

  if (!rows.length) {
    return `Nao ha mensagens suficientes para gerar o ranking ${scopeLabel}.\n\nInicio do banco (primeira mensagem): ${formatDate(dbStart)}`;
  }

  const totalLabel = Number(totalMessages || 0);
  const topShare =
    totalLabel > 0 ? ((Number(topTotal || 0) / totalLabel) * 100).toFixed(2) : '0.00';
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
    const favoriteType = row.favorite_type
      ? `${row.favorite_type} (${row.favorite_count || 0})`
      : 'N/D';
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

/**
 * Renderiza uma imagem de ranking horizontal.
 * @param {object} params
 * @param {object} params.sock
 * @param {string} params.remoteJid
 * @param {Array<object>} params.rows
 * @param {number} params.totalMessages
 * @param {{label: string, count: number}|null} params.topType
 * @param {'group'|'global'} params.scope
 * @param {number} params.limit
 * @returns {Promise<Buffer>}
 */
export const renderRankingImage = async ({
  sock,
  remoteJid,
  rows,
  totalMessages,
  topType,
  scope,
  limit,
}) => {
  const width = RANKING_IMAGE_WIDTH;
  const height = RANKING_IMAGE_HEIGHT;
  const scale = RANKING_IMAGE_SCALE;
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const baseGradient = ctx.createLinearGradient(0, 0, width, height);
  baseGradient.addColorStop(0, '#0f172a');
  baseGradient.addColorStop(1, '#111827');
  ctx.fillStyle = baseGradient;
  ctx.fillRect(0, 0, width, height);

  const radial = ctx.createRadialGradient(
    width * 0.3,
    height * 0.15,
    120,
    width * 0.5,
    height * 0.45,
    width,
  );
  radial.addColorStop(0, 'rgba(148, 163, 184, 0.2)');
  radial.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  const drawBlob = (x, y, r, color, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  drawBlob(width * 0.82, height * 0.22, 180, '#1d4ed8', 0.08);
  drawBlob(width * 0.12, height * 0.75, 220, '#22c55e', 0.05);

  const noiseSize = 180;
  const noiseCanvas = createCanvas(noiseSize, noiseSize);
  const noiseCtx = noiseCanvas.getContext('2d');
  const noiseData = noiseCtx.createImageData(noiseSize, noiseSize);
  for (let i = 0; i < noiseData.data.length; i += 4) {
    const value = 200 + Math.floor(Math.random() * 55);
    noiseData.data[i] = value;
    noiseData.data[i + 1] = value;
    noiseData.data[i + 2] = value;
    noiseData.data[i + 3] = 12;
  }
  noiseCtx.putImageData(noiseData, 0, 0);
  const noisePattern = ctx.createPattern(noiseCanvas, 'repeat');
  if (noisePattern) {
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = noisePattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const title =
    scope === 'global' ? `Ranking Global Top ${limit}` : `Ranking do Grupo Top ${limit}`;
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 40px Poppins, Arial';
  ctx.textAlign = 'left';
  const titleWidth = drawTrackedText(ctx, title, 40, 60, 1.2);
  const titleAccentX = 40 + titleWidth + 12;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(titleAccentX, 48);
  ctx.lineTo(titleAccentX + 36, 48);
  ctx.stroke();
  if (scope === 'global') {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '22px Poppins, Arial';
    ctx.fillText('🌍', titleAccentX + 42, 56);
  }

  ctx.font = '16px Poppins, Arial';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
  const topTypeLabel = topType?.label ? `${topType.label} (${topType.count})` : 'N/D';
  ctx.fillText(
    `${formatCompactNumber(totalMessages)} mensagens • Tipo mais usado: ${topTypeLabel}`,
    40,
    92,
  );

  const topRows = rows.slice(0, 2);
  const restRows = rows.slice(2);
  const avatarJids = rows.map((row) => pickAvatarJid(row)).filter(Boolean);
  const avatars = await loadProfileImages({ sock, jids: avatarJids, remoteJid });

  const margin = 40;
  const gap = 24;
  const headerHeight = 130;
  const podiumHeight = 300;

  const availableWidth = width - margin * 2;
  const baseTopCardWidth = (availableWidth - gap) / 2;
  const baseTopCardHeight = podiumHeight;
  const topCardY = headerHeight;
  const baseBottom = topCardY + baseTopCardHeight;
  const rank1Scale = 1.05;
  const rank2Scale = 0.96;
  const rank1Width = baseTopCardWidth * rank1Scale;
  const rank2Width = baseTopCardWidth * rank2Scale;
  const topRowWidth = rank1Width + rank2Width + gap;
  const topRowStartX = margin + Math.max(0, (availableWidth - topRowWidth) / 2);
  const rank1Height = baseTopCardHeight * rank1Scale;
  const rank2Height = baseTopCardHeight * rank2Scale;

  const rankColors = {
    1: '#facc15',
    2: '#38bdf8',
    3: '#34d399',
    4: '#94a3b8',
    5: '#64748b',
  };

  const drawMetricLine = ({ icon, label, x, y, iconColor, textColor, font }) => {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '18px Poppins, Arial';
    ctx.fillStyle = iconColor || 'rgba(148, 163, 184, 0.75)';
    ctx.fillText(icon, x, y);
    const iconWidth = ctx.measureText(icon).width;
    ctx.font = font;
    ctx.fillStyle = textColor;
    ctx.fillText(label, x + iconWidth + 6, y);
    ctx.restore();
  };

  const drawCard = ({ row, x, y, w, h, rank }) => {
    if (!row) return;
    const accentColor = rankColors[rank] || '#94a3b8';
    const isTop = rank === 1;
    ctx.save();
    ctx.shadowColor = isTop ? 'rgba(250, 204, 21, 0.55)' : 'rgba(15, 23, 42, 0.35)';
    ctx.shadowBlur = isTop ? 32 : 18;
    drawRoundedRect(ctx, x, y, w, h, 24);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = accentColor || '#1f2937';
    ctx.stroke();
    ctx.restore();

    const pad = 22;
    const avatarRadius = Math.min(74, h * 0.36);
    const avatarX = x + pad + avatarRadius;
    const avatarY = y + h / 2;
    const label = getShortName(row);
    const avatarImage = avatars.get(pickAvatarJid(row)) || null;
    drawAvatar(ctx, {
      x: avatarX,
      y: avatarY,
      radius: avatarRadius,
      image: avatarImage,
      fallbackLabel: label,
      borderColor: accentColor,
    });

    const rankBadgeSize = 46;
    ctx.save();
    ctx.fillStyle = accentColor || '#22d3ee';
    ctx.beginPath();
    ctx.arc(
      x + pad + rankBadgeSize / 2,
      y + pad + rankBadgeSize / 2,
      rankBadgeSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 20px Poppins, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(rank), x + pad + rankBadgeSize / 2, y + pad + rankBadgeSize / 2);
    ctx.restore();
    if (rank === 1) {
      ctx.save();
      ctx.font = '18px Poppins, Arial';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('👑', x + pad + rankBadgeSize + 6, y + pad + 16);
      const badgeW = 64;
      const badgeH = 24;
      const badgeX = x + w - pad - badgeW;
      const badgeY = y + pad - 2;
      drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 12);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 12px Poppins, Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TOP 1', badgeX + badgeW / 2, badgeY + badgeH / 2);
      ctx.restore();
    }

    const textX = avatarX + avatarRadius + 18;
    const textWidth = x + w - pad - textX;

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px Poppins, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fitText(ctx, label, textWidth), textX, y + h / 2 - 40);

    const total = formatCompactNumber(row.total_messages || 0);
    const percent =
      totalMessages > 0
        ? ((Number(row.total_messages || 0) / totalMessages) * 100).toFixed(1)
        : '0.0';
    const lineOneY = y + h / 2 + 6;
    drawMetricLine({
      icon: '💬',
      label: `Mensagens: ${total}`,
      x: textX,
      y: lineOneY,
      iconColor: 'rgba(148, 163, 184, 0.75)',
      textColor: '#e2e8f0',
      font: 'bold 20px Poppins, Arial',
    });
    drawMetricLine({
      icon: '📊',
      label: `% do total: ${percent}%`,
      x: textX,
      y: lineOneY + 26,
      iconColor: 'rgba(148, 163, 184, 0.75)',
      textColor: 'rgba(148, 163, 184, 0.85)',
      font: '18px Poppins, Arial',
    });
  };

  drawCard({
    row: topRows[0],
    x: topRowStartX,
    y: baseBottom - rank1Height,
    w: rank1Width,
    h: rank1Height,
    rank: 1,
  });
  drawCard({
    row: topRows[1],
    x: topRowStartX + rank1Width + gap,
    y: baseBottom - rank2Height,
    w: rank2Width,
    h: rank2Height,
    rank: 2,
  });

  const restTop = headerHeight + podiumHeight + 40;
  if (restRows.length) {
    const restCount = restRows.length;
    const restGap = 18;
    const restWidth = (width - margin * 2 - restGap * (restCount - 1)) / restCount;
    const restHeight = Math.min(220, height - restTop - margin);
    restRows.forEach((row, idx) => {
      const x = margin + idx * (restWidth + restGap);
      const y = restTop;
      drawCard({
        row,
        x,
        y,
        w: restWidth,
        h: restHeight,
        rank: idx + 3,
      });
    });
  }

  const footerY = height - 34;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.font = '14px Poppins, Arial';
  const updatedAt = formatDate(new Date());
  ctx.textAlign = 'left';
  ctx.fillText(`📅 Atualizado em: ${updatedAt}`, 40, footerY);
  ctx.fillText('⚙️ Dados coletados automaticamente', 40, footerY + 18);
  ctx.textAlign = 'right';
  ctx.fillText('🤖 Powered by OmniZap System', width - 40, footerY + 18);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
};
