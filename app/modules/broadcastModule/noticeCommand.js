import logger from '../../utils/logger/loggerModule.js';
import getImageBuffer from '../../utils/http/getImageBufferModule.js';
import { getAllParticipatingGroups } from '../../config/groupUtils.js';

const MENU_IMAGE_ENV = 'IMAGE_MENU';
const OWNER_JID_ENV = 'USER_ADMIN';

/**
 * Normaliza o JID para o formato esperado pelo WhatsApp.
 *
 * @param {string} jid
 * @returns {string}
 */
const normalizeJid = (jid) => {
  if (!jid) return '';
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
};

/**
 * Aguarda um tempo em milissegundos.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Monta uma lista textual dos grupos.
 *
 * @param {Array<{id: string, subject?: string}>} groups
 * @returns {string}
 */
const buildGroupList = (groups) =>
  groups
    .map((group, index) => {
      const name = group.subject || 'Sem nome';
      return `${index + 1}. ${name} (${group.id})`;
    })
    .join('\n');

/**
 * Comando do dono do bot para enviar um aviso com a imagem do menu a todos os grupos.
 *
 * @param {object} params
 * @param {object} params.sock
 * @param {string} params.remoteJid
 * @param {object} params.messageInfo
 * @param {number} params.expirationMessage
 * @param {string} params.senderJid
 * @param {string} params.text
 * @returns {Promise<void>}
 */
export async function handleNoticeCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text }) {
  const ownerJid = process.env[OWNER_JID_ENV];
  if (!ownerJid) {
    await sock.sendMessage(remoteJid, { text: '❌ USER_ADMIN não configurado no ambiente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  if (normalizeJid(ownerJid) !== normalizeJid(senderJid)) {
    await sock.sendMessage(remoteJid, { text: '❌ Você não tem permissão para usar este comando.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const noticeText = text.trim();
  if (!noticeText) {
    await sock.sendMessage(remoteJid, { text: 'Uso: /aviso <mensagem>' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const imageUrl = process.env[MENU_IMAGE_ENV];
  if (!imageUrl) {
    await sock.sendMessage(remoteJid, { text: '❌ IMAGE_MENU não configurado no ambiente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  let groupsMap = null;
  try {
    groupsMap = await getAllParticipatingGroups(sock);
  } catch (error) {
    logger.error(`handleNoticeCommand Erro ao obter grupos: ${error.message}`);
    await sock.sendMessage(remoteJid, { text: '❌ Não foi possível obter a lista de grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const groups = Object.values(groupsMap || {});
  if (groups.length === 0) {
    await sock.sendMessage(remoteJid, { text: '⚠️ O bot não está em nenhum grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const groupListText = buildGroupList(groups);
  await sock.sendMessage(
    remoteJid,
    {
      text: `📋 Grupos (${groups.length}):\n${groupListText}\n\n📣 Aviso:\n${noticeText}\n\n⏳ Iniciando envio com intervalo aleatório de 1 a 5 minutos.`,
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );

  let imageBuffer = null;
  try {
    imageBuffer = await getImageBuffer(imageUrl);
  } catch (error) {
    logger.error(`handleNoticeCommand Erro ao baixar imagem do menu: ${error.message}`);
    await sock.sendMessage(remoteJid, { text: '❌ Não foi possível baixar a imagem do menu.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const sendBroadcast = async () => {
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      try {
        await sock.sendMessage(group.id, { image: imageBuffer, caption: noticeText });
      } catch (error) {
        logger.error(`handleNoticeCommand Falha ao enviar aviso para ${group.id}: ${error.message}`);
      }

      if (i < groups.length - 1) {
        const delayMinutes = Math.floor(Math.random() * 5) + 1;
        await sleep(delayMinutes * 60 * 1000);
      }
    }

    await sock.sendMessage(remoteJid, { text: `✅ Aviso enviado para ${groups.length} grupos.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  };

  void sendBroadcast();
}
