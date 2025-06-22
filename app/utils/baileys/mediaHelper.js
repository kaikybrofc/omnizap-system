/**
 * OmniZap Media Helper
 *
 * Utilitário para processamento e download de mensagens de mídia do WhatsApp,
 * com gestão de timeouts, limites de tamanho e tratamento de erros.
 *
 * @version 1.1.0
 * @author OmniZap Team
 * @license MIT
 */

const { downloadContentFromMessage } = require('baileys');
const logger = require('../logger/loggerModule');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Tipos de mídia válidos para download
const VALID_MEDIA_TYPES = new Set(['audio', 'video', 'image', 'document', 'sticker']);

// Configurações padrão
const DEFAULT_MAX_ALLOWED_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30 * 1000; // 30 segundos

/**
 * Baixa e converte para buffer o conteúdo de mídia de uma mensagem
 *
 * @param {Object} mediaKey - Objeto de mídia para download (do Baileys)
 * @param {String} mediaType - Tipo de mídia (audio, video, image, document, sticker)
 * @param {Object} options - Opções de download (tamanho máximo, timeout)
 * @returns {Promise<Buffer|null>} Buffer da mídia ou null em caso de erro
 */
const getFileBuffer = async (mediaKey, mediaType, options = {}) => {
  const {
    allowUnknownType = false,
    maxSize = DEFAULT_MAX_ALLOWED_SIZE_BYTES,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  } = options;

  if (!mediaKey || typeof mediaKey !== 'object') {
    logger.warn(
      `[ getFileBuffer ] Parâmetro 'mediaKey' inválido ou ausente. Esperado um objeto, recebido: ${typeof mediaKey}`,
    );
    return null;
  }

  if (!mediaType || typeof mediaType !== 'string') {
    logger.warn(
      `[ getFileBuffer ] Parâmetro 'mediaType' inválido ou ausente. Esperado uma string, recebido: ${typeof mediaType}`,
    );
    return null;
  }

  if (!VALID_MEDIA_TYPES.has(mediaType)) {
    if (!allowUnknownType) {
      logger.warn(
        `[ getFileBuffer ] Tipo de mídia inválido: '${mediaType}'. Deve ser um dos seguintes: ${[
          ...VALID_MEDIA_TYPES,
        ].join(', ')}. Configure options.allowUnknownType=true para tentar o download mesmo assim.`,
      );
      return null;
    } else {
      logger.info(
        `[ getFileBuffer ] Tipo de mídia desconhecido: '${mediaType}'. Prosseguindo com a tentativa de download, pois allowUnknownType está ativado.`,
      );
    }
  }

  let stream;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.warn(
      `[ getFileBuffer ] Download atingiu o timeout após ${timeoutMs}ms para o tipo '${mediaType}'. Abortando.`,
    );
    controller.abort();
  }, timeoutMs);

  try {
    logger.debug(
      `[ getFileBuffer ] Tentando baixar mídia do tipo '${mediaType}' (Limite: ${maxSize.toLocaleString()} bytes, Timeout: ${timeoutMs}ms)...`,
    );

    stream = await downloadContentFromMessage(mediaKey, mediaType);

    const chunks = [];
    let totalSize = 0;

    for await (const chunk of stream) {
      if (controller.signal.aborted) {
        if (typeof stream.destroy === 'function') {
          stream.destroy();
        } else if (typeof stream.cancel === 'function') {
          stream.cancel();
        }
        clearTimeout(timeoutId);
        return null;
      }

      totalSize += chunk.length;

      if (totalSize > maxSize) {
        logger.warn(
          `[ getFileBuffer ] Download abortado para o tipo '${mediaType}' - excedeu o tamanho máximo (${maxSize.toLocaleString()} bytes). Recebido ${totalSize.toLocaleString()} bytes.`,
        );
        if (typeof stream.destroy === 'function') {
          stream.destroy();
        } else if (typeof stream.cancel === 'function') {
          stream.cancel();
        } else {
          logger.warn(
            `[ getFileBuffer ] Não foi possível abortar o stream por limite de tamanho - nenhum método destroy() ou cancel() encontrado.`,
          );
        }
        clearTimeout(timeoutId);
        return null;
      }
      chunks.push(chunk);
    }

    clearTimeout(timeoutId);

    if (controller.signal.aborted) {
      logger.debug(
        `[ getFileBuffer ] Download abortado imediatamente após o término do stream para o tipo '${mediaType}'.`,
      );
      return null;
    }

    if (chunks.length === 0 && totalSize === 0) {
      logger.warn(
        `[ getFileBuffer ] Nenhum dado recebido do stream para o tipo de mídia '${mediaType}'. A mídia pode estar vazia ou inacessível.`,
      );
      return null;
    }

    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0 && totalSize > 0) {
      logger.warn(
        `[ getFileBuffer ] Download resultou em um buffer vazio para o tipo de mídia '${mediaType}' após concatenação, apesar de receber ${totalSize} bytes.`,
      );
      return null;
    } else if (buffer.length === 0 && totalSize === 0) {
      logger.warn(
        `[ getFileBuffer ] Download resultou em um buffer vazio e zero bytes recebidos para o tipo de mídia '${mediaType}'.`,
      );
      return null;
    }

    logger.info(
      `[ getFileBuffer ] Download bem-sucedido: ${buffer.length.toLocaleString()} bytes (${(
        buffer.length /
        1024 /
        1024
      ).toFixed(
        2,
      )} MB) baixados para o tipo de mídia '${mediaType}'. Limite: ${maxSize.toLocaleString()} bytes.`,
    );
    return buffer;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError' || controller.signal.aborted) {
      logger.warn(`[ getFileBuffer ] Download explicitamente abortado para o tipo '${mediaType}'.`);
      if (stream) {
        if (typeof stream.destroy === 'function') stream.destroy();
        else if (typeof stream.cancel === 'function') stream.cancel();
      }
      return null;
    }

    logger.error(
      `[ getFileBuffer ] Falha ao baixar ou processar o tipo de mídia '${mediaType}'. Erro: ${
        error?.message || error
      }`,
      {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        mediaType: mediaType,
        mediaKey: mediaKey,
      },
    );

    if (stream) {
      if (typeof stream.destroy === 'function') {
        stream.destroy();
      } else if (typeof stream.cancel === 'function') {
        stream.cancel();
      }
    }
    return null;
  }
};

