const { fetchLatestBaileysVersion, downloadContentFromMessage } = require('@whiskeysockets/baileys');

const logger = require('../utils/logger/loggerModule');
const fs = require('fs');
const path = require('path');

const DEFAULT_BAILEYS_VERSION = [7, 0, 0];

function parseBaileysVersion(rawVersion) {
  if (!rawVersion) {
    return null;
  }

  const cleaned = String(rawVersion).replace(/[\[\]\s]/g, '');
  const parts = cleaned.split(/[.,]/).filter(Boolean).map((value) => Number(value));

  if (parts.length < 3 || parts.some((value) => Number.isNaN(value))) {
    return null;
  }

  return parts.slice(0, 3);
}

async function resolveBaileysVersion() {
  const envVersion = parseBaileysVersion(process.env.BAILEYS_VERSION);
  if (envVersion) {
    return envVersion;
  }

  if (process.env.BAILEYS_VERSION) {
    logger.warn('Valor invalido em BAILEYS_VERSION; usando versao recomendada.', {
      provided: process.env.BAILEYS_VERSION,
    });
  }

  try {
    const { version } = await fetchLatestBaileysVersion();
    if (Array.isArray(version) && version.length >= 3) {
      return version;
    }
  } catch (error) {
    logger.warn('Falha ao buscar a versao recomendada do Baileys; usando fallback.', {
      error: error.message,
    });
  }

  return DEFAULT_BAILEYS_VERSION;
}

/**
 * Extrai o valor de expiração de uma mensagem do WhatsApp, ou retorna 24 horas (em segundos) por padrão.
 * @param {object} info - Objeto da mensagem recebido via Baileys.
 * @returns {number} Timestamp de expiração (em segundos).
 */
function getExpiration(sock) {
  const DEFAULT_EXPIRATION_SECONDS = 24 * 60 * 60;

  if (!sock || typeof sock !== 'object' || !sock.message) {
    return DEFAULT_EXPIRATION_SECONDS;
  }

  const messageTypes = ['conversation', 'viewOnceMessageV2', 'imageMessage', 'videoMessage', 'extendedTextMessage', 'viewOnceMessage', 'documentWithCaptionMessage', 'buttonsMessage', 'buttonsResponseMessage', 'listResponseMessage', 'templateButtonReplyMessage', 'interactiveResponseMessage'];

  for (const type of messageTypes) {
    const rawMessage = sock.message[type];
    const messageContent = rawMessage?.message ?? rawMessage;

    const expiration = messageContent?.contextInfo?.expiration;
    if (typeof expiration === 'number') {
      return expiration;
    }
  }

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

  const found = deepSearch(sock.message);
  return typeof found === 'number' ? found : null;
}

/**
 * Downloads media from a Baileys message.
 * @param {import('@whiskeysockets/baileys').WAProto.IMessage} message - The message object containing the media.
 * @param {string} type - The type of media (e.g., 'image', 'video', 'audio', 'document').
 * @param {string} outputPath - The directory where the media should be saved.
 * @returns {Promise<string|null>} The path to the downloaded file, or null if download fails.
 */
const downloadMediaMessage = async (message, type, outputPath) => {
  try {
    let buffer = Buffer.from([]);
    const stream = await downloadContentFromMessage(message, type);

    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const fileId = message.key?.id || Date.now();
    const fileName = `${Date.now()}-${fileId}.${type === 'image' ? 'jpeg' : type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'bin'}`;
    const filePath = path.join(outputPath, fileName);

    fs.writeFileSync(filePath, buffer);
    logger.info(`Media downloaded successfully to ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error(`Error downloading media: ${error.message}`, error);
    return null;
  }
};

module.exports = {
  downloadMediaMessage,
  getExpiration,
  resolveBaileysVersion,
};
