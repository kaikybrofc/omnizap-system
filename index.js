/**
 * OmniZap - Sistema de Automação WhatsApp
 *
 * Sistema profissional para automação e gerenciamento de mensagens WhatsApp
 * Desenvolvido com tecnologia Baileys para máxima compatibilidade
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

const OmniZapMessageProcessor = require('./app/controllers/messageController');

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
    console.error('❌ OmniZap: Erro no processamento principal:', error);

    throw error;
  }
};

if (require.main === module) {
  console.log('🔌 Iniciando controlador de conexão...');
  require('./app/connection/socketController');
}

module.exports = OmniZapMainHandler;
