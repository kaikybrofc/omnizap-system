const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const { exec } = require('child_process');
const execProm = util.promisify(exec);
const logger = require('../../utils/logger/loggerModule');
const { downloadMediaMessage } = require('../../utils/mediaDownloader/mediaDownloaderModule');

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');
const STICKER_PREFS_DIR = path.join(process.cwd(), 'temp', 'prefs');
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

async function ensureDirectories(userId) {
  if (!userId) {
    logger.error('[StickerCommand.ensureDirectories] User ID is required but was not provided.');
    return false;
  }
  try {
    const userStickerDir = path.join(TEMP_DIR, userId);
    const userPrefsDir = path.join(STICKER_PREFS_DIR, userId);

    await fs.mkdir(userStickerDir, { recursive: true });
    await fs.mkdir(userPrefsDir, { recursive: true });
    return true;
  } catch (error) {
    logger.error(
      `[StickerCommand.ensureDirectories] Erro ao criar diretórios para o usuário ${userId}: ${error.message}`,
      {
        label: 'StickerCommand.ensureDirectories',
        userId: userId,
        error: error.stack,
      },
    );
    return false;
  }
}

function extractMediaDetails(message) {
  logger.debug('[StickerCommand.extractMediaDetails] Extraindo detalhes da mídia');
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
  if (!media) logger.debug('[StickerCommand.extractMediaDetails] Nenhuma mídia encontrada.');
  return media;
}

function checkMediaSize(mediaKey, mediaType, maxFileSize = MAX_FILE_SIZE) {
  const fileLength = mediaKey?.fileLength || 0;
  const formatBytes = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  logger.debug(`[StickerCommand.checkMediaSize] Verificando tamanho: ${formatBytes(fileLength)}`);
  if (fileLength > maxFileSize) {
    logger.warn(`[StickerCommand.checkMediaSize] Mídia muito grande: ${formatBytes(fileLength)}`);
    return false;
  }
  return true;
}

async function loadUserPrefs(userId, pushName) {
  const prefsPath = path.join(STICKER_PREFS_DIR, userId, 'prefs.json');
  const defaultPrefs = {
    packName: `OmniZap`,
    packAuthor: `${pushName || userId}`,
    stickerCount: 0,
    stickers: [],
  };

  try {
    const prefsData = await fs.readFile(prefsPath, 'utf-8');
    const savedPrefs = JSON.parse(prefsData);
    return { ...defaultPrefs, ...savedPrefs };
  } catch (error) {
    logger.warn(`[StickerCommand.loadUserPrefs] Erro ao carregar prefs para ${userId}. Usando padrões.`);
    return defaultPrefs;
  }
}

async function saveUserPrefs(userId, prefs) {
  const prefsPath = path.join(STICKER_PREFS_DIR, userId, 'prefs.json');
  try {
    await fs.writeFile(prefsPath, JSON.stringify(prefs, null, 2));
    logger.info(`[StickerCommand.saveUserPrefs] Preferências salvas para ${userId}.`);
  } catch (error) {
    logger.error(`[StickerCommand.saveUserPrefs] Erro ao salvar preferências para ${userId}: ${error.message}`);
  }
}

async function convertToWebp(inputPath, mediaType, userId, stickerNumber) {
  logger.info(`[StickerCommand] Convertendo mídia #${stickerNumber} para webp. Tipo: ${mediaType}`);
  const userStickerDir = path.join(TEMP_DIR, userId);
  const outputPath = path.join(userStickerDir, `sticker_${stickerNumber}.webp`);

  try {
    if (mediaType === 'sticker') {
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }
    const filtro = mediaType === 'video' ? 'fps=10,scale=512:512' : 'scale=512:512';
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -vcodec libwebp -lossless 1 -loop 0 -preset default -an -vf "${filtro}" "${outputPath}"`;
    await execProm(ffmpegCommand);
    await fs.access(outputPath);
    logger.info(`[StickerCommand] Conversão bem-sucedida para: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`[StickerCommand.convertToWebp] Erro na conversão: ${error.message}`, { error: error.stack });
    throw new Error(`Erro na conversão para webp: ${error.message}`);
  }
}