/**
 * Gera um nome de arquivo aleatório mantendo a extensão original
 *
 * @param {string} originalName - Nome original do arquivo
 * @returns {string} Nome de arquivo aleatório com a extensão original
 */
function generateRandomFileName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const randomName = crypto.randomBytes(16).toString('hex');
  return `${randomName}${ext}`;
}

/**
 * Determina a extensão de arquivo apropriada com base no tipo MIME
 *
 * @param {string} mimeType - Tipo MIME do arquivo
 * @returns {string} Extensão de arquivo correspondente incluindo o ponto
 */
function getMimeExtension(mimeType) {
  const mimeMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'application/pdf': '.pdf',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/zip': '.zip',
    'application/x-7z-compressed': '.7z',
    'application/x-rar-compressed': '.rar',
    'text/plain': '.txt',
  };

  return mimeMap[mimeType] || '.bin';
}

/**
 * Salva buffer de mídia em arquivo com nome aleatório
 *
 * @param {Buffer} mediaBuffer - Buffer contendo os dados da mídia
 * @param {string} mimeType - Tipo MIME da mídia
 * @param {string} originalFilename - Nome original do arquivo (opcional)
 * @param {string} outputDir - Diretório onde o arquivo será salvo
 * @returns {Promise<string>} Caminho completo do arquivo salvo
 */
