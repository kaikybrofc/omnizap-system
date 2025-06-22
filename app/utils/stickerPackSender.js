/**
 * OmniZap Sticker Pack Sender
 *
 * Módulo responsável pelo envio individual de stickers de um pack
 * usando método padrão do Baileys
 *
 * @version 3.0.0
 * @author OmniZap Team
 * @license MIT
 */

const fs = require('fs').promises;
const logger = require('../utils/logger/loggerModule');
const { STICKER_CONSTANTS, EMOJIS, RATE_LIMIT_CONFIG } = require('../utils/constants');
const { sendStickerMessage, sendTextMessage, formatSuccessMessage } = require('../utils/messageUtils');

/**
 * Envia um pack de stickers individualmente
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {string} targetJid - JID de destino
 * @param {Object} pack - Pack de stickers
 * @param {Object} messageInfo - Informações da mensagem original
 * @returns {Promise<boolean>} Sucesso do envio
 */
async function sendStickerPackIndividually(omniZapClient, targetJid, pack, messageInfo = null) {
  try {
    logger.info(`[StickerPackSender] Iniciando envio individual de stickers`, {
      packId: pack.packId,
      packName: pack.name,
      stickerCount: pack.stickers.length,
      targetJid: targetJid,
    });

    // Validações básicas
    if (!omniZapClient || !targetJid || !pack) {
      throw new Error('Parâmetros obrigatórios não fornecidos');
    }

    if (!pack.stickers || pack.stickers.length === 0) {
      throw new Error('Pack não possui stickers');
    }

    // Prepara os stickers válidos
    const validStickers = [];
    for (const sticker of pack.stickers) {
      try {
        // Verifica se o arquivo existe
        await fs.access(sticker.filePath);
        validStickers.push(sticker);
      } catch (error) {
        logger.warn(`[StickerPackSender] Sticker inválido ignorado: ${sticker.fileName}`);
      }
    }

    if (validStickers.length === 0) {
      throw new Error('Nenhum sticker válido encontrado no pack');
    }

    // Envia mensagem introdutória
    const introMessage = `${EMOJIS.PACK} *${pack.name}*\n👤 Por: ${pack.author}\n🎯 ${validStickers.length} stickers\n\n✨ *Enviando stickers...*`;

    await sendTextMessage(omniZapClient, targetJid, introMessage, {
      originalMessage: messageInfo,
    });

    // Envia stickers individualmente
    await sendStickersIndividually(omniZapClient, targetJid, validStickers, pack, messageInfo);

    logger.info(`[StickerPackSender] Pack enviado com sucesso`);
    return true;
  } catch (error) {
    logger.error(`[StickerPackSender] Erro no envio do pack: ${error.message}`, {
      error: error.stack,
      packId: pack?.packId,
      targetJid: targetJid,
    });
    throw error;
  }
}

/**
 * Envia stickers individualmente usando sendStickerMessage
 */
async function sendStickersIndividually(omniZapClient, targetJid, validStickers, pack, messageInfo) {
  const { BATCH_SIZE, DELAY_BETWEEN_STICKERS, DELAY_BETWEEN_BATCHES } = RATE_LIMIT_CONFIG;

  let sentCount = 0;

  logger.info(`[StickerPackSender] Enviando ${validStickers.length} stickers individualmente`);

  for (let i = 0; i < validStickers.length; i += BATCH_SIZE) {
    const batch = validStickers.slice(i, i + BATCH_SIZE);

    logger.debug(`[StickerPackSender] Enviando lote ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validStickers.length / BATCH_SIZE)}`);

    for (const sticker of batch) {
      try {
        // Verifica se o sticker ainda existe
        await fs.access(sticker.filePath);

        // Envia o sticker usando sendStickerMessage
        await sendStickerMessage(omniZapClient, targetJid, sticker.filePath, {
          originalMessage: messageInfo,
          packname: pack.name,
          author: pack.author,
        });

        sentCount++;
        logger.debug(`[StickerPackSender] Sticker enviado: ${sticker.fileName} (${sentCount}/${validStickers.length})`);

        // Delay entre stickers
        if (sentCount < validStickers.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_STICKERS));
        }
      } catch (stickerError) {
        logger.warn(`[StickerPackSender] Falha no envio do sticker ${sticker.fileName}: ${stickerError.message}`);
      }
    }

    // Delay entre lotes
    if (i + BATCH_SIZE < validStickers.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  // Mensagem final de conclusão
  const successMessage = formatSuccessMessage('Pack enviado com sucesso!', `${EMOJIS.PACK} **${pack.name}**\n📨 ${sentCount}/${validStickers.length} stickers entregues`, 'Adicione os stickers aos seus favoritos para acesso rápido!');

  await sendTextMessage(omniZapClient, targetJid, successMessage, {
    originalMessage: messageInfo,
  });

  logger.info(`[StickerPackSender] Envio individual concluído`, {
    packName: pack.name,
    totalStickers: validStickers.length,
    sentStickers: sentCount,
    successRate: `${((sentCount / validStickers.length) * 100).toFixed(1)}%`,
  });
}

module.exports = {
  sendStickerPackIndividually,
};
