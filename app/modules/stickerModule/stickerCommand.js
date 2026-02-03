import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../utils/logger/loggerModule.js';
import { downloadMediaMessage, extractMediaDetails, getJidUser } from '../../config/baileysConfig.js';
import { addStickerMetadata } from './addStickerMetadata.js';
import { convertToWebp } from './convertToWebp.js';
import { v4 as uuidv4 } from 'uuid';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const adminJid = process.env.USER_ADMIN;

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const SUPPORTED_MEDIA_TYPES = new Set(['image', 'video', 'sticker']);

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

  try {
    const sanitizedUserId = String(userId).replace(/[^\w.-]/g, '_');

    const userStickerDir = path.join(TEMP_DIR, sanitizedUserId);

    await fs.mkdir(TEMP_DIR, { recursive: true });

    await fs.mkdir(userStickerDir, { recursive: true });

    return { success: true };
  } catch (error) {
    logger.error(`Erro ao criar diretórios para o usuário ${userId}: ${error.message}`, {
      label: 'ensureDirectories',
      userId,
      error,
    });

    return { success: false, error: 'Erro ao preparar diretório do usuário.' };
  }
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
  logger.debug(`checkMediaSize Verificando tamanho da mídia (${mediaType}): ${formatBytes(fileLength)}`);
  if (fileLength > maxFileSize) {
    logger.warn(`checkMediaSize Mídia (${mediaType}) muito grande: ${formatBytes(fileLength)}`);
    return false;
  }
  return true;
}

/**
 * Faz o parsing do texto recebido para packName e packAuthor.
 * Se o texto contiver '/', separa em dois: packName/packAuthor.
 * Caso contrário, usa o texto como packName e o senderName como autor.
 * @param {string} text
 * @param {string} senderName
 * @returns {{ packName: string, packAuthor: string }}
 */
