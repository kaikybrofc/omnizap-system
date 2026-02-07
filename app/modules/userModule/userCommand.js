import { executeQuery, TABLES } from '../../../database/index.js';
import { getJidUser, getProfilePicBuffer, normalizeJid } from '../../config/baileysConfig.js';
import { isUserAdmin } from '../../config/groupUtils.js';
import {
  extractUserIdInfo,
  isWhatsAppUserId,
  resolveUserId,
  resolveUserIdCached,
} from '../../services/lidMapService.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import premiumUserStore from '../../store/premiumUserStore.js';
import logger from '../../utils/logger/loggerModule.js';
import { MESSAGE_TYPE_SQL, TIMESTAMP_TO_DATETIME_SQL } from '../statsModule/rankingCommon.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const ACTIVE_DAYS_WINDOW = Number.parseInt(process.env.USER_PROFILE_ACTIVE_DAYS || '30', 10);
const OWNER_JID = process.env.USER_ADMIN ? normalizeJid(process.env.USER_ADMIN) : null;
const MIN_PHONE_DIGITS = 5;
const MAX_PHONE_DIGITS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOCIAL_RECENT_DAYS = Number.parseInt(process.env.USER_PROFILE_SOCIAL_DAYS || '45', 10);
const SOCIAL_DST_EXPR = `JSON_UNQUOTE(
  COALESCE(
    JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.participant'),
    JSON_EXTRACT(m.raw_message, '$.message.extendedTextMessage.contextInfo.mentionedJid[0]'),
    JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.participant'),
    JSON_EXTRACT(m.raw_message, '$.message.imageMessage.contextInfo.mentionedJid[0]'),
    JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.participant'),
    JSON_EXTRACT(m.raw_message, '$.message.videoMessage.contextInfo.mentionedJid[0]'),
    JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.participant'),
    JSON_EXTRACT(m.raw_message, '$.message.documentMessage.contextInfo.mentionedJid[0]')
  )
)`;

const buildUsageText = (commandPrefix = DEFAULT_COMMAND_PREFIX) =>
  [
    'Formato de uso:',
    `${commandPrefix}user perfil <id|telefone>`,
    '',
    'Dica:',
    '• Você pode mencionar alguém.',
    '• Ou responder a mensagem do usuário desejado.',
  ].join('\n');

const getContextInfo = (messageInfo) => {
  const message = messageInfo?.message;
  if (!message || typeof message !== 'object') return null;

  for (const value of Object.values(message)) {
    if (value?.contextInfo && typeof value.contextInfo === 'object') {
      return value.contextInfo;
    }
    if (value?.message && typeof value.message === 'object') {
      for (const nested of Object.values(value.message)) {
        if (nested?.contextInfo && typeof nested.contextInfo === 'object') {
          return nested.contextInfo;
        }
      }
    }
  }

  return null;
};

const parseTargetArgument = (rawValue) => {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return { jid: null, invalid: false };

  const withoutAt = value.startsWith('@') ? value.slice(1).trim() : value;
  if (!withoutAt) return { jid: null, invalid: true };

  if (withoutAt.includes('@')) {
    const normalized = normalizeJid(withoutAt);
    return normalized ? { jid: normalized, invalid: false } : { jid: null, invalid: true };
  }

  const digits = withoutAt.replace(/\D/g, '');
  const hasValidLength = digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
  if (!digits || !hasValidLength) return { jid: null, invalid: true };

  return { jid: `${digits}@s.whatsapp.net`, invalid: false };
};

const resolveCandidateTarget = (messageInfo, senderJid, targetArg) => {
  const contextInfo = getContextInfo(messageInfo);
  const mentioned = Array.isArray(contextInfo?.mentionedJid)
    ? contextInfo.mentionedJid.find(Boolean) || null
    : null;
  const parsedTarget = parseTargetArgument(targetArg);
  const repliedSource =
    contextInfo?.participant || contextInfo?.participantAlt
      ? {
          participant: contextInfo.participant || null,
          participantAlt: contextInfo.participantAlt || null,
        }
      : null;
  const hasContextTarget = Boolean(mentioned || repliedSource);

  return {
    source: mentioned || parsedTarget.jid || repliedSource || senderJid || null,
    invalidExplicitTarget: parsedTarget.invalid && !hasContextTarget,
  };
};

const resolveCanonicalTarget = async (source) => {
  if (!source) return null;
  const info = extractUserIdInfo(source);
  const fallbackId = resolveUserIdCached(info) || info.raw || null;
  try {
    const resolved = await resolveUserId(info);
    return normalizeJid(resolved) || resolved || fallbackId;
  } catch (error) {
    logger.warn('Falha ao resolver alvo no comando user perfil.', {
      error: error.message,
      source: info.raw,
    });
    return fallbackId;
  }
};

