/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 1.0.1
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

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

    const messageText = extractMessageText(messageContent);

    if (!messageText) {
      console.log('OmniZap: Mensagem sem texto ignorada');
      return;
    }

    if (messageText.startsWith(COMMAND_PREFIX)) {
      await processOmniZapCommand(messageText, messageInfo, omniZapClient);
    } else {
      console.log('OmniZap: Mensagem normal processada (sem comando)');
    }
  } catch (error) {
    console.error(`OmniZap: Erro ao processar mensagem individual:`, error);
  }
};

/**
 * Extrai o texto de diferentes tipos de mensagem
 *
 * @param {Object} messageContent - Conteúdo da mensagem
 * @returns {String|null} - Texto extraído ou null
 */
const extractMessageText = (messageContent) => {
  if (messageContent.conversation) {
    return messageContent.conversation;
  }

  if (messageContent.extendedTextMessage?.text) {
    return messageContent.extendedTextMessage.text;
  }

  if (messageContent.imageMessage?.caption) {
    return messageContent.imageMessage.caption;
  }

  if (messageContent.videoMessage?.caption) {
    return messageContent.videoMessage.caption;
  }

  return null;
};

/**
 * Processa comandos do OmniZap baseado em switch case
 *
 * @param {String} messageText - Texto da mensagem
 * @param {Object} messageInfo - Informações da mensagem
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @returns {Promise<void>}
 */
const processOmniZapCommand = async (messageText, messageInfo, omniZapClient) => {
  try {
    const commandText = messageText.slice(COMMAND_PREFIX.length).trim();
    const [command, ...args] = commandText.split(' ');
    const senderJid = messageInfo.key.remoteJid;

    console.log(`OmniZap: Comando detectado: ${command} com argumentos:`, args);

    switch (command.toLowerCase()) {
      case 'help':
      case 'ajuda':
        await omniZapClient.sendMessage(senderJid, { text: 'olá' });
        break;

      default:
        await sendUnknownCommandMessage(omniZapClient, senderJid, command);
        break;
    }
  } catch (error) {
    console.error('OmniZap: Erro ao processar comando:', error);
    await sendErrorMessage(omniZapClient, messageInfo.key.remoteJid);
  }
};

const sendUnknownCommandMessage = async (omniZapClient, senderJid, command) => {
  const unknownText = `❓ *Comando Desconhecido*

🚫 **Comando:** ${COMMAND_PREFIX}${command}

💡 **Dica:** Use ${COMMAND_PREFIX}help para ver todos os comandos disponíveis`;

  await omniZapClient.sendMessage(senderJid, { text: unknownText });
};

/**
 * Envia mensagem de erro
 */
const sendErrorMessage = async (omniZapClient, senderJid) => {
  await omniZapClient.sendMessage(senderJid, {
    text: `❌ *Erro interno*\n\nOcorreu um erro ao processar seu comando. Tente novamente.`,
  });
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
