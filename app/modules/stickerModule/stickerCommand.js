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

/**
 * Extrai detalhes da mídia da mensagem
 * @param {object} message - O objeto da mensagem
 * @returns {{mediaType: string, mediaKey: object, isQuoted?: boolean}|null} - Detalhes da mídia ou null se não encontrada
 */
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

  if (!media)
    logger.debug(
      '[StickerCommand.extractMediaDetails] Nenhuma mídia encontrada na mensagem ou citada.',
    );

  return media;
}

function checkMediaSize(mediaKey, mediaType, maxFileSize = MAX_FILE_SIZE) {
  const fileLength = mediaKey?.fileLength || 0;

  const formatBytes = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

  logger.debug(
    `[StickerCommand.checkMediaSize] Verificando tamanho da mídia. Tipo: ${mediaType}, Tamanho: ${formatBytes(
      fileLength,
    )}`,
  );

  if (fileLength > maxFileSize) {
    logger.warn(
      `[StickerCommand.checkMediaSize] Mídia muito grande. Tipo: ${mediaType}, Tamanho: ${formatBytes(
        fileLength,
      )}`,
    );
    return false;
  }

  return true;
}

/**
 * Obtém informações do pacote de sticker
 * @param {string} text - Texto do comando (pode conter nome do pacote e autor)
 * @param {string} sender - ID do remetente
 * @param {string} pushName - Nome do usuário
 * @param {object} message - Objeto da mensagem completo
 * @returns {Promise<{packName: string, packAuthor: string}>} - Informações do pacote
 */
