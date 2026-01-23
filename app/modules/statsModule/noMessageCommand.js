import { executeQuery } from '../../../database/index.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupParticipants, isUserAdmin, _matchesParticipantId } from '../../config/groupUtils.js';
import { getJidServer, getJidUser } from '../../config/baileysConfig.js';

const getParticipantJid = (participant) => participant?.id || participant?.jid || participant?.lid || null;

const buildNoMessageText = (members) => {
  if (!members.length) {
    return 'Todos os membros ja enviaram mensagem no grupo.';
  }

  const lines = ['🔇 *Membros sem mensagens no grupo*', ''];
  members.forEach((jid, index) => {
    const user = getJidUser(jid);
    const handle = user ? `@${user}` : 'Desconhecido';
    lines.push(`${index + 1}. ${handle}`);
  });
  lines.push('', `Total sem mensagens: ${members.length}`);
  return lines.join('\n');
};

export async function handleNoMessageCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage, senderJid }) {
  if (!isGroupMessage) {
    await sock.sendMessage(remoteJid, { text: 'Este comando so pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }
  if (!(await isUserAdmin(remoteJid, senderJid))) {
    await sock.sendMessage(remoteJid, { text: 'Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
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

    const mentions = membersWithoutMessages.filter((jid) => getJidServer(jid) === 's.whatsapp.net');
    const text = buildNoMessageText(membersWithoutMessages);
    await sock.sendMessage(remoteJid, { text, mentions }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao buscar membros sem mensagens:', { error: error.message });
    await sock.sendMessage(remoteJid, { text: `Erro ao buscar membros sem mensagens: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
