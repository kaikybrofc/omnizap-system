import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../utils/logger/loggerModule.js';
import { downloadMediaMessage, extractMediaDetails, getJidUser } from '../../config/baileysConfig.js';
import { addStickerMetadata } from './addStickerMetadata.js';
import { convertToWebp } from './convertToWebp.js';
import { v4 as uuidv4 } from 'uuid';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { addStickerToAutoPack } from '../stickerPackModule/autoPackCollectorRuntime.js';

const adminJid = process.env.USER_ADMIN;

const TEMP_DIR = path.join(process.cwd(), 'temp', 'stickers');
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
const SUPPORTED_MEDIA_TYPES = new Set(['image', 'video', 'sticker']);
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const AUTO_PACK_NOTICE_ENABLED = process.env.STICKER_PACK_AUTO_COLLECT_NOTIFY !== 'false';
const AUTO_PACK_MAX_ITEMS = Math.max(1, Number(process.env.STICKER_PACK_MAX_ITEMS) || 30);

/**
 * Resultado da criação/verificação de diretórios temporários do usuário.
 * @typedef {Object} EnsureDirectoriesResult
 * @property {boolean} success - Indica se o diretório está pronto para uso.
 * @property {string} [error] - Mensagem amigável em caso de falha.
 */

/**
 * Metadados normalizados para o pacote de stickers.
 * @typedef {Object} StickerMetadata
 * @property {string} packName - Nome final do pacote.
 * @property {string} packAuthor - Autor final do pacote.
 */

/**
 * Opções de processamento para geração de sticker.
 * @typedef {Object} ProcessStickerOptions
 * @property {boolean} [includeQuotedMedia=true] - Se deve permitir mídia de mensagem citada.
 * @property {boolean} [showAutoPackNotice=true] - Se deve avisar no chat sobre a coleta automática no pack.
 * @property {string} [commandPrefix='/'] - Prefixo para mensagens de ajuda/comando.
 */

/**
 * Verifica se o tipo de mídia é suportado para conversão em sticker.
 *
 * @param {string} mediaType - Tipo normalizado retornado pelo Baileys.
 * @returns {boolean} `true` quando o tipo pode ser convertido em sticker.
 */
export function isSupportedStickerMediaType(mediaType) {
  return SUPPORTED_MEDIA_TYPES.has(mediaType);
}

/**
 * Extrai uma mídia válida para sticker, com suporte opcional a mensagem citada.
 *
 * @param {import('@whiskeysockets/baileys').WAMessage} messageInfo - Mensagem recebida.
 * @param {{ includeQuoted?: boolean }} [options={}] - Opções de extração.
 * @returns {{ mediaType: string, mediaKey: object, isQuoted?: boolean, details?: object }|null}
 */
export function extractSupportedStickerMediaDetails(messageInfo, options = {}) {
  const mediaDetails = extractMediaDetails(messageInfo, options);
  if (!mediaDetails || !isSupportedStickerMediaType(mediaDetails.mediaType)) {
    return null;
  }
  return mediaDetails;
}

