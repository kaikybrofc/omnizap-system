/**
 * Módulo responsável pelo processamento de stickers a partir de mídias recebidas.
 * Inclui funções para garantir diretórios temporários, extrair detalhes de mídia,
 * verificar tamanho, converter para webp e enviar stickers via WhatsApp.
 *
 * @module stickerCommand
 */
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const { exec } = require('child_process');
const execProm = util.promisify(exec);
const logger = require('../../utils/logger/loggerModule');
const { downloadMediaMessage } = require('../../utils/mediaDownloader/mediaDownloaderModule');
const adminJid = process.env.USER_ADMIN;

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');
const MAX_FILE_SIZE = 3 * 1024 * 1024;

/**
 * Garante que o diretório temporário do usuário para stickers existe.
 *
 * @param {string} userId - ID numérico do usuário (apenas dígitos).
 * @returns {Promise<{success: boolean, error?: string}>} Resultado da operação.
 */
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

/**
 * Extrai detalhes da mídia de uma mensagem, incluindo tipo e chave da mídia.
 * Suporta mensagens diretas e citadas.
 *
 * @param {object} message - Objeto da mensagem recebida.
 * @returns {{mediaType: string, mediaKey: object, isQuoted: boolean}|null} Detalhes da mídia ou null se não encontrado.
 */
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

/**
 * Verifica se o tamanho da mídia está dentro do limite permitido.
 *
 * @param {object} mediaKey - Objeto da mídia contendo fileLength.
 * @param {string} mediaType - Tipo da mídia (image, video, sticker, document).
 * @param {number} [maxFileSize=MAX_FILE_SIZE] - Tamanho máximo permitido em bytes.
 * @returns {boolean} True se o tamanho for permitido, false caso contrário.
 */
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

/**
 * Converte um arquivo de mídia para o formato webp, pronto para sticker.
 *
 * @param {string} inputPath - Caminho do arquivo de mídia de entrada.
 * @param {string} mediaType - Tipo da mídia (image, video, sticker).
 * @param {string} userId - ID do usuário.
 * @param {string} uniqueId - Identificador único para o sticker.
 * @returns {Promise<string>} Caminho do arquivo webp gerado.
 * @throws {Error} Se a conversão falhar.
 */
async function convertToWebp(inputPath, mediaType, userId, uniqueId) {
  logger.info(`StickerCommand Convertendo mídia para webp. ID: ${uniqueId}, Tipo: ${mediaType}`);
  const userStickerDir = path.join(TEMP_DIR, userId);
  const outputPath = path.join(userStickerDir, `sticker_${uniqueId}.webp`);

  try {
    // Garante que o diretório de destino existe
    await fs.mkdir(userStickerDir, { recursive: true });

    // Validação explícita do tipo de mídia
    const allowedTypes = ['image', 'video', 'sticker'];
    if (!allowedTypes.includes(mediaType)) {
      logger.error(`Tipo de mídia não suportado para conversão: ${mediaType}`);
      throw new Error(`Tipo de mídia não suportado: ${mediaType}`);
    }

    if (mediaType === 'sticker') {
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }
    const filtro = mediaType === 'video' ? 'fps=10,scale=512:512' : 'scale=512:512';
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -vcodec libwebp -lossless 1 -loop 0 -preset default -an -vf "${filtro}" "${outputPath}"`;
    let ffmpegResult;
    try {
      ffmpegResult = await execProm(ffmpegCommand);
    } catch (ffmpegErr) {
      logger.error(`Erro na execução do FFmpeg: ${ffmpegErr.message}`);
      if (ffmpegErr.stderr) {
        logger.error(`FFmpeg stderr: ${ffmpegErr.stderr}`);
      }
      throw new Error(`Falha ao converter mídia para sticker (FFmpeg): ${ffmpegErr.message}`);
    }
    if (ffmpegResult && ffmpegResult.stderr) {
      logger.debug(`FFmpeg stderr: ${ffmpegResult.stderr}`);
    }
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

/**
 * Processa uma mensagem para criar e enviar um sticker a partir de uma mídia recebida.
 *
 * @param {object} sock - Instância do socket de conexão WhatsApp.
 * @param {object} messageInfo - Objeto da mensagem recebida.
 * @param {string} senderJid - JID do remetente.
 * @param {string} remoteJid - JID do chat remoto.
 * @returns {Promise<void>}
 */
async function processSticker(sock, messageInfo, senderJid, remoteJid, expirationMessage, senderName) {
  logger.info(`StickerCommand Iniciando processamento de sticker para ${senderJid}...`);

  const { v4: uuidv4 } = require('uuid');
  const uniqueId = uuidv4();

  let tempMediaPath = null;
  let processingMediaPath = null;
  let stickerPath = null;

  try {
    const message = messageInfo;
    const from = remoteJid;
    const sender = senderJid;
    const userId = sender?.split('@')[0] ?? null;
    const formattedUser = userId;

    const dirResult = await ensureDirectories(formattedUser);
    if (!dirResult.success) {
      logger.error(`StickerCommand Erro ao garantir diretórios: ${dirResult.error}`);
      await sock.sendMessage(adminJid, { text: `❌ Erro ao preparar diretórios do usuário: ${dirResult.error}` }, { quoted: message });
      return;
    }

    const mediaDetails = extractMediaDetails(message);
    if (!mediaDetails) {
      await sock.sendMessage(
        from,
        {
          text: '*❌ Falha no processamento:* nenhuma mídia foi detectada.\n' + 'Por gentileza, envie um arquivo de mídia com *tamanho máximo de 3 MB*.\n\n' + '_*Dica útil*:_ _desativar o modo HD antes de enviar pode reduzir o tamanho do arquivo e facilitar o envio._',
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
    await sock.sendMessage(remoteJid, { text: `❌ Erro na criação do sticker: ${error.message}.` }, { quoted: messageInfo });
  } finally {
    const filesToClean = [tempMediaPath, processingMediaPath, stickerPath].filter(Boolean);
    for (const file of filesToClean) {
      //  await fs.unlink(file).catch((err) => logger.warn(`StickerCommand Falha ao limpar arquivo temporário ${file}: ${err.message}`));
    }
  }
}

/**
 * Exporta a função principal de processamento de sticker.
 * @type {{ processSticker: function }}
 */
module.exports = {
  processSticker,
};
