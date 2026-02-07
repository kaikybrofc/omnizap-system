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

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const ACTIVE_DAYS_WINDOW = Number.parseInt(process.env.USER_PROFILE_ACTIVE_DAYS || '30', 10);
const OWNER_JID = process.env.USER_ADMIN ? normalizeJid(process.env.USER_ADMIN) : null;
const MIN_PHONE_DIGITS = 5;
const MAX_PHONE_DIGITS = 20;

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

  return {
    source: parsedTarget.jid || mentioned || repliedSource || senderJid || null,
    invalidExplicitTarget: parsedTarget.invalid,
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
  if (!senderIds.length) return { totalMessages: 0, lastMessage: null };

  const inClause = buildInClause(senderIds);
  const [row] = await executeQuery(
    `SELECT COUNT(*) AS total_messages,
            MAX(timestamp) AS last_message
       FROM ${TABLES.MESSAGES}
      WHERE sender_id IN (${inClause})`,
    senderIds,
  );

  return {
    totalMessages: Number(row?.total_messages || 0),
    lastMessage: row?.last_message || null,
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

    const [stats, latestPushName, premiumUsers, blocked, groupAdmin] = await Promise.all([
      fetchUserStats(normalizedTargetIds),
      fetchLatestPushName(normalizedTargetIds),
      premiumUserStore.getPremiumUsers(),
      isTargetBlocked(sock, normalizedTargetIds),
      isGroupMessage ? isUserAdmin(remoteJid, mentionJid || canonicalTarget) : Promise.resolve(false),
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

    const text = buildProfileMessage({
      mentionLabel,
      displayName,
      phone: formatPhone(canonicalTarget),
      canonicalTarget,
      status,
      lastInteraction: formatDateTime(stats.lastMessage),
      totalMessages: stats.totalMessages,
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
