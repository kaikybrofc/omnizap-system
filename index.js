/**
 * OmniZap - Sistema de Automação WhatsApp
 *
 * Sistema profissional para automação e gerenciamento de mensagens WhatsApp
 * Desenvolvido com tecnologia Baileys para máxima compatibilidade
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

const OmniZapMessageProcessor = require('./app/controllers/messageController');
const logger = require('./app/utils/logger/loggerModule');
const db = require('./app/database/mysql');

/**
 * Processador principal de mensagens do OmniZap
 *
 * @param {Object} messageUpdate - Atualização de mensagens recebidas
 * @param {Object} whatsappClient - Cliente WhatsApp ativo
 * @param {String} qrCodePath - Caminho do QR Code para autenticação
 * @returns {Promise<void>}
 */
const OmniZapMainHandler = async (messageUpdate, whatsappClient, qrCodePath) => {
  try {
    await OmniZapMessageProcessor(messageUpdate, whatsappClient, qrCodePath);
  } catch (error) {
    logger.error('❌ OmniZap: Erro no processamento principal:', {
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
};

if (require.main === module) {
  logger.info('🔌 Iniciando OmniZap...');

  db.init()
    .then((initialized) => {
      if (initialized) {
        logger.info('💾 Banco de dados MySQL inicializado com sucesso');
      } else {
        logger.warn('⚠️ Banco de dados MySQL não inicializado. Apenas armazenamento em memória disponível.');
      }

      // Inicia o controlador de socket do WhatsApp
      require('./app/connection/socketController');
    })
    .catch((error) => {
      logger.error('❌ Erro ao inicializar banco de dados:', {
        error: error.message,
        stack: error.stack,
      });

      logger.info('🔄 Iniciando sem banco de dados...');
      // Mesmo com erro, continua a inicialização do controlador de socket
      require('./app/connection/socketController');
    });
}

module.exports = OmniZapMainHandler;