async function addStickerMetadata(stickerPath, packName, packAuthor, userId, stickerNumber) {
  logger.info(`[StickerCommand] Adicionando metadados ao sticker #${stickerNumber}`);
  const userStickerDir = path.join(TEMP_DIR, userId);
  const outputPath = path.join(userStickerDir, `final_sticker_${stickerNumber}.webp`);
  const exifPath = path.join(userStickerDir, `exif_${stickerNumber}.exif`);

  try {
    const exifData = {
      'sticker-pack-id': `com.omnizap.${userId}.${Date.now()}`,
      'sticker-pack-name': packName,
      'sticker-pack-publisher': packAuthor,
    };
    const exifAttr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(exifData), 'utf8');
    const exifBuffer = Buffer.concat([exifAttr, jsonBuffer]);
    exifBuffer.writeUIntLE(jsonBuffer.length, 14, 4);
    await fs.writeFile(exifPath, exifBuffer);

    await execProm(`webpmux -set exif "${exifPath}" "${stickerPath}" -o "${outputPath}"`);
    logger.info(`[StickerCommand] Metadados adicionados. Sticker final: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`[StickerCommand.addStickerMetadata] Erro ao adicionar metadados: ${error.message}`, { error: error.stack });
    try {
      await execProm('which webpmux');
    } catch (checkError) {
      logger.warn('[StickerCommand] webpmux não encontrado. Tentando instalar...');
      try {
        await execProm('apt-get update && apt-get install -y webp');
        logger.info('[StickerCommand] webpmux instalado com sucesso.');
        return addStickerMetadata(stickerPath, packName, packAuthor, userId, stickerNumber); // Tenta novamente
      } catch (installError) {
        logger.error(`[StickerCommand] Falha ao instalar webpmux: ${installError.message}`);
        throw new Error('webpmux não está instalado e a instalação automática falhou.');
      }
    }
    return stickerPath; // Retorna o sticker sem metadados se webpmux falhar
  } finally {
    await fs.unlink(exifPath).catch(err => logger.warn(`Falha ao limpar arquivo exif: ${err.message}`));
  }
}

async function processSticker(baileysClient, message, sender, from, text, options = {}) {
  logger.info(`[StickerCommand] Iniciando processamento de sticker para ${sender}`);
  let tempMediaPath = null, numberedMediaPath = null, stickerPath = null, finalStickerPath = null;

  try {
    let userId = sender.endsWith(' @g.us') && message?.key?.participant ? message.key.participant : sender;
    const formattedUser = userId.split('@')[0];

    await ensureDirectories(formattedUser);

    const mediaDetails = extractMediaDetails(message);
    if (!mediaDetails) return { success: false, message: '❌ Nenhuma mídia encontrada.' };

    const { mediaType, mediaKey } = mediaDetails;
    if (!checkMediaSize(mediaKey, mediaType)) return { success: false, message: '❌ Mídia > 2MB.' };

    let prefs = await loadUserPrefs(formattedUser, message.pushName);
    const stickerNumber = (prefs.stickerCount || 0) + 1;

    if (text && text.trim()) {
      const parts = text.trim().split('|').map(part => part.trim());
      if (parts[0]) prefs.packName = parts[0];
      if (parts[1]) prefs.packAuthor = parts[1];
    }

    const userStickerDir = path.join(TEMP_DIR, formattedUser);
    tempMediaPath = await downloadMediaMessage(mediaKey, mediaType, userStickerDir);
    if (!tempMediaPath) return { success: false, message: '❌ Falha no download da mídia.' };

    const mediaExtension = path.extname(tempMediaPath);
    numberedMediaPath = path.join(userStickerDir, `media_${stickerNumber}${mediaExtension}`);
    await fs.rename(tempMediaPath, numberedMediaPath);
    logger.info(`[StickerCommand] Mídia original renomeada para: ${numberedMediaPath}`);

    stickerPath = await convertToWebp(numberedMediaPath, mediaType, formattedUser, stickerNumber);

    const finalPackName = prefs.packName.replace(/#nome/g, message.pushName || 'Usuário').replace(/#id/g, formattedUser).replace(/#data/g, new Date().toLocaleDateString('pt-BR'));
    const finalPackAuthor = prefs.packAuthor.replace(/#nome/g, message.pushName || 'Usuário').replace(/#id/g, formattedUser).replace(/#data/g, new Date().toLocaleDateString('pt-BR'));

    finalStickerPath = await addStickerMetadata(stickerPath, finalPackName, finalPackAuthor, formattedUser, stickerNumber);

    prefs.stickerCount = stickerNumber;
    if (!Array.isArray(prefs.stickers)) prefs.stickers = [];
    prefs.stickers.push({
      id: stickerNumber,
      createdAt: new Date().toISOString(),
      mediaType: mediaType,
      originalMediaPath: numberedMediaPath,
      stickerPath: finalStickerPath,
    });
    await saveUserPrefs(formattedUser, prefs);

    return { success: true, message: `✅ Sticker #${stickerNumber} criado!`, stickerPath: finalStickerPath };

  } catch (error) {
    logger.error(`[StickerCommand] Erro ao processar sticker: ${error.message}`, { error: error.stack });
    return { success: false, message: `❌ Erro na criação do sticker: ${error.message}.` };

  } finally {
    const filesToClean = [tempMediaPath, numberedMediaPath, stickerPath].filter(f => f && f !== finalStickerPath);
    for (const file of filesToClean) {
      await fs.unlink(file).catch(err => logger.warn(`[StickerCommand] Falha ao limpar arquivo temporário ${file}: ${err.message}`));
    }
  }
}

module.exports = {
  processSticker,
};
