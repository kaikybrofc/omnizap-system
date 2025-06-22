/**
 * OmniZap Sticker Pack Sender
 *
 * Módulo responsável pelo envio de sticker packs usando relayMessage
 * e proto messages conforme implementação do Baileys
 *
 * @version 2.0.0
 * @author OmniZap Team
 * @license MIT
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { generateWAMessageFromContent, generateForwardMessageContent } = require('@whiskeysockets/baileys');
const logger = require('../utils/logger/loggerModule');
const { STICKER_CONSTANTS, EMOJIS } = require('../utils/constants');

/**
 * Envia um sticker pack usando relayMessage conforme Baileys
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {string} targetJid - JID de destino
 * @param {Object} pack - Pack de stickers
 * @param {Object} options - Opções de envio
 * @returns {Promise<boolean>} Sucesso do envio
 */
async function sendStickerPackWithRelay(omniZapClient, targetJid, pack, options = {}) {
  try {
    logger.info(`[StickerPackSender] Iniciando envio de pack usando relayMessage`, {
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
    const introMessage = `${EMOJIS.PACK} *${pack.name}*\n👤 Por: ${pack.author}\n🎯 ${validStickers.length} stickers\n\n✨ *Enviando pack...*`;

    await omniZapClient.sendMessage(targetJid, { text: introMessage });

    // Método 1: Envio usando relayMessage com proto message
    try {
      await sendPackAsProtoMessage(omniZapClient, targetJid, pack, validStickers, options);
      logger.info(`[StickerPackSender] Pack enviado com sucesso usando proto message`);
      return true;
    } catch (protoError) {
      logger.warn(`[StickerPackSender] Falha no envio via proto message: ${protoError.message}`);

      // Método 2: Fallback para envio individual
      await sendStickersIndividually(omniZapClient, targetJid, validStickers, options);
      logger.info(`[StickerPackSender] Pack enviado com sucesso usando método individual`);
      return true;
    }
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
 * Envia pack como proto message usando relayMessage conforme exemplo do Baileys
 */
async function sendPackAsProtoMessage(omniZapClient, targetJid, pack, validStickers, options = {}) {
  try {
    logger.info(`[StickerPackSender] Iniciando envio proto message para pack ${pack.name}`);

    // Cria ID único para a mensagem
    const messageId = `omnizap_pack_${pack.packId}_${Date.now()}`;

    // Opções de configuração para o pack
    const { forceForward = false, useViewOnce = false, contextInfo = {} } = options;

    // Prepara os stickers para envio individual usando relayMessage
    for (let i = 0; i < validStickers.length; i++) {
      const sticker = validStickers[i];

      try {
        // Lê o buffer do sticker
        const stickerBuffer = await fs.readFile(sticker.filePath);

        // Cria a mensagem base do sticker
        const stickerMessage = {
          stickerMessage: {
            url: sticker.filePath,
            fileSha256: crypto.createHash('sha256').update(stickerBuffer).digest(),
            fileEncSha256: crypto.createHash('sha256').update(stickerBuffer).digest(),
            mediaKey: crypto.randomBytes(32),
            mimetype: sticker.mimetype || 'image/webp',
            height: 512,
            width: 512,
            directPath: `/v/t62.15575-24/${crypto.randomBytes(16).toString('hex')}?ccb=11-4&oh=01_AdR7z&oe=65`,
            fileLength: stickerBuffer.length,
            mediaKeyTimestamp: Math.floor(Date.now() / 1000),
            firstFrameLength: stickerBuffer.length,
            isAnimated: sticker.isAnimated || false,
            pngThumbnail: stickerBuffer.slice(0, 100), // Pequena amostra como thumbnail
            contextInfo: {
              ...contextInfo,
              externalAdReply: {
                title: pack.name,
                body: `👤 ${pack.author} • Sticker ${i + 1}/${validStickers.length}`,
                thumbnailUrl: '',
                sourceUrl: '',
                mediaType: 1,
                renderLargerThumbnail: false,
              },
              quotedMessage: null,
              ...sticker.contextInfo,
            },
          },
        };

        // Gera a mensagem WAMessage usando generateWAMessageFromContent
        const waMessage = await generateWAMessageFromContent(targetJid, stickerMessage, {
          messageId: `${messageId}_${i}`,
          timestamp: Date.now(),
          userJid: omniZapClient.user?.id,
          upload: omniZapClient.waUploadToServer,
        });

        // Usa relayMessage para enviar conforme o exemplo
        await omniZapClient.relayMessage(targetJid, waMessage.message, {
          messageId: waMessage.key.id,
          participant: targetJid.endsWith('@g.us') ? undefined : targetJid,
        });

        logger.debug(`[StickerPackSender] Sticker ${i + 1}/${validStickers.length} enviado via relayMessage`);

        // Delay entre stickers para evitar rate limiting
        if (i < validStickers.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (stickerError) {
        logger.warn(`[StickerPackSender] Erro ao enviar sticker ${sticker.fileName}: ${stickerError.message}`);
        continue;
      }
    }

    // Mensagem final de conclusão
    const completionMessage = {
      extendedTextMessage: {
        text: `✅ *Pack "${pack.name}" enviado com sucesso!*\n\n📦 ${validStickers.length} stickers entregues\n👤 Por: ${pack.author}\n\n🎭 Aproveite seus novos stickers!`,
        contextInfo: {
          externalAdReply: {
            title: `Pack ${pack.name}`,
            body: `✅ Envio concluído com sucesso`,
            thumbnailUrl: '',
            sourceUrl: '',
            mediaType: 1,
            renderLargerThumbnail: true,
          },
        },
      },
    };

    const finalMessage = await generateWAMessageFromContent(targetJid, completionMessage, {
      messageId: `${messageId}_final`,
      timestamp: Date.now(),
      userJid: omniZapClient.user?.id,
    });

    await omniZapClient.relayMessage(targetJid, finalMessage.message, {
      messageId: finalMessage.key.id,
    });

    logger.info(`[StickerPackSender] Pack enviado com sucesso via relayMessage`, {
      packId: pack.packId,
      stickerCount: validStickers.length,
      targetJid: targetJid,
    });
  } catch (error) {
    logger.error(`[StickerPackSender] Erro no envio proto message: ${error.message}`, {
      error: error.stack,
      packId: pack.packId,
    });
    throw error;
  }
}

/**
 * Envia stickers individualmente como fallback melhorado
 */
async function sendStickersIndividually(omniZapClient, targetJid, validStickers, options = {}) {
  const { batchSize = 3, delayBetweenStickers = 1000, delayBetweenBatches = 2000 } = options;

  let sentCount = 0;

  logger.info(`[StickerPackSender] Enviando ${validStickers.length} stickers individualmente com relayMessage`);

  for (let i = 0; i < validStickers.length; i += batchSize) {
    const batch = validStickers.slice(i, i + batchSize);

    logger.debug(`[StickerPackSender] Enviando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(validStickers.length / batchSize)}`);

    for (const sticker of batch) {
      try {
        // Lê o buffer do sticker
        const stickerBuffer = await fs.readFile(sticker.filePath);

        // Cria mensagem de sticker usando generateWAMessageFromContent
        const stickerMessage = {
          stickerMessage: {
            url: sticker.filePath,
            fileSha256: crypto.createHash('sha256').update(stickerBuffer).digest(),
            fileEncSha256: crypto.createHash('sha256').update(stickerBuffer).digest(),
            mediaKey: crypto.randomBytes(32),
            mimetype: sticker.mimetype || 'image/webp',
            height: 512,
            width: 512,
            directPath: `/v/t62.15575-24/${crypto.randomBytes(16).toString('hex')}?ccb=11-4&oh=01_AdR7z&oe=65`,
            fileLength: stickerBuffer.length,
            mediaKeyTimestamp: Math.floor(Date.now() / 1000),
            firstFrameLength: stickerBuffer.length,
            isAnimated: sticker.isAnimated || false,
            pngThumbnail: stickerBuffer.slice(0, 100),
          },
        };

        const waMessage = await generateWAMessageFromContent(targetJid, stickerMessage, {
          messageId: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
          userJid: omniZapClient.user?.id,
          upload: omniZapClient.waUploadToServer,
        });

        // Usa relayMessage para envio otimizado
        await omniZapClient.relayMessage(targetJid, waMessage.message, {
          messageId: waMessage.key.id,
        });

        sentCount++;
        logger.debug(`[StickerPackSender] Sticker enviado via relayMessage: ${sticker.fileName} (${sentCount}/${validStickers.length})`);

        // Delay entre stickers
        if (sentCount < validStickers.length) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenStickers));
        }
      } catch (stickerError) {
        logger.warn(`[StickerPackSender] Falha no envio do sticker ${sticker.fileName}: ${stickerError.message}`);
      }
    }

    // Delay entre lotes
    if (i + batchSize < validStickers.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  // Mensagem final usando relayMessage
  const successMessage = {
    extendedTextMessage: {
      text: `✅ *Pack enviado com sucesso!*\n\n📦 **Stickers entregues:** ${sentCount}/${validStickers.length}\n\n💡 *Adicione os stickers aos seus favoritos para acesso rápido!*`,
      contextInfo: {
        externalAdReply: {
          title: 'Pack de Stickers',
          body: `${sentCount} stickers enviados com sucesso`,
          thumbnailUrl: '',
          sourceUrl: '',
          mediaType: 1,
          renderLargerThumbnail: false,
        },
      },
    },
  };

  const finalMessage = await generateWAMessageFromContent(targetJid, successMessage, {
    messageId: `pack_complete_${Date.now()}`,
    timestamp: Date.now(),
    userJid: omniZapClient.user?.id,
  });

  await omniZapClient.relayMessage(targetJid, finalMessage.message, {
    messageId: finalMessage.key.id,
  });

  logger.info(`[StickerPackSender] Envio individual concluído`, {
    totalStickers: validStickers.length,
    sentStickers: sentCount,
    successRate: `${((sentCount / validStickers.length) * 100).toFixed(1)}%`,
  });
}

/**
 * Prepara dados do pack para envio usando proto
 */
function preparePackProtoData(pack, validStickers) {
  return {
    id: pack.packId,
    name: pack.name,
    publisher: pack.author,
    trayImageFile: null, // Será implementado futuramente
    publisherEmail: '',
    publisherWebsite: '',
    privacyPolicyWebsite: '',
    licenseAgreementWebsite: '',
    stickers: validStickers.map((sticker, index) => ({
      imageFile: sticker.fileName,
      emojis: sticker.emojis || ['🎭'],
      isAnimated: sticker.isAnimated || false,
      isLottie: sticker.isLottie || false,
    })),
  };
}

/**
 * Envia pack usando copyNForward baseado no exemplo fornecido
 */
async function sendPackWithCopyNForward(omniZapClient, targetJid, packData, options = {}) {
  try {
    const { forceForward = false, readViewOnce = false } = options;

    logger.debug(`[StickerPackSender] Tentando envio com copyNForward baseado no exemplo`);

    // Simula uma mensagem de sticker pack para forward
    const mockMessage = {
      key: {
        remoteJid: targetJid,
        fromMe: true,
        id: `pack_${Date.now()}`,
      },
      message: {
        stickerPackMessage: {
          packId: packData.id,
          packName: packData.name,
          packPublisher: packData.publisher,
          stickers: packData.stickers,
          packOrigin: 'third_party',
        },
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: packData.publisher,
    };

    // Implementa a lógica do copyNForward baseada no exemplo
    let message = mockMessage;
    let vtype;

    if (readViewOnce) {
      message.message = message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message ? message.message.ephemeralMessage.message : message.message || undefined;

      if (message.message?.viewOnceMessage) {
        vtype = Object.keys(message.message.viewOnceMessage.message)[0];
        delete (message.message && message.message.ignore ? message.message.ignore : message.message || undefined);
        delete message.message.viewOnceMessage.message[vtype].viewOnce;
        message.message = {
          ...message.message.viewOnceMessage.message,
        };
      }
    }

    let mtype = Object.keys(message.message)[0];
    let content = await generateForwardMessageContent(message, forceForward);
    let ctype = Object.keys(content)[0];
    let context = {};

    if (mtype !== 'conversation') {
      context = message.message[mtype].contextInfo || {};
    }

    content[ctype].contextInfo = {
      ...context,
      ...content[ctype].contextInfo,
    };

    const waMessage = await generateWAMessageFromContent(
      targetJid,
      content,
      options
        ? {
            ...content[ctype],
            ...options,
            ...(options.contextInfo
              ? {
                  contextInfo: {
                    ...content[ctype].contextInfo,
                    ...options.contextInfo,
                  },
                }
              : {}),
          }
        : {},
    );

    await omniZapClient.relayMessage(targetJid, waMessage.message, {
      messageId: waMessage.key.id,
    });

    logger.info(`[StickerPackSender] Pack enviado via copyNForward baseado no exemplo`);
    return waMessage;
  } catch (error) {
    logger.error(`[StickerPackSender] Erro no envio via copyNForward: ${error.message}`);
    throw error;
  }
}

/**
 * Envia pack usando método experimental com relayMessage otimizado
 */
async function sendPackWithOptimizedRelay(omniZapClient, targetJid, packData, options = {}) {
  try {
    logger.debug(`[StickerPackSender] Tentando envio otimizado com relayMessage`);

    // Cria mensagem de documento com metadados do pack
    const packDocument = {
      documentMessage: {
        url: '',
        mimetype: 'application/vnd.whatsapp.sticker-pack',
        title: `${packData.name}.wastickers`,
        fileSha256: crypto.randomBytes(32),
        fileLength: JSON.stringify(packData).length,
        pageCount: packData.stickers.length,
        mediaKey: crypto.randomBytes(32),
        fileName: `${packData.name}.wastickers`,
        fileEncSha256: crypto.randomBytes(32),
        directPath: '',
        mediaKeyTimestamp: Math.floor(Date.now() / 1000),
        contactVcard: false,
        thumbnailDirectPath: '',
        thumbnailSha256: crypto.randomBytes(32),
        thumbnailEncSha256: crypto.randomBytes(32),
        jpegThumbnail: Buffer.alloc(0),
        contextInfo: {
          externalAdReply: {
            title: packData.name,
            body: `👤 ${packData.publisher} • ${packData.stickers.length} stickers`,
            thumbnailUrl: '',
            sourceUrl: '',
            mediaType: 2,
            renderLargerThumbnail: true,
          },
          ...options.contextInfo,
        },
        caption: `📦 *${packData.name}*\n👤 Por: ${packData.publisher}\n🎯 ${packData.stickers.length} stickers\n\n📥 Baixe e instale este pack de stickers!`,
      },
    };

    const waMessage = await generateWAMessageFromContent(targetJid, packDocument, {
      messageId: `pack_doc_${Date.now()}`,
      timestamp: Date.now(),
      userJid: omniZapClient.user?.id,
      ...options,
    });

    await omniZapClient.relayMessage(targetJid, waMessage.message, {
      messageId: waMessage.key.id,
    });

    logger.info(`[StickerPackSender] Pack enviado como documento via relayMessage otimizado`);
    return waMessage;
  } catch (error) {
    logger.error(`[StickerPackSender] Erro no envio otimizado: ${error.message}`);
    throw error;
  }
}

module.exports = {
  sendStickerPackWithRelay,
  sendPackAsProtoMessage,
  sendStickersIndividually,
  preparePackProtoData,
  sendPackWithCopyNForward,
  sendPackWithOptimizedRelay,
};
