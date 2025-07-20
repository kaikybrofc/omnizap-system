/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 * @source https://www.npmjs.com/package/baileys
 */

require('dotenv').config();
const logger = require('../utils/logger/loggerModule');

const OmniZapMessageProcessor = async (messageUpdate) => {
  logger.info('Iniciando processamento de mensagens', {
    messageCount: messageUpdate?.messages?.length || 0,
  });

  try {
    for (const messageInfo of messageUpdate?.messages || []) {
      logger.info(`📨 Mensagem recebida de ${messageInfo.key.remoteJid}: ${messageText || 'Sem conteúdo'}`);

      // Aqui você pode adicionar lógica para processar mensagens específicas
    }
  } catch (error) {
    logger.error('Erro ao processar mensagens:', error.message);
  }
};

/**
 * Lida com eventos do WhatsApp
 *
 * @param {Object} event - Evento recebido do socket
 */
const handleWhatsAppEvent = (event) => {
  logger.info('🔄 Evento recebido:', event);

  // Adicione lógica para lidar com eventos específicos, se necessário
};

module.exports = {
  OmniZapMessageProcessor,
  handleWhatsAppEvent,
};