function parseStickerMetaText(text, senderName) {
  let packName = 'OmniZap System';
  let packAuthor = senderName || 'OmniZap System';
  if (text) {
    const idx = text.indexOf('/');
    if (idx !== -1) {
      const name = text.slice(0, idx).trim();
      const author = text.slice(idx + 1).trim();
      if (name) packName = name;
      if (author) packAuthor = author;
    } else if (text.trim()) {
      packName = text.trim();
    }
  }
  return { packName, packAuthor };
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
export async function processSticker(
  sock,
  messageInfo,
  senderJid,
  remoteJid,
  expirationMessage,
  senderName,
  extraText = '',
) {
  const uniqueId = uuidv4();

  let tempMediaPath = null;
  let processingMediaPath = null;
  let stickerPath = null;
  let convertedPath = null;

  try {
    const message = messageInfo;
    const from = remoteJid;
    const sender = senderJid;
    const userId = getJidUser(sender);
    const sanitizedUserId = (userId || 'anon').replace(/[^a-zA-Z0-9.-]/g, '_');

    const dirResult = await ensureDirectories(sanitizedUserId);
    if (!dirResult.success) {
      logger.error(`processSticker Erro ao garantir diretórios: ${dirResult.error}`);
      await sendAndStore(sock, adminJid, {
        text: `❌ Erro ao preparar diretórios do usuário: ${dirResult.error}`,
      });
      return;
    }

    const mediaDetails = extractMediaDetails(message);
    if (!mediaDetails) {
      await sendAndStore(sock, senderJid, { react: { text: '❓', key: messageInfo.key } });
      await sendAndStore(
        sock,
        from,
        {
          text:
            `Olá ${senderName} \n\n*❌ Não foi possível processar sua solicitação.*\n\n` +
            '> Você não enviou nem marcou nenhuma mídia.\n\n' +
            '📌 Por favor, envie ou marque um arquivo de mídia com *tamanho máximo de 2 MB*.\n\n' +
            '> _*💡 Dica: desative o modo HD antes de enviar para reduzir o tamanho do arquivo e evitar falhas.*_',
        },
        { quoted: message, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const { mediaType, mediaKey } = mediaDetails;
    if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
      await sendAndStore(sock, senderJid, { react: { text: '❓', key: messageInfo.key } });
      await sendAndStore(
        sock,
        from,
        {
          text:
            '*❌ Tipo de mídia não suportado para criar sticker.*' +
            '\n\n- Tipos aceitos: *imagem, vídeo ou figurinha*.' +
            '\n\n- 📌 Envie a mídia novamente em um desses formatos.',
        },
        { quoted: message, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    if (!checkMediaSize(mediaKey, mediaType)) {
      await sendAndStore(sock, senderJid, { react: { text: '❓', key: messageInfo.key } });
      const fileLength = mediaKey?.fileLength || 0;
      const formatBytes = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';
      const enviado = formatBytes(fileLength);
      const limite = formatBytes(MAX_FILE_SIZE);
      let sugestaoTempo = '';
      if (mediaType === 'video' && mediaKey.seconds && fileLength && fileLength > 0) {
        const taxaBytesPorSegundo = fileLength / mediaKey.seconds;
        const maxSegundos = Math.floor(MAX_FILE_SIZE / taxaBytesPorSegundo);
        sugestaoTempo = `\n\n_*💡 Dica: Para este vídeo, tente cortar para até ${maxSegundos} segundos com a mesma qualidade.*_`;
      }
      await sendAndStore(
        sock,
        from,
        {
          text:
            '*❌ Não foi possível processar a mídia.*' +
            `\n\n- O arquivo enviado tem *${enviado}* e o limite permitido é de *${limite}*.` +
            '\n\n- 📌 Por favor, envie um arquivo menor ou reduza a qualidade antes de reenviar.' +
            sugestaoTempo,
        },
        { quoted: message, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const userStickerDir = path.join(TEMP_DIR, sanitizedUserId);
    tempMediaPath = await downloadMediaMessage(mediaKey, mediaType, userStickerDir);
    if (!tempMediaPath) {
      const msgErro =
        '*❌ Não foi possível baixar a mídia enviada.*\n\n- Isso pode ocorrer por instabilidade na rede, mídia expirada ou formato não suportado.\n- Por favor, tente reenviar a mídia ou envie outro arquivo.';
      await sendAndStore(sock, from, { text: msgErro }, { quoted: message, ephemeralExpiration: expirationMessage });
      if (adminJid) {
        await sendAndStore(sock, adminJid, {
          text: `🚨 Falha no download da mídia para sticker.\nUsuário: ${senderJid}\nChat: ${remoteJid}\nTipo: ${mediaType}\nMensagem: ${JSON.stringify(messageInfo)}\n`,
        });
      }
      return;
    }

    const mediaExtension = path.extname(tempMediaPath);
    processingMediaPath = path.join(userStickerDir, `media_${uniqueId}${mediaExtension}`);
    await fs.rename(tempMediaPath, processingMediaPath);
    logger.info(`processSticker Mídia original renomeada para: ${processingMediaPath}`);
    tempMediaPath = null;

    convertedPath = await convertToWebp(processingMediaPath, mediaType, sanitizedUserId, uniqueId);

    const { packName, packAuthor } = parseStickerMetaText(extraText, senderName);
    stickerPath = await addStickerMetadata(convertedPath, packName, packAuthor, {
      senderName,
      userId,
    });
    let stickerBuffer = null;
    try {
      stickerBuffer = await fs.readFile(stickerPath);
    } catch (bufferErr) {
      logger.error(`processSticker Erro ao ler buffer do sticker: ${bufferErr.message}`);
      const msgErro =
        '*❌ Não foi possível finalizar o sticker.*\n\n- Ocorreu um erro ao acessar o arquivo temporário do sticker.\n- Tente reenviar a mídia ou envie outro arquivo.';
      await sendAndStore(sock, from, { text: msgErro }, { quoted: message, ephemeralExpiration: expirationMessage });
      if (adminJid) {
        await sendAndStore(sock, adminJid, {
          text: `🚨 Erro ao ler buffer do sticker.\nUsuário: ${senderJid}\nChat: ${remoteJid}\nErro: ${bufferErr.message}\nMensagem: ${JSON.stringify(messageInfo)}\n`,
        });
      }
      return;
    }

    try {
      await sendAndStore(
        sock,
        from,
        { sticker: stickerBuffer },
        { quoted: message, ephemeralExpiration: expirationMessage },
      );
    } catch (sendErr) {
      logger.error(`processSticker Erro ao enviar o sticker: ${sendErr.message}`);
      const msgErro =
        '*❌ Não foi possível enviar o sticker ao chat.*\n\n- Ocorreu um erro inesperado ao tentar enviar o arquivo.\n- Tente novamente ou envie outra mídia.';
      await sendAndStore(sock, from, { text: msgErro }, { quoted: message, ephemeralExpiration: expirationMessage });
      if (adminJid) {
        await sendAndStore(sock, adminJid, {
          text: `🚨 Erro ao enviar sticker.\nUsuário: ${senderJid}\nChat: ${remoteJid}\nErro: ${sendErr.message}\nMensagem: ${JSON.stringify(messageInfo)}\n`,
        });
      }
    }
  } catch (error) {
    logger.error(`processSticker Erro ao processar sticker: ${error.message}`, {
      error: error.stack,
    });
    const msgErro =
      '*❌ Não foi possível criar o sticker.*\n\n- Ocorreu um erro inesperado durante o processamento.\n- Tente novamente ou envie outra mídia.';
    await sendAndStore(
      sock,
      remoteJid,
      { text: msgErro },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    if (adminJid) {
      await sendAndStore(sock, adminJid, {
        text: `🚨 Erro fatal ao processar sticker.\nUsuário: ${senderJid}\nChat: ${remoteJid}\nErro: ${error.message}\nStack: ${error.stack}\nMensagem: ${JSON.stringify(messageInfo)}\n`,
      });
    }
  } finally {
    const filesToClean = [tempMediaPath, processingMediaPath, stickerPath, convertedPath].filter(Boolean);
    for (const file of filesToClean) {
      await fs
        .unlink(file)
        .catch((err) => logger.warn(`processSticker Falha ao limpar arquivo temporário ${file}: ${err.message}`));
    }
  }
}