async function getStickerPackInfo(text, sender, pushName, message) {
  logger.debug(`[StickerCommand] Obtendo informações do pacote. Texto: "${text}"`);

  let userId = sender;

  if (sender.endsWith(' @g.us') && message?.key?.participant) {
    userId = message.key.participant;
    logger.debug(
      `[StickerCommand] Mensagem de grupo detectada. Usando ID do participante: ${userId} em vez do ID do grupo: ${sender}`,
    );
  }

  const formattedSender = userId.split('@')[0] || 'unknown';
  const userPrefsDir = path.join(STICKER_PREFS_DIR, formattedSender);
  const prefsPath = path.join(userPrefsDir, 'prefs.json');

  let defaultPackName = ` OmniZap`;
  let defaultPackAuthor = ` ${pushName || formattedSender}`;

  let savedPrefs = null;
  try {
    const prefsExists = await fs
      .access(prefsPath)
      .then(() => true)
      .catch(() => false);
    if (prefsExists) {
      const prefsData = await fs.readFile(prefsPath, 'utf-8');
      savedPrefs = JSON.parse(prefsData);
      logger.debug(`[StickerCommand] Preferências carregadas para ${formattedSender}`);
    }
  } catch (error) {
    logger.warn(`[StickerCommand] Erro ao carregar preferências: ${error.message}`);
  }

  if (savedPrefs) {
    defaultPackName = savedPrefs.packName || defaultPackName;
    defaultPackAuthor = savedPrefs.packAuthor || defaultPackAuthor;
  }

  let packName = defaultPackName;
  let packAuthor = defaultPackAuthor;

  if (text && text.trim()) {
    logger.debug(`[StickerCommand] Processando texto para pacote: "${text}"`, {
      textOriginal: text,
      textTrimmed: text.trim(),
      containsPipe: text.includes('|'),
    });

    const parts = text
      .trim()
      .split('|')
      .map((part) => part.trim());

    logger.debug(`[StickerCommand] Partes extraídas do texto:`, {
      partsCount: parts.length,
      parts: parts,
    });

    if (parts.length >= 1 && parts[0]) {
      packName = parts[0];
      logger.debug(
        `[StickerCommand] Definindo nome do pacote: "${packName}" (texto original: "${text}")`,
      );
    }

    if (parts.length >= 2 && parts[1]) {
      packAuthor = parts[1];
      logger.debug(`[StickerCommand] Definindo autor do pacote: "${packAuthor}"`);
    }

    try {
      await fs.writeFile(prefsPath, JSON.stringify({ packName, packAuthor }, null, 2));
      logger.info(`[StickerCommand] Novas preferências salvas para ${formattedSender}`);
    } catch (error) {
      logger.error(`[StickerCommand] Erro ao salvar preferências: ${error.message}`);
    }
  } else {
    logger.debug(
      `[StickerCommand] Usando preferências padrão: Nome: "${packName}", Autor: "${packAuthor}"`,
    );
  }

  packName = packName
    .replace(/#nome/g, pushName || 'Usuário')
    .replace(/#id/g, formattedSender)
    .replace(/#data/g, new Date().toLocaleDateString('pt-BR'));

  packAuthor = packAuthor
    .replace(/#nome/g, pushName || 'Usuário')
    .replace(/#id/g, formattedSender)
    .replace(/#data/g, new Date().toLocaleDateString('pt-BR'));

  logger.debug(`[StickerCommand] Pacote final: Nome: "${packName}", Autor: "${packAuthor}"`);
  return { packName, packAuthor };
}

/**
 * Converte a mídia para o formato webp (sticker)
 * @param {string} inputPath - Caminho do arquivo de entrada
 * @param {string} mediaType - Tipo de mídia
 * @param {string} userId - ID do usuário
 * @returns {Promise<string>} - Caminho do sticker
 */
async function convertToWebp(inputPath, mediaType, userId) {
  logger.info(`[StickerCommand] Convertendo mídia para webp. Tipo: ${mediaType}`);

  const userStickerDir = path.join(TEMP_DIR, userId);
  const outputPath = path.join(userStickerDir, `sticker_${Date.now()}.webp`);

  try {
    if (mediaType === 'sticker') {
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }

    const filtro = mediaType === 'video' ? 'fps=10,scale=512:512' : 'scale=512:512';
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -vcodec libwebp -lossless 1 -loop 0 -preset default -an -vf "${filtro}" "${outputPath}"`;

    logger.debug(`[StickerCommand] Comando ffmpeg para criação de sticker: ${ffmpegCommand}`);
    await execProm(ffmpegCommand);

    try {
      await fs.access(outputPath);

      try {
        const { stdout } = await execProm(
          `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${outputPath}"`,
        );
        const finalDimensions = stdout.trim().split(',').map(Number);
        logger.info(
          `[StickerCommand] Conversão bem-sucedida. Sticker salvo em: ${outputPath} (Dimensões finais: ${finalDimensions[0]}x${finalDimensions[1]})`,
        );
      } catch (error) {
        logger.info(
          `[StickerCommand] Conversão bem-sucedida. Sticker salvo em: ${outputPath} (Não foi possível obter dimensões finais)`,
        );
      }

      return outputPath;
    } catch (error) {
      throw new Error(`Falha ao criar o arquivo de sticker: ${error.message}`);
    }
  } catch (error) {
    logger.error(`[StickerCommand] Erro na conversão para webp: ${error.message}`, {
      label: 'StickerCommand.convertToWebp',
      error: error.stack,
    });
    throw new Error(`Erro na conversão para webp: ${error.message}`);
  }
}

/**
 * Adiciona metadados ao sticker
 * @param {string} stickerPath - Caminho do arquivo de sticker
 * @param {string} packName - Nome do pacote
 * @param {string} packAuthor - Autor do pacote
 * @param {string} userId - ID do usuário
 * @returns {Promise<string>} - Caminho do sticker com metadados
 */
async function addStickerMetadata(stickerPath, packName, packAuthor, userId) {
  logger.info(
    `[StickerCommand] Adicionando metadados ao sticker. Nome: "${packName}", Autor: "${packAuthor}"`,
  );

  try {
    const exifData = {
      'sticker-pack-id': `com.omnizap.${Date.now()}`,
      'sticker-pack-name': packName,
      'sticker-pack-publisher': packAuthor,
    };

    const userStickerDir = path.join(TEMP_DIR, userId);
    const exifPath = path.join(userStickerDir, `exif_${Date.now()}.exif`);

    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);
    const jsonBuffer = Buffer.from(JSON.stringify(exifData), 'utf8');
    const exifBuffer = Buffer.concat([exifAttr, jsonBuffer]);
    exifBuffer.writeUIntLE(jsonBuffer.length, 14, 4);

    await fs.writeFile(exifPath, exifBuffer);

    try {
      await execProm('which webpmux');
    } catch (error) {
      logger.warn('[StickerCommand] webpmux não encontrado, tentando instalar...');
      try {
        await execProm('apt-get update && apt-get install -y webp');
      } catch (installError) {
        logger.error(`[StickerCommand] Falha ao instalar webpmux: ${installError.message}`);
        throw new Error('webpmux não está instalado e não foi possível instalá-lo');
      }
    }

    const outputPath = path.join(userStickerDir, `final_${Date.now()}.webp`);
    await execProm(`webpmux -set exif "${exifPath}" "${stickerPath}" -o "${outputPath}"`);

    await fs.unlink(exifPath);

    logger.info(`[StickerCommand] Metadados adicionados com sucesso. Sticker final: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`[StickerCommand] Erro ao adicionar metadados: ${error.message}`, {
      label: 'StickerCommand.addStickerMetadata',
      error: error.stack,
    });

    return stickerPath;
  }
}

/**
 * Processa uma mídia e cria um sticker
 * @param {object} baileysClient - Cliente do Baileys
 * @param {object} message - Mensagem original
 * @param {string} sender - ID do remetente (pode ser um ID de grupo ou um ID individual)
 * @param {string} from - ID do chat onde enviar a resposta
 * @param {string} text - Texto adicional (para nome do pacote/autor)
 * @param {Object} options - Opções adicionais
 * @param {boolean} [options.preserveOriginalAspect=false] - Preservar proporção original da imagem:
 *   - Se true e a imagem for < 512px: Mantém o tamanho original sem padding
 *   - Se true e a imagem for >= 512px: Redimensiona mantendo proporção e adiciona padding
 *   - Se false: Força tamanho exato 512x512 (padrão)
 * @param {boolean} [options.removeBackground=false] - Remover fundo branco/transparente do sticker final
 * @returns {Promise<{success: boolean, message: string, stickerPath?: string}>} - Resultado do processamento
 */
async function processSticker(baileysClient, message, sender, from, text, options = {}) {
  logger.info(`[StickerCommand] Iniciando processamento de sticker para ${sender}`, {
    textParams: text ? `"${text}"` : 'sem texto',
    textLength: text ? text.length : 0,
    hasText: !!text,
    text: text,
    textType: typeof text,
    containsPipe: text ? text.includes('|') : false,
    splitResult: text ? text.split('|').map((part) => part.trim()) : [],
    isGroup: sender.endsWith(' @g.us'),
    participant: message.key?.participant,
    remoteJid: message.key?.remoteJid,
  });

  let tempMediaPath = null;
  let stickerPath = null;
  let finalStickerPath = null;

  try {
    let userId = sender;
    if (sender.endsWith(' @g.us') && message?.key?.participant) {
      userId = message.key.participant;
    }
    const formattedUser = userId.split('@')[0];

    const dirsOk = await ensureDirectories(formattedUser);
    if (!dirsOk) {
      return {
        success: false,
        message:
          '❌ Erro interno: Não foi possível criar os diretórios necessários para o processamento do sticker. Por favor, tente novamente mais tarde ou entre em contato com o suporte.',
      };
    }

    const mediaDetails = extractMediaDetails(message);
    if (!mediaDetails) {
      return {
        success: false,
        message:
          '❌ Nenhuma mídia foi encontrada. Para criar um sticker, por favor:\n\n1. Envie uma imagem ou vídeo junto com o comando, ou\n2. Responda a uma mensagem que contenha mídia usando o comando.\n\nFormatos suportados: imagem, vídeo curto, documento de imagem.',
      };
    }

    const { mediaType, mediaKey, isQuoted } = mediaDetails;

    if (!checkMediaSize(mediaKey, mediaType)) {
      return {
        success: false,
        message:
          '❌ A mídia selecionada excede o limite de tamanho de 1MB. Para reduzir o tamanho, você pode:\n\n1. Compactar a mídia antes de enviar\n2. Enviar a mídia sem a opção de alta definição (HD)\n3. Cortar a mídia ou reduzir sua resolução\n\nIsso ajudará a deixar a mídia mais leve e adequada para criação de stickers.',
      };
    }

    logger.info(`[StickerCommand] Baixando mídia do tipo ${mediaType}...`);
    const userStickerDir = path.join(TEMP_DIR, formattedUser);
    tempMediaPath = await downloadMediaMessage(mediaKey, mediaType, userStickerDir);

    if (!tempMediaPath) {
      return {
        success: false,
        message:
          '❌ Não foi possível baixar a mídia. Isso pode ocorrer devido a problemas de conexão ou porque o arquivo expirou. Por favor, tente novamente com outra mídia ou mais tarde.',
      };
    }
    stickerPath = await convertToWebp(tempMediaPath, mediaType, formattedUser);

    const { packName, packAuthor } = await getStickerPackInfo(
      text,
      sender,
      message.pushName || 'Usuário',
      message,
    );

    finalStickerPath = await addStickerMetadata(stickerPath, packName, packAuthor, formattedUser);

    return {
      success: true,
      message:
        '✅ Sticker criado com sucesso! O sticker foi adicionado ao pacote "' +
        packName +
        '" por "' +
        packAuthor +
        '". Para personalizar o nome do pacote e autor, use: "nome do pacote | nome do autor".',
      stickerPath: finalStickerPath,
    };
  } catch (error) {
    logger.error(`[StickerCommand] Erro ao processar sticker: ${error.message}`, {
      label: 'StickerCommand.processSticker',
      error: error.stack,
    });

    return {
      success: false,
      message: `❌ Ocorreu um erro durante a criação do sticker: ${error.message}. Por favor, verifique se a mídia está em um formato suportado e tente novamente.`,
    };
  } finally {
    try {
      const filesToDelete = [tempMediaPath, stickerPath].filter(
        (file) => file && file !== finalStickerPath,
      );

      for (const file of filesToDelete) {
        if (file) {
          await fs.unlink(file).catch(() => {});
        }
      }
    } catch (error) {
      logger.warn(`[StickerCommand] Erro ao limpar arquivos temporários: ${error.message}`);
    }
  }
}

module.exports = {
  processSticker,
};
