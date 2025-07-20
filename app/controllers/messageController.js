/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 2.0.0
 * @author OmniZap Team
 * @license MIT
 * @source https://www.npmjs.com/package/baileys
 */

require('dotenv').config();
const logger = require('../utils/logger/loggerModule');



/**
 * Lida com mensagens recebidas
 *
 * @param {Object} messageUpdate - Objeto contendo as mensagens recebidas
 */
const processMessages = async (messageUpdate) => {
  logger.info('📨 Processando mensagens recebidas', {
    messageCount: messageUpdate?.messages?.length || 0,
    action: 'process_incoming_messages'
  });

  try {
    for (const messageInfo of messageUpdate?.messages || []) {
      logger.info(
        `📨 Mensagem de ${messageInfo.key.remoteJid}: ${messageInfo.message?.conversation || 'Sem conteúdo'}`,
        { remoteJid: messageInfo.key.remoteJid, messageId: messageInfo.key.id, hasContent: !!messageInfo.message?.conversation }
      );
    }
  } catch (error) {
    logger.error('Erro ao processar mensagens:', error.message);
  }
};

/**
 * Lida com eventos genéricos do WhatsApp
 *
 * @param {Object} event - Evento recebido do socket
 */
const processEvent = (event) => {
  logger.info('🔄 Processando evento recebido:', { eventType: event?.type || 'unknown', eventData: event });
};

module.exports = {
  processMessages,
  processEvent,
};
