import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, _matchesParticipantId } from '../../config/groupUtils.js';

const getParticipantJid = (participant) => participant?.id || participant?.jid || participant?.lid || null;

const buildNoMessageText = (members) => {
  if (!members.length) {
    return 'Todos os membros ja enviaram mensagem no grupo.';
  }

  const lines = ['🔇 *Membros sem mensagens no grupo*', ''];
  members.forEach((jid, index) => {
    const handle = jid ? `@${jid.split('@')[0]}` : 'Desconhecido';
    lines.push(`${index + 1}. ${handle}`);
  });
  lines.push('', `Total sem mensagens: ${members.length}`);
  return lines.join('\n');
};

export async function handleNoMessageCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }) {
  if (!isGroupMessage) {
    await sock.sendMessage(remoteJid, { text: 'Este comando so pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  try {
    const participants = await getGroupParticipants(remoteJid);
    if (!participants || participants.length === 0) {
      await sock.sendMessage(remoteJid, { text: 'Nao foi possivel obter os participantes do grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      return;
    }

    const senderRows = await executeQuery('SELECT DISTINCT sender_id FROM messages WHERE chat_id = ?', [remoteJid]);
    const senderIds = senderRows.map((row) => row.sender_id).filter(Boolean);

    const membersWithoutMessages = participants
      .filter((participant) => senderIds.every((senderId) => !_matchesParticipantId(participant, senderId)))
      .map((participant) => getParticipantJid(participant))
      .filter(Boolean);

    const mentions = membersWithoutMessages.filter((jid) => jid.includes('@'));
    const text = buildNoMessageText(membersWithoutMessages);
    await sock.sendMessage(remoteJid, { text, mentions }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao buscar membros sem mensagens:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao buscar membros sem mensagens: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
