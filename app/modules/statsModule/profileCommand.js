import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _matchesParticipantId } from '../../config/groupUtils.js';

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

const getTargetJid = (messageInfo, args, senderJid) => {
  const mentioned = messageInfo.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentioned.length > 0) return mentioned[0];

  const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo?.participant;
  if (repliedTo) return repliedTo;

  const argJid = args.find((arg) => arg.includes('@s.whatsapp.net'));
  if (argJid) return argJid;

  return senderJid;
};

const resolveRoleLabel = (participant) => {
  if (!participant) return 'membro';
  if (participant.admin === 'superadmin') return 'superadmin';
  if (participant.admin === 'admin' || participant.isAdmin === true) return 'admin';
  return 'membro';
};

const buildProfileText = ({ handle, totalMessages, firstMessage, lastMessage, activeDays, avgPerDay, percentOfGroup, rank, role, dbStart }) => {
  const lines = ['👤 *Perfil no grupo*', '', `🔹 *Usuário:* ${handle}`, `🔸 *Cargo:* ${role}`, `💬 *Mensagens:* ${totalMessages}`, `📅 *Primeira:* ${formatDate(firstMessage)}`, `🕘 *Última:* ${formatDate(lastMessage)}`, `📆 *Dias ativos:* ${activeDays}`, `📈 *Média/dia:* ${avgPerDay}`, `📊 *Participação:* ${percentOfGroup}`];

  if (rank !== null) {
    lines.push(`🏆 *Ranking:* #${rank}`);
  }

  lines.push('', `🧾 *Início da contagem:* ${formatDate(dbStart)}`);
  return lines.join('\n');
};

export async function handleProfileCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage, senderJid, args }) {
  if (!isGroupMessage) {
    await sock.sendMessage(remoteJid, { text: 'Este comando só pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const targetJid = getTargetJid(messageInfo, args, senderJid);
  if (!targetJid) {
    await sock.sendMessage(remoteJid, { text: 'Não foi possível identificar o usuário.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  try {
    const [userStats] = await executeQuery(
      `SELECT COUNT(*) AS total_messages,
              MIN(timestamp) AS first_message,
              MAX(timestamp) AS last_message,
              COUNT(DISTINCT DATE(timestamp)) AS active_days
         FROM messages
        WHERE chat_id = ?
          AND sender_id = ?`,
      [remoteJid, targetJid],
    );

    const [groupStats] = await executeQuery('SELECT COUNT(*) AS total_messages FROM messages WHERE chat_id = ?', [remoteJid]);

    const [dbStartRow] = await executeQuery('SELECT MIN(timestamp) AS db_start FROM messages');

    const totalMessages = Number(userStats?.total_messages || 0);
    const groupTotal = Number(groupStats?.total_messages || 0);
    const percentOfGroup = groupTotal > 0 ? `${((totalMessages / groupTotal) * 100).toFixed(2)}%` : '0%';

    let rank = null;
    if (totalMessages > 0) {
      const [rankRow] = await executeQuery(
        `SELECT COUNT(*) AS higher_count
           FROM (
             SELECT sender_id, COUNT(*) AS total
               FROM messages
              WHERE chat_id = ?
              GROUP BY sender_id
           ) totals
          WHERE totals.total > ?`,
        [remoteJid, totalMessages],
      );
      rank = Number(rankRow?.higher_count || 0) + 1;
    }

    const firstMessage = userStats?.first_message || null;
    const lastMessage = userStats?.last_message || null;
    const activeDays = Number(userStats?.active_days || 0);

    let avgPerDay = '0';
    if (firstMessage && lastMessage && totalMessages > 0) {
      const diffMs = new Date(lastMessage).getTime() - new Date(firstMessage).getTime();
      const rangeDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1);
      avgPerDay = (totalMessages / rangeDays).toFixed(2);
    }

    const participants = await getGroupParticipants(remoteJid);
    const participant = participants?.find((p) => _matchesParticipantId(p, targetJid));
    const role = resolveRoleLabel(participant);

    const handle = `@${targetJid.split('@')[0]}`;
    const text = buildProfileText({
      handle,
      totalMessages,
      firstMessage,
      lastMessage,
      activeDays,
      avgPerDay,
      percentOfGroup,
      rank,
      role,
      dbStart: dbStartRow?.db_start || null,
    });

    await sock.sendMessage(remoteJid, { text, mentions: [targetJid] }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao gerar perfil do usuário:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao gerar perfil: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