const resolveSenderIdsForTarget = async (canonicalTarget) => {
  if (!canonicalTarget) return [];
  const ids = new Set([canonicalTarget]);

  if (isWhatsAppUserId(canonicalTarget)) {
    const rows = await executeQuery(`SELECT lid FROM ${TABLES.LID_MAP} WHERE jid = ?`, [canonicalTarget]);
    (rows || []).forEach((row) => {
      if (row?.lid) ids.add(row.lid);
    });
  } else {
    const rows = await executeQuery(`SELECT jid FROM ${TABLES.LID_MAP} WHERE lid = ?`, [canonicalTarget]);
    (rows || []).forEach((row) => {
      if (row?.jid) ids.add(normalizeJid(row.jid) || row.jid);
    });
  }

  return Array.from(ids);
};

const buildInClause = (items) => items.map(() => '?').join(', ');

const fetchUserStats = async ({ canonicalId, senderIds = [] }) => {
  if (canonicalId) {
    const [row] = await executeQuery(
      `SELECT COUNT(*) AS total_messages,
              MIN(m.timestamp) AS first_message,
              MAX(m.timestamp) AS last_message
         FROM ${TABLES.MESSAGES} m
         LEFT JOIN ${TABLES.LID_MAP} lm
           ON lm.lid = m.sender_id
          AND lm.jid IS NOT NULL
        WHERE m.sender_id IS NOT NULL
          AND COALESCE(lm.jid, m.sender_id) = ?`,
      [canonicalId],
    );

    return {
      totalMessages: Number(row?.total_messages || 0),
      firstMessage: row?.first_message || null,
      lastMessage: row?.last_message || null,
    };
  }

  if (!senderIds.length) return { totalMessages: 0, firstMessage: null, lastMessage: null };

  const inClause = buildInClause(senderIds);
  const [row] = await executeQuery(
    `SELECT COUNT(*) AS total_messages,
            MIN(timestamp) AS first_message,
            MAX(timestamp) AS last_message
       FROM ${TABLES.MESSAGES}
      WHERE sender_id IN (${inClause})`,
    senderIds,
  );

  return {
    totalMessages: Number(row?.total_messages || 0),
    firstMessage: row?.first_message || null,
    lastMessage: row?.last_message || null,
  };
};

const toMillis = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const formatPercent = (value, total) => {
  const numericValue = Number(value || 0);
  const numericTotal = Number(total || 0);
  if (numericTotal <= 0) return '0.00%';
  return `${((numericValue / numericTotal) * 100).toFixed(2)}%`;
};

