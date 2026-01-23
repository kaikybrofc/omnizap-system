import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _normalizeDigits } from '../../config/groupUtils.js';
import { getJidServer, getJidUser, resolveBotJid, encodeJid } from '../../config/baileysConfig.js';

const formatDate = (value) => {
  if (!value) return 'N/D';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/D';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
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

const getDisplayName = (pushName, jid) => {
  if (pushName && typeof pushName === 'string' && pushName.trim() !== '') {
    return pushName.trim();
  }
  const user = getJidUser(jid);
  return user ? `@${user}` : 'Desconhecido';
};

const isLidJid = (jid) => getJidServer(jid) === 'lid';
const isWhatsAppJid = (jid) => getJidServer(jid) === 's.whatsapp.net';

const resolveSenderIds = (rawJid, participantIndex) => {
  if (!rawJid) return { displayId: null, mentionId: null, key: null };
  const canonical = normalizeJidWithParticipants(rawJid, participantIndex);
  const displayId = !isLidJid(rawJid) ? rawJid : canonical || rawJid;
  const digits = _normalizeDigits(displayId) || _normalizeDigits(rawJid) || null;
  const mentionCandidate = isWhatsAppJid(rawJid)
    ? rawJid
    : isWhatsAppJid(canonical)
      ? canonical
      : digits
        ? encodeJid(digits, 's.whatsapp.net')
        : null;
  const mentionId = mentionCandidate && !isLidJid(mentionCandidate) ? mentionCandidate : null;
  const key = digits || displayId || rawJid;
  return { displayId, mentionId, key };
};

const normalizeJidWithParticipants = (value, participantIndex) => {
  if (!value || !participantIndex) return value;
  const direct = participantIndex.get(value);
  if (direct) return direct;
  const digits = _normalizeDigits(value);
  if (digits && participantIndex.has(digits)) return participantIndex.get(digits);
  return value;
};

const buildParticipantIndex = (participants) => {
  const index = new Map();
  (participants || []).forEach((participant) => {
    const canonical = participant?.jid || participant?.id || participant?.lid || null;
    if (!canonical) return;
    const keys = [participant?.jid, participant?.id, participant?.lid, participant?.phoneNumber].filter(Boolean);
    keys.forEach((key) => {
      index.set(key, canonical);
      const digits = _normalizeDigits(key);
      if (digits) index.set(digits, canonical);
    });
    const canonicalDigits = _normalizeDigits(canonical);
    if (canonicalDigits) index.set(canonicalDigits, canonical);
  });
  return index;
};

const buildRankingMessage = (rows, dbStart) => {
  if (!rows.length) {
    return `Nao ha mensagens suficientes para gerar o ranking.\n\nInicio do banco (primeira mensagem): ${formatDate(dbStart)}`;
  }

  const lines = ['🏆 *Ranking Top 5 (mensagens)*', ''];
  rows.forEach((row, index) => {
    const jid = row.mention_id || row.sender_id || '';
    const handle = getDisplayName(row.display_name, jid);
    const total = row.total_messages || 0;
    const first = formatDate(row.first_message);
    const last = formatDate(row.last_message);
    const position = `${index + 1}`.padStart(2, '0');
    lines.push(`${position}. ${handle}`, `   💬 ${total} msg(s)`, `   📅 primeira: ${first}`, `   🕘 ultima: ${last}`, '');
  });

  lines.push(`Inicio do banco (primeira mensagem): ${formatDate(dbStart)}`);
  return lines.join('\n');
};

export async function handleRankingCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }) {
  if (!isGroupMessage) {
    await sock.sendMessage(remoteJid, { text: 'Este comando so pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  try {
    const botJid = resolveBotJid(sock?.user?.id);
    const participants = await getGroupParticipants(remoteJid);
    const participantIndex = buildParticipantIndex(participants);

    const rankingRows = await executeQuery(
      `SELECT
          m.sender_id,
          COUNT(*) AS total_messages,
          MIN(m.timestamp) AS first_message,
          MAX(m.timestamp) AS last_message,
          (
            SELECT JSON_UNQUOTE(JSON_EXTRACT(m2.raw_message, '$.pushName'))
            FROM messages m2
            WHERE m2.sender_id = m.sender_id
              AND m2.raw_message IS NOT NULL
              AND JSON_EXTRACT(m2.raw_message, '$.pushName') IS NOT NULL
            ORDER BY m2.id DESC
            LIMIT 1
          ) AS sender_pushName
        FROM messages m
        WHERE m.chat_id = ?
          AND m.sender_id IS NOT NULL
          ${botJid ? 'AND m.sender_id <> ?' : ''}
        GROUP BY m.sender_id
        ORDER BY total_messages DESC`,
      botJid ? [remoteJid, botJid] : [remoteJid],
    );

    const normalizedTotals = new Map();
    rankingRows.forEach((row) => {
      const rawJid = row.sender_id || '';
      if (!rawJid) return;
      const { displayId, mentionId, key } = resolveSenderIds(rawJid, participantIndex);
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
      if (isWhatsAppJid(rawJid)) {
        current.mention_id = rawJid;
      }
      if (!current.display_name && row.sender_pushName) {
        current.display_name = row.sender_pushName;
      }
      normalizedTotals.set(key, current);
    });

    const topRows = Array.from(normalizedTotals.values())
      .sort((a, b) => b.total_messages - a.total_messages)
      .slice(0, 5);

    const dbStartRows = await executeQuery(
      botJid
        ? 'SELECT MIN(timestamp) AS db_start FROM messages WHERE chat_id = ? AND sender_id <> ?'
        : 'SELECT MIN(timestamp) AS db_start FROM messages WHERE chat_id = ?',
      botJid ? [remoteJid, botJid] : [remoteJid],
    );
    const dbStart = dbStartRows[0]?.db_start || null;

    const mentions = topRows
      .map((row) => row.mention_id)
      .filter((jid) => isWhatsAppJid(jid));

    const text = buildRankingMessage(topRows, dbStart);
    await sock.sendMessage(remoteJid, { text, mentions }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao gerar ranking do grupo:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao gerar ranking: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
