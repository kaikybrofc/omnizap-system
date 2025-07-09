/**
 * OmniZap Message Helper
 *
 * Utilitário para processamento de mensagens do WhatsApp,
 * facilitando a extração de dados e verificação de tipos de conteúdo.
 *
 * @version 1.0.4
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const { str, cleanEnv } = require('envalid');
const logger = require('../logger/loggerModule');
const { COMMAND_PREFIX } = require('../constants');

/**
 * Pré-processa uma mensagem do WhatsApp, extraindo tipo, corpo e verificando se é mídia
 *
 * @param {Object} info - Objeto da mensagem recebido via Baileys
 * @returns {Object} Objeto contendo tipo, corpo da mensagem e indicador se é mídia
 */
function preProcessMessage(info) {
  try {
    // Determina o tipo de conteúdo da mensagem
    const type = getContentType(info.message);

    // Extrai o corpo da mensagem de vários formatos possíveis
    const body = info.message?.conversation || info.viewOnceMessage?.message || info.message?.viewOnceMessage?.message?.imageMessage?.caption || info.message?.viewOnceMessageV2?.message?.videoMessage?.caption || info.message?.imageMessage?.caption || info.message?.videoMessage?.caption || info.message?.extendedTextMessage?.text || info.message?.viewOnceMessage?.message?.videoMessage?.caption || info.message?.viewOnceMessage?.message?.imageMessage?.caption || info.message?.documentWithCaptionMessage?.message?.documentMessage?.caption || info.message?.buttonsMessage?.imageMessage?.caption || info.message?.buttonsResponseMessage?.selectedButtonId || info.message?.listResponseMessage?.singleSelectReply?.selectedRowId || info.message?.templateButtonReplyMessage?.selectedId || (info.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ? JSON.parse(info.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson)?.id : null) || info?.text;

    const finalBody = body === undefined ? false : body;

    // Verifica se a mensagem é um tipo de mídia
    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage', 'locationMessage', 'productMessage'];

    const isMedia = mediaTypes.includes(type);

    logger.debug(`[ preProcessMessage ] Mensagem processada: Tipo=${type}, isMedia=${isMedia}, Corpo=${finalBody ? 'presente' : 'ausente'}`);

    return { type, body: finalBody, isMedia };
  } catch (error) {
    logger.error(`[ preProcessMessage ] Erro ao processar mensagem:`, {
      error: error?.message,
      stack: error?.stack,
    });
    return { type: null, body: false, isMedia: false };
  }
}

/**
 * Obtém o tipo de conteúdo de uma mensagem
 *
 * @param {Object} message - Objeto de mensagem
 * @returns {String} Tipo de conteúdo da mensagem
 */
