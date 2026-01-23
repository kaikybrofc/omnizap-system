import {
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  jidNormalizedUser,
  jidEncode,
  jidDecode,
  areJidsSameUser,
  isJidMetaAI,
  isPnUser,
  isLidUser,
  isJidBroadcast,
  isJidGroup,
  isJidStatusBroadcast,
  isJidNewsletter,
  isHostedPnUser,
  isHostedLidUser,
  isJidBot,
  SERVER_JID,
  PSA_WID,
  STORIES_JID,
  META_AI_JID,
} from '@whiskeysockets/baileys';

import logger from '../utils/logger/loggerModule.js';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

const DEFAULT_BAILEYS_VERSION = [7, 0, 0];

export const JID_CONSTANTS = {
  SERVER_JID,
  PSA_WID,
  STORIES_JID,
  META_AI_JID,
};

export function encodeJid(user, server = 'c.us', device) {
  if (user === null || user === undefined) return null;
  return jidEncode(user, server, device);
}

export function decodeJid(jid) {
  if (!jid) return null;
  return jidDecode(jid) || null;
}

export function normalizeJid(jid) {
  if (!jid) return '';
  return jidNormalizedUser(jid);
}

export function getJidUser(jid) {
  return decodeJid(jid)?.user || null;
}

export function getJidServer(jid) {
  return decodeJid(jid)?.server || null;
}

export function isSameJidUser(jid1, jid2) {
  return areJidsSameUser(jid1, jid2);
}

export function isUserJid(jid) {
  return Boolean(
    jid &&
      (isPnUser(jid) ||
        isHostedPnUser(jid) ||
        isLidUser(jid) ||
        isHostedLidUser(jid))
  );
}

export function isGroupJid(jid) {
  return Boolean(jid && isJidGroup(jid));
}

export function isBroadcastJid(jid) {
  return Boolean(jid && isJidBroadcast(jid));
}

export function isStatusJid(jid) {
  return Boolean(jid && isJidStatusBroadcast(jid));
}

export function isNewsletterJid(jid) {
  return Boolean(jid && isJidNewsletter(jid));
}

export function isMetaAiJid(jid) {
  return Boolean(jid && isJidMetaAI(jid));
}

export function isBotJid(jid) {
  return Boolean(jid && isJidBot(jid));
}

export function resolveBotJid(sockUserId) {
  const normalized = normalizeJid(sockUserId);
  if (normalized) return normalized;
  if (!sockUserId || typeof sockUserId !== 'string') return null;
  const rawUser = sockUserId.split(':')[0];
  return encodeJid(rawUser, 's.whatsapp.net');
}

/**
 * Tipos de midia conhecidos do Baileys
 * Mapeamento de sufixos de mensagem para tipos de midia
 */
export const MEDIA_TYPE_MAPPING = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  pttMessage: 'voice',
  contactMessage: 'contact',
  contactsArrayMessage: 'contacts',
  locationMessage: 'location',
  liveLocationMessage: 'liveLocation',
  buttonsMessage: 'buttons',
  templateMessage: 'template',
  listMessage: 'list',
  ephemeralMessage: 'ephemeral',
  reactionMessage: 'reaction',
  pollCreationMessage: 'poll',
  pollUpdateMessage: 'pollUpdate',
  invoiceMessage: 'invoice',
  sendPaymentMessage: 'payment',
  requestPaymentMessage: 'paymentRequest',
  cancelPaymentRequestMessage: 'paymentCancel',
  declinePaymentRequestMessage: 'paymentDecline',
  groupInviteMessage: 'groupInvite',
  productMessage: 'product',
  orderMessage: 'order',
  viewOnceMessage: 'viewOnce',
  viewOnceMessageV2: 'viewOnceV2',
  interactiveMessage: 'interactive',
  newsletterAdminInviteMessage: 'newsletterInvite',
  eventMessage: 'event',
  highlyStructuredMessage: 'structured',
  fastRatchetKeySenderKeyDistributionMessage: 'keyDistribution',
  deviceSentMessage: 'deviceSent',
  messageContextInfo: 'contextInfo',
  botInvokeMessage: 'botInvoke',
};

