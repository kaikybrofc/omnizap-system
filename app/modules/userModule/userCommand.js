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

const fetchUserStats = async (senderIds) => {
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

  const [topPartnerRow] = await executeQuery(
    buildSocialBaseQuery(
      `SELECT
          CASE WHEN src = ? THEN dst ELSE src END AS partner_id,
          COUNT(*) AS total
        FROM base
       WHERE src = ? OR dst = ?
       GROUP BY partner_id
       ORDER BY total DESC
       LIMIT 1`,
    ),
    [canonicalId, canonicalId, canonicalId],
  );

  const repliesSent = Number(summaryRow?.replies_sent || 0);
  const repliesReceived = Number(summaryRow?.replies_received || 0);
  const uniquePartners = Number(summaryRow?.unique_partners || 0);
  const topPartnerId = topPartnerRow?.partner_id || null;
  const topPartnerCount = Number(topPartnerRow?.total || 0);
  const topPartnerMention = topPartnerId && getJidUser(topPartnerId) ? `@${getJidUser(topPartnerId)}` : null;
  const topPartnerFromContacts = resolveNameFromContacts(sock, topPartnerId ? [topPartnerId] : []);
  const topPartnerPushName = topPartnerId ? await fetchCanonicalPushName(topPartnerId) : null;
  const topPartnerLabel =
    topPartnerFromContacts || topPartnerPushName || topPartnerMention || topPartnerId || 'N/D';

  return {
    repliesSent,
    repliesReceived,
    socialScore: repliesSent + repliesReceived,
    uniquePartners,
    topPartnerId,
    topPartnerCount,
    topPartnerLabel,
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

const buildProfileMessage = ({
  mentionLabel,
  displayName,
  phone,
  canonicalTarget,
  status,
  lastInteraction,
  totalMessages,
  rankingLabel,
  avgPerDay,
  activeDays,
  streakDays,
  favoriteTypeLabel,
  socialScore,
  socialSent,
  socialReceived,
  socialPartners,
  topPartnerLabel,
  tags,
}) =>
  [
    '👤 *Perfil do usuário*',
    '',
    `• Usuário: ${mentionLabel}`,
    `• Nome: ${displayName}`,
    `• Número: ${phone}`,
    `• ID: ${canonicalTarget || 'N/D'}`,
    `• Status: *${status}*`,
    `• Última interação: ${lastInteraction}`,
    `• Mensagens gerais registradas: ${totalMessages}`,
    `• Posição no ranking: ${rankingLabel}`,
    `• Média/dia (global): ${avgPerDay}`,
    `• Dias ativos (global): ${activeDays}`,
    `• Streak (global): ${streakDays} dia(s)`,
    `• Tipo favorito (global): ${favoriteTypeLabel}`,
    `• Interações sociais (${SOCIAL_RECENT_DAYS}d): ${socialScore}`,
    `• Respostas enviadas (${SOCIAL_RECENT_DAYS}d): ${socialSent}`,
    `• Respostas recebidas (${SOCIAL_RECENT_DAYS}d): ${socialReceived}`,
    `• Parceiros sociais (${SOCIAL_RECENT_DAYS}d): ${socialPartners}`,
    `• Parceiro principal (${SOCIAL_RECENT_DAYS}d): ${topPartnerLabel}`,
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
      fetchUserStats(normalizedTargetIds),
      fetchUserRanking(rankingTargetId),
      fetchLatestPushName(normalizedTargetIds),
      premiumUserStore.getPremiumUsers(),
      isTargetBlocked(sock, normalizedTargetIds),
      isGroupMessage ? isUserAdmin(remoteJid, mentionJid || canonicalTarget) : Promise.resolve(false),
    ]);
    const [globalInsights, socialInsights] = await Promise.all([
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

    const text = buildProfileMessage({
      mentionLabel,
      displayName,
      phone: formatPhone(canonicalTarget),
      canonicalTarget,
      status,
      lastInteraction: formatDateTime(stats.lastMessage),
      totalMessages: stats.totalMessages,
      rankingLabel,
      avgPerDay: globalInsights.avgPerDay,
      activeDays: globalInsights.activeDays,
      streakDays: globalInsights.streakDays,
      favoriteTypeLabel,
      socialScore: socialInsights.socialScore,
      socialSent: socialInsights.repliesSent,
      socialReceived: socialInsights.repliesReceived,
      socialPartners: socialInsights.uniquePartners,
      topPartnerLabel,
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
