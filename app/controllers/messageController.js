/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 2.0.0
 * @license MIT
 * @source https://github.com/Kaikygr/omnizap-system
 */

require('dotenv').config();
const logger = require('../utils/logger/loggerModule');

/**
 * Lida com atualizações do WhatsApp, sejam mensagens ou eventos genéricos.
 *
 * @param {Object} update - Objeto contendo a atualização do WhatsApp.
 */
const handleWhatsAppUpdate = async (update) => {
  if (update.messages && Array.isArray(update.messages)) {
    logger.info('📨 Processando mensagens recebidas', {
      messageCount: update.messages.length,
      info: update.messages.map((messageInfo) => {
        return `📨 Mensagem de ${messageInfo.key.remoteJid}: ${
          messageInfo.message?.conversation || 'Sem conteúdo'
        }`;
      }),

      action: 'process_incoming_messages',
    });

    try {
      for (const messageInfo of update.messages) {
        logger.info(JSON.stringify(messageInfo, null, 2));
      }
    } catch (error) {
      logger.error('Erro ao processar mensagens:', error.message);
    }
  } else {
    logger.info('🔄 Processando evento recebido:', {
      eventType: update?.type || 'unknown',
      eventData: update,
    });
  }
};

module.exports = {
  handleWhatsAppUpdate,
};
