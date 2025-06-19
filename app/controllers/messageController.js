/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

/**
 * Processador de mensagens WhatsApp do OmniZap
 *
 * Processa todas as mensagens recebidas através da conexão WhatsApp,
 * aplicando filtros, validações e executando as ações correspondentes
 *
 * @param {Object} messageUpdate - Objeto contendo as mensagens recebidas
 * @param {Object} omniZapClient - Cliente WhatsApp ativo para interação
 * @param {String} qrCodePath - Caminho para o QR Code se necessário
 * @returns {Promise<void>}
 */
const OmniZapMessageProcessor = async (messageUpdate, omniZapClient, qrCodePath) => {
  try {
    for (const messageInfo of messageUpdate?.messages || []) {
      const senderJid = messageInfo.key.remoteJid;

      if (!messageInfo.message) {
        console.log('OmniZap: Mensagem sem conteúdo ignorada');
        continue;
      }

      if (messageUpdate.type === 'append') {
        console.log('OmniZap: Mensagem histórica ignorada');
        continue;
      }

      if (messageInfo.key.fromMe) {
        console.log('OmniZap: Mensagem própria ignorada');
        continue;
      }

      console.log(`OmniZap: Processando mensagem de ${senderJid}`);

      await processOmniZapMessage(messageInfo, omniZapClient, qrCodePath);
    }
  } catch (error) {
    handleOmniZapError(error);
  }
};

/**
 * Processa uma mensagem individual do OmniZap
 *
 * @param {Object} messageInfo - Informações da mensagem
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} qrCodePath - Caminho do QR Code
 * @returns {Promise<void>}
 */
const processOmniZapMessage = async (messageInfo, omniZapClient, qrCodePath) => {
  try {
    const messageContent = messageInfo.message;
    const senderJid = messageInfo.key.remoteJid;
    const messageId = messageInfo.key.id;

    console.log(`OmniZap: Nova mensagem [${messageId}] de ${senderJid}`);
  } catch (error) {
    console.error(`OmniZap: Erro ao processar mensagem individual:`, error);
  }
};

/**
 * Manipulador de erros do OmniZap
 *
 * @param {Error} error - Objeto de erro
 */
const handleOmniZapError = (error) => {
  if (error.message && error.message.includes('network')) {
    console.error('OmniZap: Erro de rede detectado:', error.message);
  } else if (error.message && error.message.includes('timeout')) {
    console.error('OmniZap: Timeout detectado:', error.message);
  } else {
    console.error('OmniZap: Erro geral no processamento:', error);
  }
};

module.exports = OmniZapMessageProcessor;
