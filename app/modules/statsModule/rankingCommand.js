import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _normalizeDigits } from '../../config/groupUtils.js';

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
    const jid = row.sender_id || '';
    const handle = jid ? `@${jid.split('@')[0]}` : 'Desconhecido';
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
    const botJid = sock?.user?.id ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : null;
    const participants = await getGroupParticipants(remoteJid);
    const participantIndex = buildParticipantIndex(participants);

    const rankingRows = await executeQuery(
      `SELECT sender_id,
              COUNT(*) AS total_messages,
              MIN(timestamp) AS first_message,
              MAX(timestamp) AS last_message
         FROM messages
        WHERE chat_id = ?
          AND sender_id IS NOT NULL
          ${botJid ? 'AND sender_id <> ?' : ''}
        GROUP BY sender_id
        ORDER BY total_messages DESC`,
      botJid ? [remoteJid, botJid] : [remoteJid],
    );

    const normalizedTotals = new Map();
    rankingRows.forEach((row) => {
      const rawJid = row.sender_id || '';
      if (!rawJid) return;
      const normalizedJid = normalizeJidWithParticipants(rawJid, participantIndex);
      if (!normalizedJid) return;
      const total = Number(row.total_messages || 0);
      const firstMs = toMillis(row.first_message);
      const lastMs = toMillis(row.last_message);
      const current = normalizedTotals.get(normalizedJid) || {
        sender_id: normalizedJid,
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
      normalizedTotals.set(normalizedJid, current);
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
      .map((row) => row.sender_id)
      .filter((jid) => typeof jid === 'string' && jid.includes('@'));

    const text = buildRankingMessage(topRows, dbStart);
    await sock.sendMessage(remoteJid, { text, mentions }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao gerar ranking do grupo:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao gerar ranking: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