/**
 * Garante que o diretório temporário do usuário para stickers existe.
 *
 * @param {string} userId - Identificador do usuário usado no diretório temporário.
 * @returns {Promise<EnsureDirectoriesResult>} Status da preparação do diretório.
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
 * @param {{ fileLength?: number }} mediaKey - Estrutura de mídia retornada pelo Baileys.
 * @param {string} mediaType - Tipo normalizado da mídia (ex.: image, video, sticker).
 * @param {number} [maxFileSize=MAX_FILE_SIZE] - Tamanho máximo permitido em bytes.
 * @returns {boolean} `true` quando o tamanho está dentro do limite; caso contrário `false`.
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
 *
 * @param {string} text - Texto extra recebido com o comando.
 * @param {string} senderName - Nome exibido do remetente.
 * @returns {StickerMetadata} Objeto pronto para uso em `addStickerMetadata`.
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

function buildAutoPackNoticeText(result, commandPrefix = DEFAULT_COMMAND_PREFIX) {
  if (!result || result.status === 'skipped') {
    return null;
  }

  const pack = result.pack || {};
  const packName = pack.name || 'Minhas Figurinhas';
  const packIdentifier = pack.pack_key || pack.id || '<pack>';
  const itemCount = Array.isArray(pack.items) ? pack.items.length : Number(pack.sticker_count || 0);
  const countLabel = itemCount > 0 ? ` (${itemCount}/${AUTO_PACK_MAX_ITEMS})` : '';

  if (result.status === 'duplicate') {
    return [
      `ℹ️ Essa figurinha já estava no pack automático *${packName}*.`,
      `Use *${commandPrefix}pack info ${packIdentifier}* para ver o pack ou *${commandPrefix}pack send ${packIdentifier}* para enviar.`,
    ].join('\n');
  }

  return [
    `📦 Figurinha salva automaticamente no pack *${packName}*${countLabel}.`,
    `Dica: use *${commandPrefix}pack list* para gerenciar seus packs.`,
    `Para enviar agora: *${commandPrefix}pack send ${packIdentifier}*.`,
  ].join('\n');
}

async function notifyAutoPackCollection({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  result,
  commandPrefix,
}) {
  if (!AUTO_PACK_NOTICE_ENABLED) return;

  const noticeText = buildAutoPackNoticeText(result, commandPrefix);
  if (!noticeText) return;

  await sendAndStore(
    sock,
    remoteJid,
    { text: noticeText },
    {
      quoted: messageInfo,
      ephemeralExpiration: expirationMessage,
    },
  );
}

/**
 * Processa uma mensagem para criar e enviar um sticker com metadados customizados.
 *
 * Fluxo: valida mídia/limite, baixa arquivo, converte para WEBP, aplica EXIF e envia ao chat.
 * Erros de processamento geram resposta amigável para o usuário e alerta opcional para admin.
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Socket ativo do Baileys.
 * @param {import('@whiskeysockets/baileys').WAMessage} messageInfo - Mensagem de comando recebida.
 * @param {string} senderJid - JID do remetente.
 * @param {string} remoteJid - JID do chat onde a resposta será enviada.
 * @param {number} expirationMessage - Tempo de expiração (segundos) para mensagens efêmeras.
 * @param {string} senderName - Nome do remetente exibido no chat.
 * @param {string} [extraText=''] - Texto opcional no formato `pack/author` para metadados.
 * @param {ProcessStickerOptions} [options={}] - Comportamento avançado do fluxo.
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
  options = {},
) {
  const {
    includeQuotedMedia = true,
    showAutoPackNotice = true,
    commandPrefix = DEFAULT_COMMAND_PREFIX,
  } = options;
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

    const mediaDetails = extractMediaDetails(message, { includeQuoted: includeQuotedMedia });
    if (!mediaDetails) {
      const maxSizeLabel = `${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)} MB`;
      await sendAndStore(sock, senderJid, { react: { text: '❓', key: messageInfo.key } });
      await sendAndStore(
        sock,
        from,
        {
          text:
            `Olá ${senderName} \n\n*❌ Não foi possível processar sua solicitação.*\n\n` +
            '> Você não enviou nem marcou nenhuma mídia.\n\n' +
            `📌 Por favor, envie ou marque um arquivo de mídia com *tamanho máximo de ${maxSizeLabel}*.\n\n` +
            '> _*💡 Dica: desative o modo HD antes de enviar para reduzir o tamanho do arquivo e evitar falhas.*_',
        },
        { quoted: message, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const { mediaType, mediaKey } = mediaDetails;
    if (!isSupportedStickerMediaType(mediaType)) {
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

      // Coleta automática: toda figurinha gerada pelo usuário é adicionada ao pack dele.
      setImmediate(() => {
        addStickerToAutoPack({
          ownerJid: senderJid,
          senderName,
          stickerBuffer,
        })
          .then(async (collectResult) => {
            if (!showAutoPackNotice) return;

            await notifyAutoPackCollection({
              sock,
              remoteJid: from,
              messageInfo: message,
              expirationMessage,
              result: collectResult,
              commandPrefix,
            });
          })
          .catch((collectError) => {
            logger.warn('Falha ao coletar figurinha automática no pack do usuário.', {
              action: 'sticker_pack_auto_collect_failed',
              owner_jid: senderJid,
              error: collectError.message,
            });
          });
      });
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