const toIntegerDays = (fromMs, toMs = Date.now()) => {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return 0;
  return Math.floor((toMs - fromMs) / DAY_MS);
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

const fetchUserGlobalRankingInsights = async ({
  canonicalId,
  totalMessages = 0,
  firstMessage = null,
  lastMessage = null,
}) => {
  if (!canonicalId) {
    return {
      activeDays: 0,
      avgPerDay: '0.00',
      streakDays: 0,
      favoriteType: null,
      favoriteCount: 0,
    };
  }

  const daysRows = await executeQuery(
    `SELECT DISTINCT DATE(ts) AS day
       FROM (
         SELECT ${TIMESTAMP_TO_DATETIME_SQL} AS ts
           FROM ${TABLES.MESSAGES} m
           LEFT JOIN ${TABLES.LID_MAP} lm
             ON lm.lid = m.sender_id
            AND lm.jid IS NOT NULL
          WHERE m.sender_id IS NOT NULL
            AND COALESCE(lm.jid, m.sender_id) = ?
            AND m.timestamp IS NOT NULL
       ) d
      WHERE d.ts IS NOT NULL
      ORDER BY day ASC`,
    [canonicalId],
  );
  const days = (daysRows || []).map((item) => item.day).filter(Boolean);
  const activeDays = days.length;
  const streakDays = computeStreak(days);

  const firstMs = toMillis(firstMessage);
  const lastMs = toMillis(lastMessage);
  let avgPerDay = '0.00';
  if (Number(totalMessages) > 0 && firstMs !== null && lastMs !== null) {
    const rangeDays = Math.max(1, Math.ceil((lastMs - firstMs) / DAY_MS) + 1);
    avgPerDay = (Number(totalMessages) / rangeDays).toFixed(2);
  }

  const [favRow] = await executeQuery(
    `SELECT
        ${MESSAGE_TYPE_SQL} AS message_type,
        COUNT(*) AS total
      FROM ${TABLES.MESSAGES} m
      LEFT JOIN ${TABLES.LID_MAP} lm
        ON lm.lid = m.sender_id
       AND lm.jid IS NOT NULL
      WHERE m.sender_id IS NOT NULL
        AND COALESCE(lm.jid, m.sender_id) = ?
        AND m.raw_message IS NOT NULL
      GROUP BY message_type
      ORDER BY total DESC
      LIMIT 1`,
    [canonicalId],
  );

  return {
    activeDays,
    avgPerDay,
    streakDays,
    favoriteType: favRow?.message_type || null,
    favoriteCount: Number(favRow?.total || 0),
  };
};

const fetchUserTrendInsights = async (canonicalId) => {
  if (!canonicalId) return { last30: 0, prev30: 0, delta: 0, trendLabel: 'estável' };

  const [row] = await executeQuery(
    `SELECT
        SUM(CASE WHEN m.timestamp >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS last30,
        SUM(
          CASE
            WHEN m.timestamp < NOW() - INTERVAL 30 DAY
             AND m.timestamp >= NOW() - INTERVAL 60 DAY
            THEN 1
            ELSE 0
          END
        ) AS prev30
      FROM ${TABLES.MESSAGES} m
      LEFT JOIN ${TABLES.LID_MAP} lm
        ON lm.lid = m.sender_id
       AND lm.jid IS NOT NULL
      WHERE m.sender_id IS NOT NULL
        AND m.timestamp IS NOT NULL
        AND COALESCE(lm.jid, m.sender_id) = ?`,
    [canonicalId],
  );

  const last30 = Number(row?.last30 || 0);
  const prev30 = Number(row?.prev30 || 0);
  const delta = last30 - prev30;
  const trendLabel = delta > 0 ? 'subiu' : delta < 0 ? 'caiu' : 'estável';
  return { last30, prev30, delta, trendLabel };
};

const getHourBand = (hour) => {
  const h = Number(hour);
  if (!Number.isFinite(h) || h < 0 || h > 23) return 'N/D';
  if (h < 6) return 'madrugada';
  if (h < 12) return 'manhã';
  if (h < 18) return 'tarde';
  return 'noite';
};

const fetchUserActiveHourInsights = async (canonicalId) => {
  if (!canonicalId) return { activeHour: null, hourBand: 'N/D', count: 0 };
  const [row] = await executeQuery(
    `SELECT HOUR(m.timestamp) AS active_hour,
            COUNT(*) AS total
       FROM ${TABLES.MESSAGES} m
       LEFT JOIN ${TABLES.LID_MAP} lm
         ON lm.lid = m.sender_id
        AND lm.jid IS NOT NULL
      WHERE m.sender_id IS NOT NULL
        AND m.timestamp IS NOT NULL
        AND COALESCE(lm.jid, m.sender_id) = ?
      GROUP BY HOUR(m.timestamp)
      ORDER BY total DESC
      LIMIT 1`,
    [canonicalId],
  );

  const activeHour = row?.active_hour ?? null;
  return {
    activeHour,
    hourBand: getHourBand(activeHour),
    count: Number(row?.total || 0),
  };
};

const fetchDominantTypeByPeriod = async (canonicalId) => {
  if (!canonicalId) {
    return {
      last30: { type: null, count: 0 },
      prev30: { type: null, count: 0 },
    };
  }

  const rows = await executeQuery(
    `SELECT period, message_type, total
       FROM (
             SELECT
               CASE
                 WHEN m.timestamp >= NOW() - INTERVAL 30 DAY THEN 'last30'
                 ELSE 'prev30'
               END AS period,
               ${MESSAGE_TYPE_SQL} AS message_type,
               COUNT(*) AS total
             FROM ${TABLES.MESSAGES} m
             LEFT JOIN ${TABLES.LID_MAP} lm
               ON lm.lid = m.sender_id
              AND lm.jid IS NOT NULL
             WHERE m.sender_id IS NOT NULL
               AND m.raw_message IS NOT NULL
               AND m.timestamp IS NOT NULL
               AND m.timestamp >= NOW() - INTERVAL 60 DAY
               AND COALESCE(lm.jid, m.sender_id) = ?
             GROUP BY period, message_type
            ) t
      ORDER BY period, total DESC`,
    [canonicalId],
  );

  const result = {
    last30: { type: null, count: 0 },
    prev30: { type: null, count: 0 },
  };
  (rows || []).forEach((row) => {
    const period = row?.period;
    if (!period || !result[period]) return;
    if (result[period].type) return;
    result[period] = {
      type: row?.message_type || null,
      count: Number(row?.total || 0),
    };
  });

  return result;
};

const fetchUserRanking = async (canonicalId) => {
  if (!canonicalId) {
    return { position: null, totalRankedUsers: 0, totalMessages: 0 };
  }

  const [totalRow] = await executeQuery(
    `SELECT COUNT(*) AS total_messages
       FROM ${TABLES.MESSAGES} m
       LEFT JOIN ${TABLES.LID_MAP} lm ON lm.lid = m.sender_id
      WHERE m.sender_id IS NOT NULL
        AND COALESCE(lm.jid, m.sender_id) = ?`,
    [canonicalId],
  );
  const totalMessages = Number(totalRow?.total_messages || 0);

  const [rankedUsersRow] = await executeQuery(
    `SELECT COUNT(*) AS total_ranked_users
       FROM (
             SELECT COALESCE(lm.jid, m.sender_id) AS canonical_id
               FROM ${TABLES.MESSAGES} m
               LEFT JOIN ${TABLES.LID_MAP} lm ON lm.lid = m.sender_id
              WHERE m.sender_id IS NOT NULL
              GROUP BY COALESCE(lm.jid, m.sender_id)
            ) ranked_users`,
  );
  const totalRankedUsers = Number(rankedUsersRow?.total_ranked_users || 0);

  if (totalMessages <= 0) {
    return { position: null, totalRankedUsers, totalMessages };
  }

  const [rankRow] = await executeQuery(
    `SELECT COUNT(*) + 1 AS rank_position
       FROM (
             SELECT COALESCE(lm.jid, m.sender_id) AS canonical_id,
                    COUNT(*) AS total_messages
               FROM ${TABLES.MESSAGES} m
               LEFT JOIN ${TABLES.LID_MAP} lm ON lm.lid = m.sender_id
              WHERE m.sender_id IS NOT NULL
              GROUP BY COALESCE(lm.jid, m.sender_id)
            ) ranked
      WHERE ranked.total_messages > ?`,
    [totalMessages],
  );

  return {
    position: Number.isFinite(Number(rankRow?.rank_position)) ? Number(rankRow.rank_position) : null,
    totalRankedUsers,
    totalMessages,
  };
};

const fetchLatestPushName = async (senderIds) => {
  if (!senderIds.length) return null;
  const inClause = buildInClause(senderIds);
  const [row] = await executeQuery(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(raw_message, '$.pushName')) AS push_name
       FROM ${TABLES.MESSAGES}
      WHERE sender_id IN (${inClause})
        AND raw_message IS NOT NULL
        AND JSON_EXTRACT(raw_message, '$.pushName') IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`,
    senderIds,
  );
  return row?.push_name || null;
};

const resolveNameFromContacts = (sock, ids) => {
  for (const id of ids) {
    const contact = sock?.contacts?.[id];
    const name = contact?.notify || contact?.name || contact?.short || null;
    if (name) return name;
  }
  return null;
};

const fetchCanonicalPushName = async (canonicalId) => {
  if (!canonicalId) return null;
  const [row] = await executeQuery(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(m.raw_message, '$.pushName')) AS push_name
       FROM ${TABLES.MESSAGES} m
       LEFT JOIN ${TABLES.LID_MAP} lm
         ON lm.lid = m.sender_id
        AND lm.jid IS NOT NULL
      WHERE m.sender_id IS NOT NULL
        AND COALESCE(lm.jid, m.sender_id) = ?
        AND m.raw_message IS NOT NULL
        AND JSON_EXTRACT(m.raw_message, '$.pushName') IS NOT NULL
      ORDER BY m.id DESC
      LIMIT 1`,
    [canonicalId],
  );
  return row?.push_name || null;
};