async function saveMediaToFile(mediaBuffer, mimeType, originalFilename = '', outputDir = 'temp') {
  try {
    if (!mediaBuffer || !Buffer.isBuffer(mediaBuffer)) {
      logger.error(`[ saveMediaToFile ] Buffer de mídia inválido ou ausente`);
      throw new Error('Buffer de mídia inválido ou ausente');
    }

    // Garantir que o diretório de saída existe
    await fs.mkdir(outputDir, { recursive: true });

    // Determinar a extensão e gerar nome de arquivo
    const fileExt = path.extname(originalFilename) || getMimeExtension(mimeType);
    const fileName = generateRandomFileName(originalFilename || `file${fileExt}`);
    const filePath = path.join(outputDir, fileName);

    // Salvar o buffer no arquivo
    await fs.writeFile(filePath, mediaBuffer);

    logger.info(
      `[ saveMediaToFile ] Mídia salva em ${filePath} (${mediaBuffer.length.toLocaleString()} bytes)`,
    );
    return filePath;
  } catch (error) {
    logger.error(`[ saveMediaToFile ] Erro ao salvar mídia:`, {
      message: error?.message,
      stack: error?.stack,
      mimeType: mimeType,
      outputDir: outputDir,
    });
    throw error;
  }
}

/**
 * Mapeia tipos de mídia do WhatsApp para tipos compatíveis com downloadContentFromMessage
 *
 * @param {string} whatsappType - Tipo de mídia no formato do WhatsApp
 * @returns {string} Tipo de mídia no formato aceito pelo Baileys
 */
function mapMediaType(whatsappType) {
  const typeMap = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
  };

  return typeMap[whatsappType] || null;
}

/**
 * Extrai informações de mídia de uma mensagem do WhatsApp
 *
 * @param {Object} message - Mensagem do WhatsApp
 * @returns {Object|null} Objeto com informações da mídia ou null se não for mídia
 */
function extractMediaInfo(message) {
  if (!message || !message.message) {
    return null;
  }

  try {
    const type = Object.keys(message.message)[0];

    // Verifica se é uma mídia direta
    if (
      [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage',
      ].includes(type)
    ) {
      const mediaObject = message.message[type];
      return {
        type: mapMediaType(type),
        mediaObject,
        isQuoted: false,
        mimeType: mediaObject.mimetype,
        fileName: mediaObject.fileName || mediaObject.title || '',
        fileSize: mediaObject.fileLength || 0,
        caption: mediaObject.caption || '',
        contextInfo: mediaObject.contextInfo || null,
      };
    }

    // Verifica se é uma mídia citada (quoted)
    if (
      type === 'extendedTextMessage' &&
      message.message.extendedTextMessage.contextInfo?.quotedMessage
    ) {
      const quotedMessage = message.message.extendedTextMessage.contextInfo.quotedMessage;
      const quotedType = Object.keys(quotedMessage)[0];

      if (
        [
          'imageMessage',
          'videoMessage',
          'audioMessage',
          'documentMessage',
          'stickerMessage',
        ].includes(quotedType)
      ) {
        const mediaObject = quotedMessage[quotedType];
        return {
          type: mapMediaType(quotedType),
          mediaObject,
          isQuoted: true,
          quotedMessage,
          mimeType: mediaObject.mimetype,
          fileName: mediaObject.fileName || mediaObject.title || '',
          fileSize: mediaObject.fileLength || 0,
          caption: mediaObject.caption || '',
          contextInfo: message.message.extendedTextMessage.contextInfo || null,
        };
      }
    }

    return null;
  } catch (error) {
    logger.error(`[ extractMediaInfo ] Erro ao extrair informações de mídia:`, {
      message: error?.message,
      stack: error?.stack,
    });
    return null;
  }
}

module.exports = {
  getFileBuffer,
  generateRandomFileName,
  getMimeExtension,
  saveMediaToFile,
  extractMediaInfo,
  VALID_MEDIA_TYPES,
  DEFAULT_MAX_ALLOWED_SIZE_BYTES,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
};
