/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/* eslint-disable no-useless-escape */
import {
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  jidNormalizedUser,
  jidEncode,
  jidDecode,
  areJidsSameUser,
  normalizeMessageContent,
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
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const DEFAULT_BAILEYS_VERSION = [7, 0, 0];

export const JID_CONSTANTS = {
  SERVER_JID,
  PSA_WID,
  STORIES_JID,
  META_AI_JID,
};

const decodeJidParts = (() => {
  let lastJid = null;
  let lastDecoded = null;

  return (jid) => {
    if (!jid) return null;
    if (jid === lastJid) return lastDecoded;
    const decoded = jidDecode(jid) || null;
    lastJid = jid;
    lastDecoded = decoded;
    return decoded;
  };
})();

/**
 * Tipos de mensagem conhecidos do Baileys
 * Mapeamento de chaves do proto.Message para tipos normalizados
 */
export const MEDIA_TYPE_MAPPING = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  contactsArrayMessage: 'contacts',
  locationMessage: 'location',
  liveLocationMessage: 'liveLocation',
  buttonsMessage: 'buttons',
  buttonsResponseMessage: 'buttonsResponse',
  templateMessage: 'template',
  templateButtonReplyMessage: 'buttonReply',
  listMessage: 'list',
  listResponseMessage: 'listResponse',
  ephemeralMessage: 'ephemeral',
  reactionMessage: 'reaction',
  pollCreationMessage: 'poll',
  pollUpdateMessage: 'pollUpdate',
  pollResultSnapshotMessage: 'pollResult',
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
  interactiveResponseMessage: 'interactiveResponse',
  newsletterAdminInviteMessage: 'newsletterInvite',
  eventMessage: 'event',
  requestPhoneNumberMessage: 'requestPhoneNumber',
  call: 'call',
  messageHistoryBundle: 'messageHistoryBundle',
  messageHistoryNotice: 'messageHistoryNotice',
  albumMessage: 'album',
  stickerPackMessage: 'stickerPack',
  highlyStructuredMessage: 'structured',
  fastRatchetKeySenderKeyDistributionMessage: 'keyDistribution',
  deviceSentMessage: 'deviceSent',
  messageContextInfo: 'contextInfo',
  botInvokeMessage: 'botInvoke',
};

/**
 * Tipos de midia que contem conteudo binario/arquivo
 */
export const BINARY_MEDIA_TYPES = new Set(['image', 'video', 'videoNote', 'audio', 'voice', 'document', 'sticker']);

const normalizeMessage = (message) => normalizeMessageContent(message) || message;

const hasNonEmptyMediaKey = (mediaKey) => {
  if (!mediaKey) return false;

  if (typeof mediaKey === 'string') {
    return mediaKey.trim().length > 0;
  }

  if (Buffer.isBuffer(mediaKey) || mediaKey instanceof Uint8Array) {
    return mediaKey.length > 0;
  }

  if (Array.isArray(mediaKey)) {
    return mediaKey.length > 0;
  }

  if (typeof mediaKey === 'object') {
    if (typeof mediaKey.byteLength === 'number') {
      return mediaKey.byteLength > 0;
    }
    return Object.keys(mediaKey).length > 0;
  }

  return Boolean(mediaKey);
};

const buildMediaEntry = (mediaType, messageKey, value, isQuoted, overrides = {}) => ({
  mediaType,
  mediaKey: value,
  messageKey,
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
  ...overrides,
});

const collectMediaFromMessage = (message, { includeQuoted = true } = {}) => {
  if (!message || !message.message) {
    return [];
  }

  const messageContent = message.message;
  let allMedia = detectAllMediaTypes(messageContent, false);

  if (includeQuoted) {
    const quotedMessage = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMessage) {
      allMedia = allMedia.concat(detectAllMediaTypes(quotedMessage, true));
    }
  }

  return allMedia;
};

const filterMedia = (media, { includeAllTypes = false, includeUnknown = false } = {}) => {
  let filtered = media;

  if (!includeAllTypes) {
    filtered = filtered.filter((item) => item.isBinary);
  }

  if (!includeUnknown) {
    filtered = filtered.filter((item) => !item.isUnknownType);
  }

  return filtered;
};

const findExpiration = (root) => {
  if (!root || typeof root !== 'object') return null;

  const stack = [root];
  const visited = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const expiration = current.contextInfo?.expiration;
    if (typeof expiration === 'number') return expiration;

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return null;
};

