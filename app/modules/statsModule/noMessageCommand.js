import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, isUserAdmin } from '../../config/groupUtils.js';
import { getJidUser, resolveBotJid } from '../../config/baileysConfig.js';
import {
  primeLidCache,
  resolveUserIdCached,
  isLidUserId,
  isWhatsAppUserId,
} from '../../services/lidMapService.js';

const getParticipantJid = (participant) =>
  participant?.id || participant?.jid || participant?.lid || null;

const MAX_LISTED = null;

const parseMinMessages = (text = '') => {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let min = null;
  tokens.forEach((token) => {
    const minMatch = /^min=(\d+)$/i.exec(token);
    if (minMatch) {
      min = Number(minMatch[1]);
      return;
    }
    if (/^\d+$/.test(token) && min === null) {
      min = Number(token);
    }
  });
  if (!Number.isFinite(min)) return 1;
  return Math.max(0, min);
};

const parsePeriod = (text = '') => {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let days = null;
  let all = false;
  tokens.forEach((token) => {
    const lower = token.toLowerCase();
    if (lower === 'all') all = true;
    const match = /^(\d+)d$/i.exec(lower);
    if (match) {
      days = Number(match[1]);
    }
  });
  if (all || !days || days <= 0) {
    return { sinceDate: null, label: 'histórico completo' };
  }
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { sinceDate, label: `últimos ${days} dias` };
};

const fetchMessageCounts = async (remoteJid, sinceDate) => {
  const params = [remoteJid];
  let sql = 'SELECT sender_id, COUNT(*) AS total FROM messages WHERE chat_id = ?';
  if (sinceDate) {
    sql += ' AND created_at >= ?';
    params.push(sinceDate);
  }
  sql += ' GROUP BY sender_id';
  return executeQuery(sql, params);
};

const normalizeParticipant = (participant, sock) => {
  const rawId = getParticipantJid(participant);
  const participantAlt = participant?.participantAlt || participant?.jid || participant?.id || null;
  const canonical = resolveUserIdCached({
    lid: rawId,
    jid: rawId,
    participantAlt,
  });
  const contact =
    (canonical && sock?.contacts?.[canonical]) ||
    (participantAlt && sock?.contacts?.[participantAlt]) ||
    (rawId && sock?.contacts?.[rawId]) ||
    null;
  const displayName =
    participant?.notify || participant?.name || contact?.notify || contact?.name || contact?.short;
  return {
    rawId,
    participantAlt,
    canonical: canonical || rawId || null,
    displayName: displayName || null,
  };
};

const buildNoMessageText = ({
  members,
  minMessages,
  periodLabel,
  totalParticipants,
  totalListed,
  hiddenCount,
}) => {
  const title =
    minMessages <= 1 ? '🔇 *Membros sem mensagens no grupo*' : '🔇 *Membros abaixo do mínimo*';
  const lines = [
    title,
    '',
    `• Mínimo de mensagens: ${minMessages}`,
    `• Período: ${periodLabel}`,
    `• Participantes: ${totalParticipants}`,
    `• Listados: ${totalListed}`,
    '',
  ];

  if (!members.length) {
    lines.push('✅ Todos os membros atingiram o mínimo.');
    return lines.join('\n');
  }

  members.forEach((member, index) => {
    const handle = member.handle || 'Desconhecido';
    const label = member.name ? `${handle} — ${member.name}` : handle;
    lines.push(`${index + 1}. ${label}`);
  });

  return lines.join('\n');
};

export async function handleNoMessageCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  isGroupMessage,
  senderJid,
  text,
}) {
  if (!isGroupMessage) {
    await sock.sendMessage(
      remoteJid,
      { text: 'Este comando so pode ser usado em grupos.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }
  if (!(await isUserAdmin(remoteJid, senderJid))) {
    await sock.sendMessage(
      remoteJid,
      { text: 'Você não tem permissão para usar este comando.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  try {
    const participants = await getGroupParticipants(remoteJid);
    if (!participants || participants.length === 0) {
      await sock.sendMessage(
        remoteJid,
        { text: 'Nao foi possivel obter os participantes do grupo.' },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const minMessages = parseMinMessages(text || '');
    const { sinceDate, label: periodLabel } = parsePeriod(text || '');
    const senderRows = await fetchMessageCounts(remoteJid, sinceDate);
    const senderIds = senderRows.map((row) => row.sender_id).filter(Boolean);

    const lidsToPrime = new Set();
    senderIds.forEach((id) => {
      if (isLidUserId(id)) lidsToPrime.add(id);
    });
    participants.forEach((participant) => {
      const rawId = getParticipantJid(participant);
      if (isLidUserId(rawId)) lidsToPrime.add(rawId);
    });
    if (lidsToPrime.size > 0) {
      await primeLidCache(Array.from(lidsToPrime));
    }

    const countsByCanonical = new Map();
    senderRows.forEach((row) => {
      const rawId = row.sender_id;
      if (!rawId) return;
      const canonical = resolveUserIdCached({ lid: rawId, jid: rawId });
      if (!canonical) return;
      const total = Number(row.total || 0);
      countsByCanonical.set(canonical, (countsByCanonical.get(canonical) || 0) + total);
    });

    const normalizedParticipants = new Map();
    participants.forEach((participant) => {
      const normalized = normalizeParticipant(participant, sock);
      if (!normalized.canonical && !normalized.rawId) return;
      const key = normalized.canonical || normalized.rawId;
      if (!key) return;
      if (!normalizedParticipants.has(key)) {
        normalizedParticipants.set(key, normalized);
      }
    });

    const botJid = resolveBotJid(sock?.user?.id);
    const botCanonical = botJid ? resolveUserIdCached({ jid: botJid, lid: botJid }) : null;

    const entries = [];
    normalizedParticipants.forEach((participant) => {
      const canonical = participant.canonical || participant.rawId;
      if (!canonical) return;
      if (botCanonical && canonical === botCanonical) return;
      const total = countsByCanonical.get(canonical) || 0;
      if (total >= minMessages) return;
      const mentionJid = isWhatsAppUserId(canonical)
        ? canonical
        : isWhatsAppUserId(participant.participantAlt)
        ? participant.participantAlt
        : null;
      const displayId = mentionJid || canonical || participant.rawId;
      const user = displayId ? getJidUser(displayId) : null;
      const handle = user ? `@${user}` : 'Desconhecido';
      entries.push({
        canonical,
        rawId: participant.rawId,
        mentionJid,
        handle,
        name: participant.displayName,
      });
    });

    const totalParticipants = normalizedParticipants.size;
    const totalListed = entries.length;
    const visibleEntries = MAX_LISTED ? entries.slice(0, MAX_LISTED) : entries;
    const hiddenCount = 0;
    const mentions = Array.from(
      new Set(visibleEntries.map((entry) => entry.mentionJid).filter(Boolean)),
    );

    const responseText = buildNoMessageText({
      members: visibleEntries,
      minMessages,
      periodLabel,
      totalParticipants,
      totalListed,
      hiddenCount,
    });
    await sock.sendMessage(
      remoteJid,
      { text: responseText, mentions },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao buscar membros sem mensagens:', { error: error.message });
    await sock.sendMessage(
      remoteJid,
      { text: `Erro ao buscar membros sem mensagens: ${error.message}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
