/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 2.0.-
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
    }
  } catch (error) {
    logger.error('Erro ao processar mensagens:', error.message);
  }
};

/**
 * Lida com mensagens recebidas
 *
 * @param {Object} messageUpdate - Objeto contendo as mensagens recebidas
 * @param {Object} omniZapClient - Cliente WhatsApp ativo para interação
 */
const processMessages = async (messageUpdate, omniZapClient) => {
  logger.info('📨 Processando mensagens recebidas', {
    messageCount: messageUpdate?.messages?.length || 0,
  });

  try {
    for (const messageInfo of messageUpdate?.messages || []) {
      logger.info(`📨 Mensagem de ${messageInfo.key.remoteJid}: ${messageInfo.message?.conversation || 'Sem conteúdo'}`);
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
  logger.info('🔄 Processando evento recebido:', event);
};

module.exports = {
  OmniZapMessageProcessor,
  processMessages,
  processEvent,
};