const getMediaExtension = (type) => {
  if (type === 'image') return 'jpeg';
  if (type === 'video') return 'mp4';
  if (type === 'audio') return 'mp3';
  return 'bin';
};

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

export function encodeJid(user, server = 'c.us', device) {
  if (user === null || user === undefined) return null;
  return jidEncode(user, server, device);
}

export function decodeJid(jid) {
  if (!jid) return null;
  return decodeJidParts(jid);
}

export function normalizeJid(jid) {
  if (!jid) return '';
  return jidNormalizedUser(jid);
}

export function getJidUser(jid) {
  return decodeJidParts(jid)?.user || null;
}

export function getJidServer(jid) {
  return decodeJidParts(jid)?.server || null;
}

export function isSameJidUser(jid1, jid2) {
  return areJidsSameUser(jid1, jid2);
}

export function isUserJid(jid) {
  return Boolean(jid && (isPnUser(jid) || isHostedPnUser(jid) || isLidUser(jid) || isHostedLidUser(jid)));
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
  const rawJid = msg?.key?.participant || msg?.key?.remoteJid;
  const jid = jidNormalizedUser(rawJid);

  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.arrayBuffer();
    return Buffer.from(data);
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

  const normalizedMessage = normalizeMessage(sock.message);
  const expiration = findExpiration(normalizedMessage);

  return typeof expiration === 'number' ? expiration : DEFAULT_EXPIRATION_SECONDS;
}

/**
 * Extrai o conteúdo de texto de uma mensagem do WhatsApp.
 * @param {Object} messageInfo
 * @returns {string}
 */
export const extractMessageContent = ({ message }) => {
  if (!message) return 'Mensagem vazia';

  const normalizedMessage = normalizeMessage(message);
  if (!normalizedMessage) return 'Mensagem vazia';

  const text = normalizedMessage.conversation?.trim() || normalizedMessage.extendedTextMessage?.text;

  if (text) return text;

  const handlers = [
    [normalizedMessage.imageMessage, (m) => m.caption || '[Imagem]'],
    [normalizedMessage.videoMessage, (m) => m.caption || '[Vídeo]'],
    [normalizedMessage.documentMessage, (m) => m.fileName || '[Documento]'],
    [normalizedMessage.audioMessage, (m) => (m.ptt ? '[Áudio] (voz)' : '[Áudio]')],
    [normalizedMessage.stickerMessage, () => '[Figurinha]'],
    [normalizedMessage.locationMessage, (m) => `[Localização] Lat: ${m.degreesLatitude}, Long: ${m.degreesLongitude}`],
    [normalizedMessage.contactMessage, (m) => `[Contato] ${m.displayName}`],
    [normalizedMessage.contactsArrayMessage, (m) => `[Contatos] ${m.contacts.map((c) => c.displayName).join(', ')}`],
    [normalizedMessage.listMessage, (m) => m.description || '[Mensagem de Lista]'],
    [
      normalizedMessage.listResponseMessage,
      (m) => `[Lista] ${m.singleSelectReply?.selectedRowId || m.title || ''}`.trim(),
    ],
    [normalizedMessage.buttonsMessage, (m) => m.contentText || '[Mensagem de Botões]'],
    [
      normalizedMessage.buttonsResponseMessage,
      (m) => `[Botão] ${m.selectedDisplayText || m.selectedButtonId || ''}`.trim(),
    ],
    [normalizedMessage.templateButtonReplyMessage, (m) => `[Resposta de Botão] ${m.selectedDisplayText || ''}`.trim()],
    [
      normalizedMessage.interactiveResponseMessage,
      (m) => `[Interativo] ${m.body?.text || m.nativeFlowResponseMessage?.name || ''}`.trim(),
    ],
    [normalizedMessage.productMessage, (m) => m.product?.title || '[Mensagem de Produto]'],
    [normalizedMessage.reactionMessage, (m) => `[Reação] ${m.text || ''}`.trim()],
    [normalizedMessage.pollCreationMessage, (m) => `[Enquete] ${m.name}`],
    [normalizedMessage.pollResultSnapshotMessage, (m) => `[Resultado de Enquete] ${m.name || ''}`.trim()],
    [normalizedMessage.requestPhoneNumberMessage, () => '[Solicitação de telefone]'],
    [normalizedMessage.groupInviteMessage, (m) => `[Convite de grupo] ${m.groupName || ''}`.trim()],
    [normalizedMessage.eventMessage, (m) => `[Evento] ${m.name || ''}`.trim()],
    [normalizedMessage.newsletterAdminInviteMessage, () => '[Convite de newsletter]'],
    [normalizedMessage.albumMessage, () => '[Álbum]'],
    [normalizedMessage.stickerPackMessage, () => '[Pacote de figurinhas]'],
    [normalizedMessage.messageHistoryBundle, () => '[Histórico de mensagens]'],
    [normalizedMessage.messageHistoryNotice, () => '[Aviso de histórico de mensagens]'],
    [normalizedMessage.call, () => '[Chamada]'],
  ];

  for (const [msg, fn] of handlers) {
    if (msg) return fn(msg);
  }

  return 'Tipo de mensagem não suportado ou sem conteúdo.';
};

