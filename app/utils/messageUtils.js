/**
 * OmniZap Message Utils Module
 *
 * Utilitários centralizados para manipulação de mensagens
 *
 * @version 1.0.4
 * @author OmniZap Team
 * @license MIT
 */

const { getExpiration } = require('./baileys/messageHelper');
const { COMMAND_PREFIX } = require('./constants');

/**
 * Envia uma mensagem com configurações padrão do OmniZap
 * Inclui automaticamente quoted e ephemeralExpiration quando aplicável
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {string} targetJid - JID de destino
 * @param {Object} content - Conteúdo da mensagem (text, sticker, etc.)
 * @param {Object} options - Opções adicionais
 * @param {Object} options.originalMessage - Mensagem original para quote e expiração
 * @param {boolean} options.useQuote - Se deve usar quote (padrão: true se originalMessage fornecida)
 * @param {boolean} options.useExpiration - Se deve usar expiração (padrão: true se originalMessage fornecida)
 * @param {Object} options.extraOptions - Opções extras para sendMessage
 * @returns {Promise<Object>} Resultado do envio
 */
async function sendOmniZapMessage(omniZapClient, targetJid, content, options = {}) {
  const { originalMessage = null, useQuote = !!originalMessage, useExpiration = !!originalMessage, extraOptions = {} } = options;

  // Configurações base da mensagem
  const messageOptions = { ...extraOptions };

  // Adiciona quote se solicitado e disponível
  if (useQuote && originalMessage) {
    messageOptions.quoted = originalMessage;
  }

  // Adiciona expiração se solicitado e disponível
  if (useExpiration && originalMessage) {
    const expiration = getExpiration(originalMessage);
    if (expiration) {
      messageOptions.ephemeralExpiration = expiration;
    }
  }

  try {
    return await omniZapClient.sendMessage(targetJid, content, messageOptions);
  } catch (error) {
    throw new Error(`Erro ao enviar mensagem: ${error.message}`);
  }
}

/**
 * Envia uma mensagem de texto com formatação padrão
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {string} targetJid - JID de destino
 * @param {string} text - Texto da mensagem
 * @param {Object} options - Opções (mesmas de sendOmniZapMessage)
 * @returns {Promise<Object>} Resultado do envio
 */
async function sendTextMessage(omniZapClient, targetJid, text, options = {}) {
  return await sendOmniZapMessage(omniZapClient, targetJid, { text }, options);
}

/**
 * Envia uma mensagem de sticker
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {string} targetJid - JID de destino
 * @param {string|Object} stickerPath - Caminho do sticker ou objeto { url }
 * @param {Object} options - Opções (mesmas de sendOmniZapMessage)
 * @returns {Promise<Object>} Resultado do envio
 */
async function sendStickerMessage(omniZapClient, targetJid, stickerPath, options = {}) {
  const stickerContent = typeof stickerPath === 'string' ? { sticker: { url: stickerPath } } : { sticker: stickerPath };

  return await sendOmniZapMessage(omniZapClient, targetJid, stickerContent, options);
}

/**
 * Envia uma reação a uma mensagem
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {string} targetJid - JID de destino
 * @param {string} emoji - Emoji da reação
 * @param {Object} messageKey - Chave da mensagem a ser reagida
 * @returns {Promise<Object>} Resultado do envio
 */
async function sendReaction(omniZapClient, targetJid, emoji, messageKey) {
  return await omniZapClient.sendMessage(targetJid, {
    react: { text: emoji, key: messageKey },
  });
}

/**
 * Gera mensagem de erro padrão com prefixo do comando
 *
 * @param {string} errorMessage - Mensagem de erro
 * @param {string} commandExample - Exemplo de uso do comando
 * @param {string} context - Contexto adicional
 * @returns {string} Mensagem formatada
 */
function formatErrorMessage(errorMessage, commandExample = null, context = null) {
  let message = `❌ *${errorMessage}*\n\n`;

  if (commandExample) {
    message += `💡 *Exemplo de uso:*\n${COMMAND_PREFIX}${commandExample}\n\n`;
  }

  if (context) {
    message += `📋 *Contexto:* ${context}`;
  }

  return message;
}

/**
 * Gera mensagem de sucesso padrão
 *
 * @param {string} successMessage - Mensagem de sucesso
 * @param {string} details - Detalhes adicionais
 * @param {string} tip - Dica para o usuário
 * @returns {string} Mensagem formatada
 */
function formatSuccessMessage(successMessage, details = null, tip = null) {
  let message = `✅ *${successMessage}*\n\n`;

  if (details) {
    message += `${details}\n\n`;
  }

  if (tip) {
    message += `💡 *Dica:* ${tip}`;
  }

  return message;
}

/**
 * Gera mensagem de ajuda formatada
 *
 * @param {string} title - Título da ajuda
 * @param {Array} commands - Lista de comandos [{name, description, example}]
 * @param {string} footer - Rodapé adicional
 * @returns {string} Mensagem formatada
 */
function formatHelpMessage(title, commands = [], footer = null) {
  let message = `🎯 *${title}*\n\n`;

  commands.forEach((cmd) => {
    message += `• \`${COMMAND_PREFIX}${cmd.name}\` - ${cmd.description}\n`;
    if (cmd.example) {
      message += `   *Exemplo:* ${COMMAND_PREFIX}${cmd.example}\n`;
    }
    message += '\n';
  });

  if (footer) {
    message += `\n${footer}`;
  }

  return message;
}

module.exports = {
  sendOmniZapMessage,
  sendTextMessage,
  sendStickerMessage,
  sendReaction,
  formatErrorMessage,
  formatSuccessMessage,
  formatHelpMessage,
};