const buildSocialBaseQuery = (selectSql) => `
  WITH base AS (
    SELECT
      COALESCE(src_map.jid, m.sender_id) AS src,
      COALESCE(dst_map.jid, ${SOCIAL_DST_EXPR}) AS dst
    FROM ${TABLES.MESSAGES} m
    LEFT JOIN ${TABLES.LID_MAP} src_map
      ON src_map.lid = m.sender_id
     AND src_map.jid IS NOT NULL
    LEFT JOIN ${TABLES.LID_MAP} dst_map
      ON dst_map.lid = ${SOCIAL_DST_EXPR}
     AND dst_map.jid IS NOT NULL
    WHERE m.raw_message IS NOT NULL
      AND m.sender_id IS NOT NULL
      AND m.timestamp IS NOT NULL
      AND m.timestamp >= NOW() - INTERVAL ${SOCIAL_RECENT_DAYS} DAY
      AND ${SOCIAL_DST_EXPR} IS NOT NULL
      AND ${SOCIAL_DST_EXPR} <> ''
      AND COALESCE(src_map.jid, m.sender_id) <> COALESCE(dst_map.jid, ${SOCIAL_DST_EXPR})
  )
  ${selectSql}
`;

const fetchUserSocialInsights = async ({ canonicalId, sock }) => {
  if (!canonicalId) {
    return {
      repliesSent: 0,
      repliesReceived: 0,
      socialScore: 0,
      uniquePartners: 0,
      topPartnerId: null,
      topPartnerCount: 0,
      topPartnerLabel: 'N/D',
      responseRatePercent: '0.00%',
      responseRatio: '0/0',
      topPartners: [],
    };
  }

  const [summaryRow] = await executeQuery(
    buildSocialBaseQuery(
      `SELECT
          SUM(CASE WHEN src = ? THEN 1 ELSE 0 END) AS replies_sent,
          SUM(CASE WHEN dst = ? THEN 1 ELSE 0 END) AS replies_received,
          COUNT(DISTINCT CASE
            WHEN src = ? THEN dst
            WHEN dst = ? THEN src
            ELSE NULL
          END) AS unique_partners
        FROM base
       WHERE src = ? OR dst = ?`,
    ),
    [canonicalId, canonicalId, canonicalId, canonicalId, canonicalId, canonicalId],
  );

  const topPartnerRows = await executeQuery(
    buildSocialBaseQuery(
      `SELECT
          CASE WHEN src = ? THEN dst ELSE src END AS partner_id,
          COUNT(*) AS total
        FROM base
       WHERE src = ? OR dst = ?
       GROUP BY partner_id
       ORDER BY total DESC
       LIMIT 3`,
    ),
    [canonicalId, canonicalId, canonicalId],
  );

  const repliesSent = Number(summaryRow?.replies_sent || 0);
  const repliesReceived = Number(summaryRow?.replies_received || 0);
  const uniquePartners = Number(summaryRow?.unique_partners || 0);
  const topPartners = await Promise.all(
    (topPartnerRows || []).map(async (row) => {
      const id = row?.partner_id || null;
      const count = Number(row?.total || 0);
      const mention = id && getJidUser(id) ? `@${getJidUser(id)}` : null;
      const fromContacts = resolveNameFromContacts(sock, id ? [id] : []);
      const pushName = id ? await fetchCanonicalPushName(id) : null;
      const label = fromContacts || pushName || mention || id || 'N/D';
      return { id, count, label };
    }),
  );
  const topPartner = topPartners[0] || null;
  const topPartnerId = topPartner?.id || null;
  const topPartnerCount = Number(topPartner?.count || 0);
  const topPartnerLabel = topPartner?.label || 'N/D';
  const totalSocial = repliesSent + repliesReceived;
  const responseRatePercent = totalSocial > 0 ? `${((repliesSent / totalSocial) * 100).toFixed(2)}%` : '0.00%';
  const responseRatio = `${repliesSent}/${repliesReceived}`;

  return {
    repliesSent,
    repliesReceived,
    socialScore: repliesSent + repliesReceived,
    uniquePartners,
    topPartnerId,
    topPartnerCount,
    topPartnerLabel,
    responseRatePercent,
    responseRatio,
    topPartners,
  };
};