/**
 * Tipos de midia que contem conteudo binario/arquivo
 */
export const BINARY_MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker']);

function parseBaileysVersion(rawVersion) {
  if (!rawVersion) {
    return null;
  }

  const cleaned = String(rawVersion).replace(/[\[\]\s]/g, '');
  const parts = cleaned
    .split(/[.,]/)
    .filter(Boolean)
    .map((value) => Number(value));

  if (parts.length < 3 || parts.some((value) => Number.isNaN(value))) {
    return null;
  }

  return parts.slice(0, 3);
}

export async function resolveBaileysVersion() {
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

export async function getProfilePicBuffer(sock, msg) {
  const rawJid = msg.key.participant || msg.key.remoteJid;
  const jid = jidNormalizedUser(rawJid);

  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    if (!url) return null;

    const res = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  } catch (error) {
    return null;
  }
}

/**
 * Extrai o valor de expiração de uma mensagem do WhatsApp, ou retorna 24 horas (em segundos) por padrão.
 * @param {object} info - Objeto da mensagem recebido via Baileys.
 * @returns {number} Timestamp de expiração (em segundos).
 */
export function getExpiration(sock) {
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
export const downloadMediaMessage = async (message, type, outputPath) => {
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

/**
 * Detecta dinamicamente todos os tipos de midia em um objeto de mensagem
 * @param {object} messageContent - Conteudo da mensagem
 * @param {boolean} isQuoted - Se e de uma mensagem citada
 * @returns {Array} Array de objetos com detalhes da midia encontrada
 */
export function detectAllMediaTypes(messageContent, isQuoted = false) {
  if (!messageContent || typeof messageContent !== 'object') {
    return [];
  }

  const mediaFound = [];

  for (const [key, value] of Object.entries(messageContent)) {
    if (value && typeof value === 'object') {
      const mediaType = MEDIA_TYPE_MAPPING[key];
      if (mediaType) {
        mediaFound.push({
          mediaType,
          mediaKey: value,
          messageKey: key,
          isQuoted,
          isBinary: BINARY_MEDIA_TYPES.has(mediaType),
          hasUrl: !!value.url,
          hasDirectPath: !!value.directPath,
          hasMediaKey: !!value.mediaKey,
          hasFileEncSha256: !!value.fileEncSha256,
          mimetype: value.mimetype || null,
          fileLength: value.fileLength || null,
          fileName: value.fileName || null,
          caption: value.caption || null,
        });
      } else if (key.toLowerCase().includes('message') && !MEDIA_TYPE_MAPPING[key]) {
        const inferredType = key.replace(/Message$/, '').toLowerCase();
        mediaFound.push({
          mediaType: inferredType,
          mediaKey: value,
          messageKey: key,
          isQuoted,
          isBinary: false,
          isUnknownType: true,
          hasUrl: !!value.url,
          hasDirectPath: !!value.directPath,
          hasMediaKey: !!value.mediaKey,
          hasFileEncSha256: !!value.fileEncSha256,
          mimetype: value.mimetype || null,
          fileLength: value.fileLength || null,
          fileName: value.fileName || null,
          caption: value.caption || null,
        });
      }
    }
  }

  return mediaFound;
}

/**
 * Extrai detalhes da midia da mensagem de forma dinamica
 * @param {object} message - O objeto da mensagem
 * @param {object} options - Opcoes de configuracao
 * @param {boolean} options.includeAllTypes - Se deve incluir todos os tipos, nao apenas binarios
 * @param {boolean} options.includeQuoted - Se deve incluir midia de mensagens citadas
 * @param {boolean} options.includeUnknown - Se deve incluir tipos desconhecidos
 * @returns {{mediaType: string, mediaKey: object, details: object}|null} - Detalhes da midia ou null se nao encontrada
 */
export function extractMediaDetails(message, options = {}) {
  const { includeAllTypes = false, includeQuoted = true, includeUnknown = false } = options;

  if (!message || !message.message) {
    return null;
  }

  const messageContent = message.message;
  let allMedia = detectAllMediaTypes(messageContent, false);

  if (includeQuoted) {
    const quotedMessage = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMessage) {
      const quotedMedia = detectAllMediaTypes(quotedMessage, true);
      allMedia = allMedia.concat(quotedMedia);
    }
  }

  let filteredMedia = allMedia;

  if (!includeAllTypes) {
    filteredMedia = filteredMedia.filter((media) => media.isBinary);
  }

  if (!includeUnknown) {
    filteredMedia = filteredMedia.filter((media) => !media.isUnknownType);
  }
  if (filteredMedia.length > 0) {
    const primaryMedia = filteredMedia[0];
    return {
      mediaType: primaryMedia.mediaType,
      mediaKey: primaryMedia.mediaKey,
      isQuoted: primaryMedia.isQuoted,
      details: {
        messageKey: primaryMedia.messageKey,
        isBinary: primaryMedia.isBinary,
        isUnknownType: primaryMedia.isUnknownType,
        hasUrl: primaryMedia.hasUrl,
        hasDirectPath: primaryMedia.hasDirectPath,
        hasMediaKey: primaryMedia.hasMediaKey,
        hasFileEncSha256: primaryMedia.hasFileEncSha256,
        mimetype: primaryMedia.mimetype,
        fileLength: primaryMedia.fileLength,
        fileName: primaryMedia.fileName,
        caption: primaryMedia.caption,
        allMediaFound: allMedia.length > 1 ? allMedia : null,
      },
    };
  }

  return null;
}

/**
 * Extrai todos os tipos de midia de uma mensagem
 * @param {object} message - O objeto da mensagem
 * @param {object} options - Opcoes de configuracao
 * @returns {Array} Array com todos os tipos de midia encontrados
 */
export function extractAllMediaDetails(message, options = {}) {
  const { includeAllTypes = true, includeQuoted = true, includeUnknown = true } = options;

  if (!message || !message.message) {
    return [];
  }

  const messageContent = message.message;

  let allMedia = detectAllMediaTypes(messageContent, false);

  if (includeQuoted) {
    const quotedMessage = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMessage) {
      const quotedMedia = detectAllMediaTypes(quotedMessage, true);
      allMedia = allMedia.concat(quotedMedia);
    }
  }

  let filteredMedia = allMedia;

  if (!includeAllTypes) {
    filteredMedia = filteredMedia.filter((media) => media.isBinary);
  }

  if (!includeUnknown) {
    filteredMedia = filteredMedia.filter((media) => !media.isUnknownType);
  }

  return filteredMedia;
}

/**
 * Verifica se uma mensagem contem midia
 * @param {object} message - O objeto da mensagem
 * @param {string} specificType - Tipo especifico para verificar (opcional)
 * @returns {boolean} True se contem midia
 */
export function hasMedia(message, specificType = null) {
  const mediaDetails = extractMediaDetails(message, { includeAllTypes: true, includeUnknown: true });

  if (!mediaDetails) {
    return false;
  }

  if (specificType) {
    return mediaDetails.mediaType === specificType || (mediaDetails.details.allMediaFound && mediaDetails.details.allMediaFound.some((media) => media.mediaType === specificType));
  }

  return true;
}

/**
 * Obtem informacoes sobre os tipos de midia suportados
 * @returns {object} Informacoes sobre tipos de midia
 */
export function getMediaTypeInfo() {
  return {
    knownTypes: Object.values(MEDIA_TYPE_MAPPING),
    binaryTypes: Array.from(BINARY_MEDIA_TYPES),
    typeMapping: { ...MEDIA_TYPE_MAPPING },
    totalKnownTypes: Object.keys(MEDIA_TYPE_MAPPING).length,
  };
}
