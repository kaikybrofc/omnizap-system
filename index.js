/**
 * OmniZap - Sistema de Automação WhatsApp
 *
 * Sistema profissional para automação e gerenciamento de mensagens WhatsApp
 * Desenvolvido com tecnologia Baileys para máxima compatibilidade
 *
 * @version 1.0.4
 * @author OmniZap Team
 * @license MIT
 */

const OmniZapMessageProcessor = require('./app/controllers/messageController');
const logger = require('./app/utils/logger/loggerModule');

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
  logger.info('🔌 Iniciando controlador de conexão...');
  require('./app/connection/socketController');
}

module.exports = OmniZapMainHandler;