const fetchTopGroupsInsights = async (canonicalId) => {
  if (!canonicalId) return [];
  const rows = await executeQuery(
    `SELECT
        m.chat_id,
        COALESCE(gm.subject, '') AS group_subject,
        COUNT(*) AS total
      FROM ${TABLES.MESSAGES} m
      LEFT JOIN ${TABLES.LID_MAP} lm
        ON lm.lid = m.sender_id
       AND lm.jid IS NOT NULL
      LEFT JOIN ${TABLES.GROUPS_METADATA} gm
        ON gm.id = m.chat_id
      WHERE m.sender_id IS NOT NULL
        AND m.chat_id LIKE '%@g.us'
        AND COALESCE(lm.jid, m.sender_id) = ?
      GROUP BY m.chat_id, gm.subject
      ORDER BY total DESC
      LIMIT 3`,
    [canonicalId],
  );
  return (rows || []).map((row) => ({
    chatId: row?.chat_id || null,
    subject: row?.group_subject ? String(row.group_subject).trim() : null,
    total: Number(row?.total || 0),
  }));
};

const fetchParticipationInsights = async ({ canonicalId, totalMessages, remoteJid, isGroupMessage }) => {
  const [globalRow] = await executeQuery(
    `SELECT COUNT(*) AS total
       FROM ${TABLES.MESSAGES}
      WHERE sender_id IS NOT NULL`,
  );
  const globalTotal = Number(globalRow?.total || 0);

  const globalShare = formatPercent(totalMessages, globalTotal);

  if (!isGroupMessage || !remoteJid || !canonicalId) {
    return {
      globalTotal,
      globalShare,
      groupTotal: 0,
      groupUserTotal: 0,
      groupShare: 'N/D',
    };
  }

  const [groupTotalsRow, groupUserRow] = await Promise.all([
    executeQuery(
      `SELECT COUNT(*) AS total
         FROM ${TABLES.MESSAGES}
        WHERE sender_id IS NOT NULL
          AND chat_id = ?`,
      [remoteJid],
    ),
    executeQuery(
      `SELECT COUNT(*) AS total
         FROM ${TABLES.MESSAGES} m
         LEFT JOIN ${TABLES.LID_MAP} lm
           ON lm.lid = m.sender_id
          AND lm.jid IS NOT NULL
        WHERE m.sender_id IS NOT NULL
          AND m.chat_id = ?
          AND COALESCE(lm.jid, m.sender_id) = ?`,
      [remoteJid, canonicalId],
    ),
  ]);

  const groupTotal = Number(groupTotalsRow?.[0]?.total || 0);
  const groupUserTotal = Number(groupUserRow?.[0]?.total || 0);
  const groupShare = groupTotal > 0 ? formatPercent(groupUserTotal, groupTotal) : '0.00%';

  return {
    globalTotal,
    globalShare,
    groupTotal,
    groupUserTotal,
    groupShare,
  };
};