function getContentType(message) {
  try {
    if (!message) {
      logger.debug(`[ getContentType ] Mensagem nula ou indefinida`);
      return null;
    }

    const messageTypes = ['conversation', 'imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'contactMessage', 'locationMessage', 'liveLocationMessage', 'extendedTextMessage', 'documentWithCaptionMessage', 'buttonsMessage', 'listMessage', 'product', 'orderMessage', 'interactiveMessage'];

    for (const type of messageTypes) {
      if (message[type]) {
        logger.debug(`[ getContentType ] Tipo de mensagem identificado: ${type}`);
        return type;
      }

      // Verifica tipos aninhados em estruturas complexas
      if (message.viewOnceMessage && message.viewOnceMessage.message && message.viewOnceMessage.message[type]) {
        logger.debug(`[ getContentType ] Tipo de mensagem aninhado (viewOnceMessage): ${type}`);
        return type;
      }

      if (message.viewOnceMessageV2 && message.viewOnceMessageV2.message && message.viewOnceMessageV2.message[type]) {
        logger.debug(`[ getContentType ] Tipo de mensagem aninhado (viewOnceMessageV2): ${type}`);
        return type;
      }
    }

    logger.debug(`[ getContentType ] Nenhum tipo de mensagem reconhecido`);
    return null;
  } catch (error) {
    logger.error(`[ getContentType ] Erro ao identificar tipo de mensagem:`, {
      error: error?.message,
      stack: error?.stack,
    });
    return null;
  }
}

/**
 * Verifica se uma mensagem de texto é um comando válido com base no prefixo definido
 *
 * @param {string} body - O conteúdo da mensagem que será verificado
 * @returns {Object} Objeto indicando se é comando e seus componentes
 */
function isCommand(body) {
  try {
    const prefix = COMMAND_PREFIX;

    if (!body || !body.startsWith(prefix)) {
      logger.debug(`[ isCommand ] Não é um comando: ${body ? 'Texto não começa com prefixo' : 'Corpo vazio'}`);
      return { isCommand: false };
    }

    const withoutPrefix = body.slice(prefix.length).trim();
    const spaceIndex = withoutPrefix.indexOf(' ');

    let command, args;

    if (spaceIndex === -1) {
      command = withoutPrefix.toLowerCase();
      args = '';
    } else {
      command = withoutPrefix.slice(0, spaceIndex).toLowerCase();
      args = withoutPrefix.slice(spaceIndex + 1).trim();
    }

    if (!command) {
      logger.debug(`[ isCommand ] Prefixo detectado, mas comando vazio`);
      return { isCommand: false };
    }

    logger.info(`[ isCommand ] Comando detectado: ${command}, Argumentos: ${args || '(nenhum)'}`);
    return { isCommand: true, command, args };
  } catch (error) {
    logger.error(`[ isCommand ] Erro ao processar comando:`, {
      error: error?.message,
      stack: error?.stack,
      body,
    });
    return { isCommand: false };
  }
}

/**
 * Processa verificações para mensagens citadas (quoted)
 *
 * @param {string} type - Tipo da mensagem
 * @param {string} content - Conteúdo da mensagem
 * @returns {Object} Objeto com indicadores de tipos de mensagens citadas
 */
function processQuotedChecks(type, content) {
  try {
    const quotedTypes = {
      textMessage: 'isQuotedMsg',
      imageMessage: 'isQuotedImage',
      videoMessage: 'isQuotedVideo',
      documentMessage: 'isQuotedDocument',
      audioMessage: 'isQuotedAudio',
      stickerMessage: 'isQuotedSticker',
      contactMessage: 'isQuotedContact',
      locationMessage: 'isQuotedLocation',
      productMessage: 'isQuotedProduct',
    };

    const quotedChecks = {};
    let foundQuoted = false;

    for (const [key, value] of Object.entries(quotedTypes)) {
      const isQuoted = type === 'extendedTextMessage' && content.includes(key);
      quotedChecks[value] = isQuoted;

      if (isQuoted) {
        foundQuoted = true;
        logger.debug(`[ processQuotedChecks ] Tipo de mensagem citada detectado: ${key}`);
      }
    }

    if (type === 'extendedTextMessage' && !foundQuoted) {
      logger.debug(`[ processQuotedChecks ] Mensagem é extendedTextMessage mas não contém mensagem citada`);
    } else if (type !== 'extendedTextMessage') {
      logger.debug(`[ processQuotedChecks ] Não é mensagem com citação, tipo: ${type}`);
    }

    return {
      isQuotedMsg: quotedChecks.isQuotedMsg,
      isQuotedImage: quotedChecks.isQuotedImage,
      isQuotedVideo: quotedChecks.isQuotedVideo,
      isQuotedDocument: quotedChecks.isQuotedDocument,
      isQuotedAudio: quotedChecks.isQuotedAudio,
      isQuotedSticker: quotedChecks.isQuotedSticker,
      isQuotedContact: quotedChecks.isQuotedContact,
      isQuotedLocation: quotedChecks.isQuotedLocation,
      isQuotedProduct: quotedChecks.isQuotedProduct,
    };
  } catch (error) {
    logger.error(`[ processQuotedChecks ] Erro ao processar verificações de citação:`, {
      error: error?.message,
      stack: error?.stack,
      type,
      contentSample: content ? content.substring(0, 100) + '...' : 'undefined',
    });
    return {
      isQuotedMsg: false,
      isQuotedImage: false,
      isQuotedVideo: false,
      isQuotedDocument: false,
      isQuotedAudio: false,
      isQuotedSticker: false,
      isQuotedContact: false,
      isQuotedLocation: false,
      isQuotedProduct: false,
    };
  }
}

/**
 * Extrai o valor de expiração de uma mensagem do WhatsApp,
 * ou retorna 24 horas (em segundos) por padrão.
 *
 * @param {object} info - Objeto da mensagem recebido via Baileys
 * @returns {number} Timestamp de expiração (em segundos)
 */
function getExpiration(info) {
  try {
    const DEFAULT_EXPIRATION_SECONDS = 24 * 60 * 60; // 24 horas

    if (!info || typeof info !== 'object' || !info.message) {
      logger.debug(`[ getExpiration ] Usando expiração padrão (${DEFAULT_EXPIRATION_SECONDS}s): mensagem inválida ou ausente`);
      return DEFAULT_EXPIRATION_SECONDS;
    }

    const messageTypes = ['conversation', 'viewOnceMessageV2', 'imageMessage', 'videoMessage', 'extendedTextMessage', 'viewOnceMessage', 'documentWithCaptionMessage', 'buttonsMessage', 'buttonsResponseMessage', 'listResponseMessage', 'templateButtonReplyMessage', 'interactiveResponseMessage'];

    // Verifica diretamente nos tipos de mensagem listados
    for (const type of messageTypes) {
      const rawMessage = info.message[type];
      const messageContent = rawMessage?.message ?? rawMessage;

      const expiration = messageContent?.contextInfo?.expiration;
      if (typeof expiration === 'number') {
        logger.debug(`[ getExpiration ] Expiração encontrada (${expiration}s) no tipo: ${type}`);
        return expiration;
      }
    }

    // Busca profunda para garantir cobertura de todos os casos
    const deepSearch = (obj) => {
      if (typeof obj !== 'object' || obj === null) return null;

      if (obj.contextInfo?.expiration && typeof obj.contextInfo.expiration === 'number') {
        return obj.contextInfo.expiration;
      }

      for (const key of Object.keys(obj)) {
        const value = obj[key];
        const result = deepSearch(value);
        if (result !== null) return result;
      }

      return null;
    };

    const found = deepSearch(info.message);

    if (typeof found === 'number') {
      logger.debug(`[ getExpiration ] Expiração encontrada (${found}s) na busca profunda`);
      return found;
    } else {
      logger.debug(`[ getExpiration ] Usando expiração padrão (${DEFAULT_EXPIRATION_SECONDS}s): não encontrada na mensagem`);
      return DEFAULT_EXPIRATION_SECONDS;
    }
  } catch (error) {
    logger.error(`[ getExpiration ] Erro ao obter expiração:`, {
      error: error?.message,
      stack: error?.stack,
    });
    return 24 * 60 * 60; // 24 horas como fallback seguro
  }
}

module.exports = {
  preProcessMessage,
  getContentType,
  isCommand,
  processQuotedChecks,
  getExpiration,
};
