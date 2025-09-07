const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const { exec } = require('child_process');
const execProm = util.promisify(exec);
const logger = require('../../utils/logger/loggerModule');
const { downloadMediaMessage } = require('../../utils/mediaDownloader/mediaDownloaderModule');

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');
const MAX_FILE_SIZE = 3 * 1024 * 1024;

async function ensureDirectories(userId) {
  if (!userId) {
    logger.error('ensureDirectories: o ID do usuário é obrigatório.');
    return { success: false, error: 'ID do usuário é obrigatório.' };
  }

  const onlyDigits = /^\d+$/;
  if (!onlyDigits.test(userId)) {
    const errorMsg = 'ID inválido: deve consistir apenas de números.';
    logger.error(`ensureDirectories: ${errorMsg} (userId fornecido: "${userId}")`);
    return { success: false, error: errorMsg };
  }

  try {
    const userStickerDir = path.join(TEMP_DIR, userId);
    await fs.mkdir(userStickerDir, { recursive: true });
    return { success: true };
  } catch (error) {
    const errorMsg = `Erro ao criar diretórios para o usuário ${userId}: ${error.message}`;
    logger.error(errorMsg, {
      label: 'ensureDirectories',
      userId,
      error,
    });
    return { success: false, error: errorMsg };
  }
}

function extractMediaDetails(message) {
  logger.debug('StickerCommand.extractMediaDetails Extraindo detalhes da mídia...');
  const messageContent = message.message;
  const quotedMessage = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage;
  const mediaTypes = ['imageMessage', 'videoMessage', 'stickerMessage', 'documentMessage'];

  const findMedia = (source, isQuoted = false) => {
    for (const type of mediaTypes) {
      if (source?.[type]) {
        return { mediaType: type.replace('Message', ''), mediaKey: source[type], isQuoted };
      }
    }
    return null;
  };

  const media = findMedia(messageContent) || findMedia(quotedMessage, true);
  if (!media) logger.debug('StickerCommand.extractMediaDetails Nenhuma mídia encontrada.');
  return media;
}

function checkMediaSize(mediaKey, mediaType, maxFileSize = MAX_FILE_SIZE) {
  const fileLength = mediaKey?.fileLength || 0;
  const formatBytes = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  logger.debug(`StickerCommand.checkMediaSize Verificando tamanho: ${formatBytes(fileLength)}`);
  if (fileLength > maxFileSize) {
    logger.warn(`StickerCommand.checkMediaSize Mídia muito grande: ${formatBytes(fileLength)}`);
    return false;
  }
  return true;
}

async function convertToWebp(inputPath, mediaType, userId, uniqueId) {
  logger.info(`StickerCommand Convertendo mídia para webp. ID: ${uniqueId}, Tipo: ${mediaType}`);
  const userStickerDir = path.join(TEMP_DIR, userId);
  const outputPath = path.join(userStickerDir, `sticker_${uniqueId}.webp`);

  try {
    if (mediaType === 'sticker') {
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }
    const filtro = mediaType === 'video' ? 'fps=10,scale=512:512' : 'scale=512:512';
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -vcodec libwebp -lossless 1 -loop 0 -preset default -an -vf "${filtro}" "${outputPath}"`;
    await execProm(ffmpegCommand);
    await fs.access(outputPath);
    logger.info(`StickerCommand Conversão bem-sucedida para: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`StickerCommand.convertToWebp Erro na conversão: ${error.message}`, {
      error: error.stack,
    });
    throw new Error(`Erro na conversão para webp: ${error.message}`);
  }
}

async function processSticker(sock, message, sender, from, text, options = {}) {
  logger.info(`StickerCommand Iniciando processamento de sticker para ${sender}...`);

  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  let tempMediaPath = null;
  let processingMediaPath = null;
  let stickerPath = null;

  try {
    const userId = message?.key?.participant || (sender.endsWith('@g.us') ? sender : null);
    const formattedUser = userId?.split('@')[0] ?? null;

    const dirResult = await ensureDirectories(formattedUser);
    if (!dirResult.success) {
      logger.error(`StickerCommand Erro ao garantir diretórios: ${dirResult.error}`);
      await sock.sendMessage(from, { text: `❌ Erro ao preparar diretórios do usuário: ${dirResult.error}` }, { quoted: message });
      return;
    }

    const mediaDetails = extractMediaDetails(message);
    if (!mediaDetails) {
      await sock.sendMessage(
        from,
        {
          text:
            `*❌ Falha no processamento:* nenhuma mídia foi detectada.
` +
            `Por gentileza, envie um arquivo de mídia com *tamanho máximo de 3 MB*.

` +
            `_*Dica útil*:_ _desativar o modo HD antes de enviar pode reduzir o tamanho do arquivo e facilitar o envio._`,
        },
        { quoted: message },
      );
      return;
    }

    const { mediaType, mediaKey } = mediaDetails;
    if (!checkMediaSize(mediaKey, mediaType)) {
      await sock.sendMessage(from, { text: '❌ Mídia maior que 2MB.' }, { quoted: message });
      return;
    }

    const userStickerDir = path.join(TEMP_DIR, formattedUser);
    tempMediaPath = await downloadMediaMessage(mediaKey, mediaType, userStickerDir, uniqueId);
    if (!tempMediaPath) {
      await sock.sendMessage(from, { text: '❌ Falha no download da mídia.' }, { quoted: message });
      return;
    }

    const mediaExtension = path.extname(tempMediaPath);
    processingMediaPath = path.join(userStickerDir, `media_${uniqueId}${mediaExtension}`);
    await fs.rename(tempMediaPath, processingMediaPath);
    logger.info(`StickerCommand Mídia original renomeada para: ${processingMediaPath}`);
    tempMediaPath = null;

    stickerPath = await convertToWebp(processingMediaPath, mediaType, formattedUser, uniqueId);

    let stickerBuffer = null;
    try {
      stickerBuffer = await fs.readFile(stickerPath);
    } catch (bufferErr) {
      logger.error(`StickerCommand Erro ao ler buffer do sticker: ${bufferErr.message}`);
      await sock.sendMessage(from, { text: `❌ Erro ao ler o sticker: ${bufferErr.message}.` }, { quoted: message });
      return;
    }
    try {
      await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: message });
    } catch (sendErr) {
      logger.error(`StickerCommand Erro ao enviar o sticker: ${sendErr.message}`);
      await sock.sendMessage(from, { text: `❌ Erro ao enviar o sticker: ${sendErr.message}.` }, { quoted: message });
    }
  } catch (error) {
    logger.error(`StickerCommand Erro ao processar sticker: ${error.message}`, {
      error: error.stack,
    });
    await sock.sendMessage(from, { text: `❌ Erro na criação do sticker: ${error.message}.` }, { quoted: message });
  } finally {
    const filesToClean = [tempMediaPath, processingMediaPath, stickerPath].filter(Boolean);
    for (const file of filesToClean) {
      await fs.unlink(file).catch((err) => logger.warn(`StickerCommand Falha ao limpar arquivo temporário ${file}: ${err.message}`));
    }
  }
}

module.exports = {
  processSticker,
};
