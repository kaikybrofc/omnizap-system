import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, isUserAdmin } from '../../config/groupUtils.js';
import { resolveBotJid } from '../../config/baileysConfig.js';
import {
  primeLidCache,
  resolveUserIdCached,
  isLidUserId,
  isWhatsAppUserId,
} from '../../services/lidMapService.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const getParticipantJid = (participant) =>
  participant?.id || participant?.jid || participant?.lid || null;

const MAX_MENTIONS_PER_MESSAGE = 80;
const BATCH_DELAY_MS = 400;

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
  minMessages,
  periodLabel,
  totalParticipants,
  totalListed,
  batchIndex = 1,
  batchTotal = 1,
  batchSize = 0,
}) => {
  const title =
    minMessages <= 1 ? '🔇 *Membros sem mensagens no grupo*' : '🔇 *Membros abaixo do mínimo*';
  const lines = [
    title,
    '',
    `• Mínimo de mensagens: ${minMessages}`,
    `• Período: ${periodLabel}`,
    `• Participantes: ${totalParticipants}`,
    `• Abaixo do mínimo: ${totalListed}`,
    ...(batchTotal > 1
      ? [`• Parte: ${batchIndex}/${batchTotal}`, `• Notificados nesta mensagem: ${batchSize}`]
      : []),
  ];

  if (!totalListed) {
    lines.push('', '✅ Todos os membros atingiram o mínimo.');
  }

  return lines.join('\n');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const splitEntriesByMentions = (entries, maxMentions) => {
  if (!maxMentions || maxMentions <= 0) return [entries];
  const batches = [];
  let current = [];
  let mentionCount = 0;

  entries.forEach((entry) => {
    const needsMention = Boolean(entry.mentionJid);
    if (current.length > 0 && needsMention && mentionCount + 1 > maxMentions) {
      batches.push(current);
      current = [];
      mentionCount = 0;
    }
    current.push(entry);
    if (needsMention) mentionCount += 1;
  });

  if (current.length) batches.push(current);
  return batches;
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
    await sendAndStore(sock, 
      remoteJid,
      { text: 'Este comando so pode ser usado em grupos.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }
  if (!(await isUserAdmin(remoteJid, senderJid))) {
    await sendAndStore(sock, 
      remoteJid,
      { text: 'Você não tem permissão para usar este comando.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  try {
    const participants = await getGroupParticipants(remoteJid);
    if (!participants || participants.length === 0) {
      await sendAndStore(sock, 
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
      entries.push({
        canonical,
        rawId: participant.rawId,
        mentionJid,
      });
    });

    const totalParticipants = normalizedParticipants.size;
    const totalListed = entries.length;
    const batches = splitEntriesByMentions(entries, MAX_MENTIONS_PER_MESSAGE);
    if (!batches.length) {
      const responseText = buildNoMessageText({
        minMessages,
        periodLabel,
        totalParticipants,
        totalListed,
      });
      await sendAndStore(sock, 
        remoteJid,
        { text: responseText },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const batchMentions = Array.from(
        new Set(batch.map((entry) => entry.mentionJid).filter(Boolean)),
      );
      const responseText = buildNoMessageText({
        minMessages,
        periodLabel,
        totalParticipants,
        totalListed,
        batchIndex: index + 1,
        batchTotal: batches.length,
        batchSize: batch.length,
      });
      await sendAndStore(sock, 
        remoteJid,
        { text: responseText, mentions: batchMentions },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      if (index < batches.length - 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }
  } catch (error) {
    logger.error('Erro ao buscar membros sem mensagens:', { error: error.message });
    await sendAndStore(sock, 
      remoteJid,
      { text: `Erro ao buscar membros sem mensagens: ${error.message}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
