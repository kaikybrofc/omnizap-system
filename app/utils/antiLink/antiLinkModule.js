const groupUtils = require('../../config/groupUtils');
const groupConfigStore = require('../../store/groupConfigStore');
const logger = require('../logger/loggerModule');

const primaryRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[A-Za-z0-9]+)/i;
const tlds = ['com', 'net', 'org', 'gov', 'edu', 'biz', 'info', 'io', 'co', 'app', 'xyz', 'br', 'pt', 'us', 'uk', 'de', 'jp', 'fr', 'au', 'ca', 'cn', 'ru', 'in'];
const secondaryRegex = new RegExp(`\\b[a-zA-Z0-9-]+\\.(${tlds.join('|')})\\b`, 'i');

const isLinkDetected = (text) => {
  if (!text) return false;
  if (primaryRegex.test(text)) return true;
  return secondaryRegex.test(text);
};

const handleAntiLink = async ({ sock, messageInfo, extractedText, remoteJid, senderJid, botJid }) => {
  const groupConfig = groupConfigStore.getGroupConfig(remoteJid);
  if (!groupConfig || !groupConfig.antilinkEnabled) return false;

  if (!isLinkDetected(extractedText)) return false;

  const isAdmin = await groupUtils.isUserAdmin(remoteJid, senderJid);
  const senderIsBot = senderJid === botJid;

  if (!isAdmin && !senderIsBot) {
    try {
      await groupUtils.updateGroupParticipants(sock, remoteJid, [senderJid], 'remove');
      await sock.sendMessage(remoteJid, { text: `🚫 @${senderJid.split('@')[0]} foi removido por enviar um link.`, mentions: [senderJid] });
      await sock.sendMessage(remoteJid, { delete: messageInfo.key });

      logger.info(`Usuário ${senderJid} removido do grupo ${remoteJid} por enviar link.`, {
        action: 'antilink_remove',
        groupId: remoteJid,
        userId: senderJid,
      });

      return true;
    } catch (error) {
      logger.error(`Falha ao remover usuário com antilink: ${error.message}`, {
        action: 'antilink_error',
        groupId: remoteJid,
        userId: senderJid,
        error: error.stack,
      });
    }
  } else if (isAdmin && !senderIsBot) {
    try {
      await sock.sendMessage(remoteJid, { text: `ⓘ @${senderJid.split('@')[0]} (admin) enviou um link.`, mentions: [senderJid] });
      logger.info(`Admin ${senderJid} enviou um link no grupo ${remoteJid} (aviso enviado).`, {
        action: 'antilink_admin_link_detected',
        groupId: remoteJid,
        userId: senderJid,
      });
    } catch (error) {
      logger.error(`Falha ao enviar aviso de link de admin: ${error.message}`, {
        action: 'antilink_admin_warning_error',
        groupId: remoteJid,
        userId: senderJid,
        error: error.stack,
      });
    }
  }

  return false;
};

module.exports = {
  handleAntiLink,
  isLinkDetected,
};