/**
 * Downloads media from a Baileys message.
 * @param {import('@whiskeysockets/baileys').WAProto.IMessage} message - The message object containing the media.
 * @param {string} type - The type of media (e.g., 'image', 'video', 'audio', 'document').
 * @param {string} outputPath - The directory where the media should be saved.
 * @returns {Promise<string|null>} The path to the downloaded file, or null if download fails.
 */
export const downloadMediaMessage = async (message, type, outputPath) => {
  if (!message || typeof message !== 'object') {
    logger.warn('Skipping media download: invalid message payload.', { type });
    return null;
  }

  if (!hasNonEmptyMediaKey(message.mediaKey)) {
    logger.warn('Skipping media download: missing or empty media key.', {
      type,
      hasUrl: Boolean(message.url),
      hasDirectPath: Boolean(message.directPath),
    });
    return null;
  }

  if (!message.url && !message.directPath) {
    logger.warn('Skipping media download: media URL/directPath not found.', { type });
    return null;
  }

  try {
    const stream = await downloadContentFromMessage(message, type);

    const fileId = message.key?.id || Date.now();
    const extension = getMediaExtension(type);
    const fileName = `${Date.now()}-${fileId}.${extension}`;
    const filePath = path.join(outputPath, fileName);

    await pipeline(Readable.from(stream), createWriteStream(filePath));
    logger.info(`Media downloaded successfully to ${filePath}`);
    return filePath;
  } catch (error) {
    if (error?.message?.includes('Cannot derive from empty media key')) {
      logger.warn('Skipping media download: invalid media key received from source.', { type });
      return null;
    }

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

  const normalizedMessage = normalizeMessage(messageContent);
  if (!normalizedMessage || typeof normalizedMessage !== 'object') {
    return [];
  }

  const mediaFound = [];

  for (const [key, value] of Object.entries(normalizedMessage)) {
    if (!value || typeof value !== 'object') continue;

    let mediaType = MEDIA_TYPE_MAPPING[key];
    if (key === 'audioMessage' && value.ptt) {
      mediaType = 'voice';
    } else if (key === 'videoMessage' && value.ptv) {
      mediaType = 'videoNote';
    }

    if (mediaType) {
      mediaFound.push(buildMediaEntry(mediaType, key, value, isQuoted));
      continue;
    }

    if (key.toLowerCase().includes('message')) {
      const inferredType = key.replace(/Message$/, '').toLowerCase();
      mediaFound.push(
        buildMediaEntry(inferredType, key, value, isQuoted, {
          isBinary: false,
          isUnknownType: true,
        }),
      );
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

  const allMedia = collectMediaFromMessage(message, { includeQuoted });
  const filteredMedia = filterMedia(allMedia, { includeAllTypes, includeUnknown });

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

  const allMedia = collectMediaFromMessage(message, { includeQuoted });
  return filterMedia(allMedia, { includeAllTypes, includeUnknown });
}

/**
 * Verifica se uma mensagem contem midia
 * @param {object} message - O objeto da mensagem
 * @param {string} specificType - Tipo especifico para verificar (opcional)
 * @returns {boolean} True se contem midia
 */
export function hasMedia(message, specificType = null) {
  const allMedia = collectMediaFromMessage(message, { includeQuoted: true });
  const filtered = filterMedia(allMedia, { includeAllTypes: true, includeUnknown: true });

  if (!filtered.length) {
    return false;
  }

  if (specificType) {
    return filtered.some((media) => media.mediaType === specificType);
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
