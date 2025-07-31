/**
 * Tipos de mídia conhecidos do Baileys
 * Mapeamento de sufixos de mensagem para tipos de mídia
 */
const MEDIA_TYPE_MAPPING = {
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
 * Tipos de mídia que contêm conteúdo binário/arquivo
 */
const BINARY_MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker']);

/**
 * Detecta dinamicamente todos os tipos de mídia em um objeto de mensagem
 * @param {object} messageContent - Conteúdo da mensagem
 * @param {boolean} isQuoted - Se é de uma mensagem citada
 * @returns {Array} Array de objetos com detalhes da mídia encontrada
 */
function detectAllMediaTypes(messageContent, isQuoted = false) {
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
 * Extrai detalhes da mídia da mensagem de forma dinâmica
 * @param {object} message - O objeto da mensagem
 * @param {object} options - Opções de configuração
 * @param {boolean} options.includeAllTypes - Se deve incluir todos os tipos, não apenas binários
 * @param {boolean} options.includeQuoted - Se deve incluir mídia de mensagens citadas
 * @param {boolean} options.includeUnknown - Se deve incluir tipos desconhecidos
 * @returns {{mediaType: string, mediaKey: object, details: object}|null} - Detalhes da mídia ou null se não encontrada
 */
function extractMediaDetails(message, options = {}) {
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
 * Extrai todos os tipos de mídia de uma mensagem
 * @param {object} message - O objeto da mensagem
 * @param {object} options - Opções de configuração
 * @returns {Array} Array com todos os tipos de mídia encontrados
 */
function extractAllMediaDetails(message, options = {}) {
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
 * Verifica se uma mensagem contém mídia
 * @param {object} message - O objeto da mensagem
 * @param {string} specificType - Tipo específico para verificar (opcional)
 * @returns {boolean} True se contém mídia
 */
function hasMedia(message, specificType = null) {
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
 * Obtém informações sobre os tipos de mídia suportados
 * @returns {object} Informações sobre tipos de mídia
 */
function getMediaTypeInfo() {
  return {
    knownTypes: Object.values(MEDIA_TYPE_MAPPING),
    binaryTypes: Array.from(BINARY_MEDIA_TYPES),
    typeMapping: { ...MEDIA_TYPE_MAPPING },
    totalKnownTypes: Object.keys(MEDIA_TYPE_MAPPING).length,
  };
}

module.exports = {
  extractMediaDetails,
  extractAllMediaDetails,
  detectAllMediaTypes,
  hasMedia,
  getMediaTypeInfo,
  MEDIA_TYPE_MAPPING,
  BINARY_MEDIA_TYPES,
};