const formatPhone = (jid) => {
  const user = getJidUser(jid);
  if (!user) return 'N/D';
  const digits = user.replace(/\D/g, '');
  return digits ? `+${digits}` : user;
};

const formatDateTime = (value) => {
  if (!value) return 'Sem registros';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem registros';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
};

const hasRecentInteraction = (lastMessage) => {
  if (!lastMessage) return false;
  const parsed = lastMessage instanceof Date ? lastMessage.getTime() : new Date(lastMessage).getTime();
  if (!Number.isFinite(parsed)) return false;
  const maxAgeMs = ACTIVE_DAYS_WINDOW * 24 * 60 * 60 * 1000;
  return Date.now() - parsed <= maxAgeMs;
};

const isTargetBlocked = async (sock, targetIds) => {
  if (!sock || typeof sock.fetchBlocklist !== 'function') return false;
  try {
    const blocklist = await sock.fetchBlocklist();
    if (!Array.isArray(blocklist) || blocklist.length === 0) return false;
    const normalizedBlocked = new Set(
      blocklist.map((jid) => normalizeJid(jid) || jid).filter(Boolean),
    );
    return targetIds.some((id) => normalizedBlocked.has(normalizeJid(id) || id));
  } catch (error) {
    logger.warn('Falha ao consultar blocklist no comando user perfil.', { error: error.message });
    return false;
  }
};

const formatTempoDeCasa = (firstMessage) => {
  const firstMs = toMillis(firstMessage);
  if (!Number.isFinite(firstMs)) return 'N/D';
  const days = toIntegerDays(firstMs, Date.now());
  return `${days} dia(s)`;
};

const formatDaysSinceLastMessage = (lastMessage) => {
  const lastMs = toMillis(lastMessage);
  if (!Number.isFinite(lastMs)) return 'N/D';
  return `${toIntegerDays(lastMs, Date.now())} dia(s)`;
};

const formatTrendLabel = ({ trendLabel, delta, last30, prev30 }) => {
  const sign = delta > 0 ? '+' : '';
  return `${trendLabel} (${sign}${delta} | 30d: ${last30} vs ant.: ${prev30})`;
};

