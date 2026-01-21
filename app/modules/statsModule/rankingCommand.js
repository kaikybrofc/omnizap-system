import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';

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
    const rankingRows = await executeQuery(
      `SELECT sender_id,
              COUNT(*) AS total_messages,
              MIN(timestamp) AS first_message,
              MAX(timestamp) AS last_message
         FROM messages
        WHERE chat_id = ?
        GROUP BY sender_id
        ORDER BY total_messages DESC
        LIMIT 5`,
      [remoteJid],
    );

    const dbStartRows = await executeQuery('SELECT MIN(timestamp) AS db_start FROM messages');
    const dbStart = dbStartRows[0]?.db_start || null;

    const mentions = rankingRows.map((row) => row.sender_id).filter((jid) => typeof jid === 'string' && jid.includes('@'));

    const text = buildRankingMessage(rankingRows, dbStart);
    await sock.sendMessage(remoteJid, { text, mentions }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao gerar ranking do grupo:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao gerar ranking: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