const truncateLabel = (value, max = 30) => {
  const input = String(value || '');
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}…`;
};

const formatActiveHourLabel = ({ hourBand, activeHour, count }) => {
  if (!Number.isFinite(Number(activeHour))) return 'N/D';
  return `${hourBand} (${String(activeHour).padStart(2, '0')}h, ${count} msg)`;
};

const formatDominantTypeByPeriod = (dominantByPeriod) => {
  const last30Type = dominantByPeriod?.last30?.type || 'N/D';
  const last30Count = Number(dominantByPeriod?.last30?.count || 0);
  const prev30Type = dominantByPeriod?.prev30?.type || 'N/D';
  const prev30Count = Number(dominantByPeriod?.prev30?.count || 0);
  return `30d: ${last30Type} (${last30Count}) | ant.: ${prev30Type} (${prev30Count})`;
};

const formatTopPartnersLine = (topPartners = []) => {
  if (!Array.isArray(topPartners) || topPartners.length === 0) return 'N/D';
  return topPartners
    .slice(0, 3)
    .map((entry, index) => `${index + 1}) ${truncateLabel(entry.label, 26)} (${entry.count})`)
    .join(' | ');
};

const formatTopGroupsLine = (topGroups = []) => {
  if (!Array.isArray(topGroups) || topGroups.length === 0) return 'N/D';
  return topGroups
    .slice(0, 3)
    .map(
      (entry, index) =>
        `${index + 1}) ${truncateLabel((entry.subject && entry.subject.trim()) || entry.chatId || 'grupo', 24)} (${entry.total})`,
    )
    .join(' | ');
};

const buildProfileMessage = ({
  mentionLabel,
  displayName,
  phone,
  canonicalTarget,
  status,
  firstMessage,
  tempoDeCasa,
  lastInteraction,
  diasSemFalar,
  totalMessages,
  rankingLabel,
  trendLabel,
  avgPerDay,
  activeDays,
  streakDays,
  activeHourLabel,
  favoriteTypeLabel,
  dominantTypeByPeriodLabel,
  socialScore,
  socialSent,
  socialReceived,
  responseRateLabel,
  socialPartners,
  topPartnerLabel,
  topPartnersLabel,
  topGroupsLabel,
  globalShareLabel,
  groupShareLabel,
  tags,
}) =>
  [
    '👤 *PERFIL DO USUÁRIO*',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '🧾 *Identificação*',
    `• Usuário: ${mentionLabel}`,
    `• Nome: ${displayName}`,
    `• Número: ${phone}`,
    `• ID: ${canonicalTarget || 'N/D'}`,
    `• Status: *${status}*`,
    '',
    '📈 *Mensagens e Ranking*',
    `• Primeira mensagem: ${firstMessage}`,
    `• Tempo de casa no bot: ${tempoDeCasa}`,
    `• Última interação: ${lastInteraction}`,
    `• Dias sem falar: ${diasSemFalar}`,
    `• Mensagens gerais registradas: ${totalMessages}`,
    `• Participação global: ${globalShareLabel}`,
    `• Participação no grupo atual: ${groupShareLabel}`,
    `• Posição no ranking: ${rankingLabel}`,
    `• Tendência de mensagens: ${trendLabel}`,
    `• Média/dia (global): ${avgPerDay}`,
    `• Dias ativos (global): ${activeDays}`,
    `• Streak (global): ${streakDays} dia(s)`,
    `• Horário mais ativo: ${activeHourLabel}`,
    `• Tipo favorito (global): ${favoriteTypeLabel}`,
    `• Tipo dominante por período: ${dominantTypeByPeriodLabel}`,
    '',
    '🌐 *Interações Sociais*',
    `• Interações sociais (${SOCIAL_RECENT_DAYS}d): ${socialScore}`,
    `• Respostas enviadas (${SOCIAL_RECENT_DAYS}d): ${socialSent}`,
    `• Respostas recebidas (${SOCIAL_RECENT_DAYS}d): ${socialReceived}`,
    `• Taxa de resposta (${SOCIAL_RECENT_DAYS}d): ${responseRateLabel}`,
    `• Parceiros sociais (${SOCIAL_RECENT_DAYS}d): ${socialPartners}`,
    `• Parceiro principal (${SOCIAL_RECENT_DAYS}d): ${topPartnerLabel}`,
    `• Top 3 parceiros (${SOCIAL_RECENT_DAYS}d): ${topPartnersLabel}`,
    '',
    '🏘️ *Presença em Grupos*',
    `• Top grupos onde fala:\n ${topGroupsLabel}`,
    '',
    '🏷️ *Contexto*',
    `• Tags: ${tags.length ? tags.join(', ') : 'sem tags'}`,
  ].join('\n');

const resolveMentionJid = (ids = []) =>
  ids.find((id) => isWhatsAppUserId(id)) || null;

export async function handleUserCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  args = [],
  isGroupMessage,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
}) {
  const subcommand = args?.[0]?.toLowerCase() || '';
  if (subcommand !== 'perfil' && subcommand !== 'profile') {
    await sendAndStore(
      sock,
      remoteJid,
      { text: buildUsageText(commandPrefix) },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const explicitTargetArg = args.slice(1).join(' ').trim();
  const { source, invalidExplicitTarget } = resolveCandidateTarget(messageInfo, senderJid, explicitTargetArg);
  if (invalidExplicitTarget) {
    await sendAndStore(
      sock,
      remoteJid,
      { text: `❌ ID ou telefone inválido.\n\n${buildUsageText(commandPrefix)}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }
  if (!source) {
    await sendAndStore(
      sock,
      remoteJid,
      { text: buildUsageText(commandPrefix) },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  try {
    const canonicalTarget = await resolveCanonicalTarget(source);
    const senderIds = await resolveSenderIdsForTarget(canonicalTarget);
    const normalizedTargetIds = Array.from(
      new Set(
        [canonicalTarget, ...senderIds]
          .map((value) => normalizeJid(value) || value)
          .filter(Boolean),
      ),
    );
    const mentionJid = resolveMentionJid(normalizedTargetIds);
    const senderCanonical = resolveUserIdCached({ jid: senderJid, lid: senderJid, participantAlt: null });
    const rankingTargetId = mentionJid || canonicalTarget;

    const [stats, ranking, latestPushName, premiumUsers, blocked, groupAdmin] = await Promise.all([
      fetchUserStats({ canonicalId: rankingTargetId, senderIds: normalizedTargetIds }),
      fetchUserRanking(rankingTargetId),
      fetchLatestPushName(normalizedTargetIds),
      premiumUserStore.getPremiumUsers(),
      isTargetBlocked(sock, normalizedTargetIds),
      isGroupMessage ? isUserAdmin(remoteJid, mentionJid || canonicalTarget) : Promise.resolve(false),
    ]);
    const [
      globalInsights,
      socialInsights,
      trendInsights,
      activeHourInsights,
      dominantTypeByPeriod,
      topGroups,
      participationInsights,
    ] = await Promise.all([
      fetchUserGlobalRankingInsights({
        canonicalId: rankingTargetId,
        totalMessages: stats.totalMessages,
        firstMessage: stats.firstMessage,
        lastMessage: stats.lastMessage,
      }),
      fetchUserSocialInsights({
        canonicalId: rankingTargetId,
        sock,
      }),
      fetchUserTrendInsights(rankingTargetId),
      fetchUserActiveHourInsights(rankingTargetId),
      fetchDominantTypeByPeriod(rankingTargetId),
      fetchTopGroupsInsights(rankingTargetId),
      fetchParticipationInsights({
        canonicalId: rankingTargetId,
        totalMessages: stats.totalMessages,
        remoteJid,
        isGroupMessage,
      }),
    ]);

    const premiumSet = new Set((premiumUsers || []).map((jid) => normalizeJid(jid) || jid));
    const isPremium = normalizedTargetIds.some((id) => premiumSet.has(id));
    const isOwner = OWNER_JID ? normalizedTargetIds.some((id) => id === OWNER_JID) : false;
    const recentInteraction = hasRecentInteraction(stats.lastMessage);
    const status = blocked ? 'bloqueado' : 'ativo';
    const mentionUser = getJidUser(mentionJid || canonicalTarget);
    const mentionLabel = mentionUser ? `@${mentionUser}` : canonicalTarget || 'Desconhecido';
    const nameFromContacts = resolveNameFromContacts(sock, normalizedTargetIds);
    const displayName = nameFromContacts || latestPushName || mentionLabel;

    const tags = [];
    if (senderCanonical && canonicalTarget && senderCanonical === canonicalTarget) tags.push('você');
    if (isPremium) tags.push('premium');
    if (groupAdmin) tags.push('admin do grupo');
    if (isOwner) tags.push('owner');
    if (!recentInteraction && stats.totalMessages > 0) tags.push('inativo');
    if (stats.totalMessages === 0) tags.push('sem histórico');
    const rankingLabel =
      ranking.position && ranking.totalRankedUsers > 0
        ? `#${ranking.position} de ${ranking.totalRankedUsers}`
        : 'fora do ranking (sem mensagens)';
    const favoriteTypeLabel = globalInsights.favoriteType
      ? `${globalInsights.favoriteType} (${globalInsights.favoriteCount})`
      : 'N/D';
    const topPartnerLabel =
      socialInsights.topPartnerCount > 0
        ? `${socialInsights.topPartnerLabel} (${socialInsights.topPartnerCount})`
        : 'N/D';
    const trendLabel = formatTrendLabel(trendInsights);
    const activeHourLabel = formatActiveHourLabel(activeHourInsights);
    const dominantTypeByPeriodLabel = formatDominantTypeByPeriod(dominantTypeByPeriod);
    const responseRateLabel = `${socialInsights.responseRatePercent} (${socialInsights.responseRatio})`;
    const topPartnersLabel = formatTopPartnersLine(socialInsights.topPartners);
    const topGroupsLabel = formatTopGroupsLine(topGroups);
    const groupShareLabel = isGroupMessage
      ? `${participationInsights.groupShare} (${participationInsights.groupUserTotal}/${participationInsights.groupTotal})`
      : 'N/D';
    const globalShareLabel = `${participationInsights.globalShare} (${stats.totalMessages}/${participationInsights.globalTotal})`;

    const text = buildProfileMessage({
      mentionLabel,
      displayName,
      phone: formatPhone(canonicalTarget),
      canonicalTarget,
      status,
      firstMessage: formatDateTime(stats.firstMessage),
      tempoDeCasa: formatTempoDeCasa(stats.firstMessage),
      lastInteraction: formatDateTime(stats.lastMessage),
      diasSemFalar: formatDaysSinceLastMessage(stats.lastMessage),
      totalMessages: stats.totalMessages,
      globalShareLabel,
      groupShareLabel,
      rankingLabel,
      trendLabel,
      avgPerDay: globalInsights.avgPerDay,
      activeDays: globalInsights.activeDays,
      streakDays: globalInsights.streakDays,
      activeHourLabel,
      favoriteTypeLabel,
      dominantTypeByPeriodLabel,
      socialScore: socialInsights.socialScore,
      socialSent: socialInsights.repliesSent,
      socialReceived: socialInsights.repliesReceived,
      responseRateLabel,
      socialPartners: socialInsights.uniquePartners,
      topPartnerLabel,
      topPartnersLabel,
      topGroupsLabel,
      tags,
    });

    const mentions = mentionJid ? [mentionJid] : [];
    const avatarJid = mentionJid;
    const profilePicBuffer = avatarJid
      ? await getProfilePicBuffer(sock, {
          key: {
            participant: avatarJid,
            remoteJid,
          },
        })
      : null;

    await sendAndStore(
      sock,
      remoteJid,
      profilePicBuffer
        ? mentions.length
          ? { image: profilePicBuffer, caption: text, mentions }
          : { image: profilePicBuffer, caption: text }
        : mentions.length
        ? { text, mentions }
        : { text },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao processar comando user perfil.', { error: error.message });
    await sendAndStore(
      sock,
      remoteJid,
      { text: '❌ Não foi possível carregar o perfil do usuário agora.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
