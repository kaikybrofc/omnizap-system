import 'dotenv/config';

import { handleMenuCommand } from '../modules/menuModule/menus.js';
import { handleAdminCommand, isAdminCommand } from '../modules/adminModule/groupCommandHandlers.js';
import { processSticker } from '../modules/stickerModule/stickerCommand.js';
import {
  processBlinkingTextSticker,
  processTextSticker,
} from '../modules/stickerModule/stickerTextCommand.js';
import { handlePlayCommand, handlePlayVidCommand } from '../modules/playModule/playCommand.js';
import { handleRankingCommand } from '../modules/statsModule/rankingCommand.js';
import { handleGlobalRankingCommand } from '../modules/statsModule/globalRankingCommand.js';
import { handleNoMessageCommand } from '../modules/statsModule/noMessageCommand.js';
import { handleInteractionGraphCommand } from '../modules/statsModule/interactionGraphCommand.js';
import { handlePingCommand } from '../modules/systemMetricsModule/pingCommand.js';
import { getExpiration, isGroupJid, resolveBotJid } from '../config/baileysConfig.js';
import logger from '../utils/logger/loggerModule.js';
import { handleAntiLink } from '../utils/antiLink/antiLinkModule.js';
import { handleNoticeCommand } from '../modules/broadcastModule/noticeCommand.js';
import { handleCatCommand, handleCatPromptCommand } from '../modules/aiModule/catCommand.js';
import { handleQuoteCommand } from '../modules/quoteModule/quoteCommand.js';
import { handleStickerConvertCommand } from '../modules/stickerModule/stickerConvertCommand.js';
import {
  handleWaifuFactCommand,
  handleWaifuImageCommand,
  handleWaifuQuoteCommand,
  getWaifuUsageText,
} from '../modules/waifuModule/waifuCommand.js';
import {
  handleWaifuPicsCommand,
  getWaifuPicsUsageText,
} from '../modules/waifuPicsModule/waifuPicsCommand.js';

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const COMMAND_REACT_EMOJI = process.env.COMMAND_REACT_EMOJI || '🤖';

/**
 * Extrai o conteúdo de texto de uma mensagem do WhatsApp.
 * @param {Object} messageInfo
 * @returns {string}
 */
export const extractMessageContent = ({ message }) => {
  if (!message) return 'Mensagem vazia';

  const text = message.conversation?.trim() || message.extendedTextMessage?.text;

  if (text) return text;

  const handlers = [
    [message.imageMessage, (m) => m.caption || '[Imagem]'],
    [message.videoMessage, (m) => m.caption || '[Vídeo]'],
    [message.documentMessage, (m) => m.fileName || '[Documento]'],
    [message.audioMessage, () => '[Áudio]'],
    [message.stickerMessage, () => '[Figurinha]'],
    [
      message.locationMessage,
      (m) => `[Localização] Lat: ${m.degreesLatitude}, Long: ${m.degreesLongitude}`,
    ],
    [message.contactMessage, (m) => `[Contato] ${m.displayName}`],
    [
      message.contactsArrayMessage,
      (m) => `[Contatos] ${m.contacts.map((c) => c.displayName).join(', ')}`,
    ],
    [message.listMessage, (m) => m.description || '[Mensagem de Lista]'],
    [message.buttonsMessage, (m) => m.contentText || '[Mensagem de Botões]'],
    [message.templateButtonReplyMessage, (m) => `[Resposta de Botão] ${m.selectedDisplayText}`],
    [message.productMessage, (m) => m.product?.title || '[Mensagem de Produto]'],
    [message.reactionMessage, (m) => `[Reação] ${m.text}`],
    [message.pollCreationMessage, (m) => `[Enquete] ${m.name}`],
  ];

  for (const [msg, fn] of handlers) {
    if (msg) return fn(msg);
  }

  return 'Tipo de mensagem não suportado ou sem conteúdo.';
};

/**
 * Lida com atualizações do WhatsApp, sejam mensagens ou eventos genéricos.
 *
 * @param {Object} update - Objeto contendo a atualização do WhatsApp.
 */
export const handleMessages = async (update, sock) => {
  if (update.messages && Array.isArray(update.messages)) {
    try {
      for (const messageInfo of update.messages) {
        const extractedText = extractMessageContent(messageInfo);
        const remoteJid = messageInfo.key.remoteJid;
        const isGroupMessage = isGroupJid(remoteJid);
        const senderJid = isGroupMessage ? messageInfo.key.participant : remoteJid;
        const senderName = messageInfo.pushName;
        const expirationMessage = getExpiration(messageInfo);
        const botJid = resolveBotJid(sock?.user?.id);

        if (isGroupMessage) {
          const shouldSkip = await handleAntiLink({
            sock,
            messageInfo,
            extractedText,
            remoteJid,
            senderJid,
            botJid,
          });

          if (shouldSkip) {
            continue;
          }
        }

        if (extractedText.startsWith(COMMAND_PREFIX)) {
          if (COMMAND_REACT_EMOJI) {
            try {
              await sock.sendMessage(remoteJid, {
                react: {
                  text: COMMAND_REACT_EMOJI,
                  key: messageInfo.key,
                },
              });
            } catch (error) {
              logger.warn('Falha ao enviar reação de comando:', error.message);
            }
          }

          const commandBody = extractedText.substring(COMMAND_PREFIX.length);
          const match = commandBody.match(/^(\S+)([\s\S]*)$/);
          const command = match ? match[1].toLowerCase() : '';
          const rawArgs = match && match[2] !== undefined ? match[2].trim() : '';
          const args = rawArgs ? rawArgs.split(/\s+/) : [];
          const text = match && match[2] !== undefined ? match[2] : '';

          switch (command) {
            case 'menu': {
              await handleMenuCommand(
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                senderName,
                COMMAND_PREFIX,
                args,
              );
              break;
            }

            case 'sticker':
            case 's':
              processSticker(
                sock,
                messageInfo,
                senderJid,
                remoteJid,
                expirationMessage,
                senderName,
                args.join(' '),
              );
              break;

            case 'toimg':
            case 'tovideo':
            case 'tovid':
              await handleStickerConvertCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                senderJid,
              });
              break;

            case 'play':
              await handlePlayCommand(sock, remoteJid, messageInfo, expirationMessage, text);
              break;

            case 'playvid':
              await handlePlayVidCommand(sock, remoteJid, messageInfo, expirationMessage, text);
              break;

            case 'cat':
              await handleCatCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                senderJid,
                text,
              });
              break;

            case 'catprompt':
            case 'iaprompt':
            case 'promptia':
              await handleCatPromptCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                senderJid,
                text,
              });
              break;

            case 'quote':
            case 'qc':
              await handleQuoteCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                senderJid,
                senderName,
                text,
              });
              break;

            case 'waifu':
              await handleWaifuImageCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                text,
                endpoint: 'waifu',
              });
              break;

            case 'husbando':
              await handleWaifuImageCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                text,
                endpoint: 'husbando',
              });
              break;

            case 'animefact':
            case 'wfact':
              await handleWaifuFactCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
              });
              break;

            case 'animequote':
            case 'wquote':
              await handleWaifuQuoteCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                text,
              });
              break;

            case 'waifuhelp':
              await sock.sendMessage(
                remoteJid,
                { text: getWaifuUsageText() },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
              break;

            case 'wp':
            case 'waifupics':
              await handleWaifuPicsCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                text,
                type: 'sfw',
              });
              break;

            case 'wpnsfw':
            case 'waifupicsnsfw':
              await handleWaifuPicsCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                text,
                type: 'nsfw',
              });
              break;

            case 'wppicshelp':
              await sock.sendMessage(
                remoteJid,
                { text: getWaifuPicsUsageText() },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
              break;

            case 'aviso':
              await handleNoticeCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                senderJid,
                text,
              });
              break;

            case 'stickertext':
            case 'st':
              await processTextSticker({
                sock,
                messageInfo,
                remoteJid,
                senderJid,
                senderName,
                text,
                extraText: 'PackZoeira',
                expirationMessage,
                color: 'black',
              });
              break;

            case 'stickertextwhite':
            case 'stw':
              await processTextSticker({
                sock,
                messageInfo,
                remoteJid,
                senderJid,
                senderName,
                text,
                extraText: 'PackZoeira',
                expirationMessage,
                color: 'white',
              });
              break;

            case 'stickertextblink':
            case 'stb':
              await processBlinkingTextSticker({
                sock,
                messageInfo,
                remoteJid,
                senderJid,
                senderName,
                text,
                extraText: 'PackZoeira',
                expirationMessage,
                color: 'white',
              });
              break;

            case 'ranking':
            case 'rank':
            case 'top5':
              await handleRankingCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                isGroupMessage,
              });
              break;

            case 'rankingglobal':
            case 'rankglobal':
            case 'globalrank':
              await handleGlobalRankingCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                isGroupMessage,
              });
              break;

            case 'semmsg':
            case 'zeromsg':
            case 'nomsg':
            case 'inativos':
              await handleNoMessageCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                isGroupMessage,
                senderJid,
                text,
              });
              break;

            case 'social':
            case 'grafo':
            case 'interacoes':
            case 'interacao':
              await handleInteractionGraphCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
                isGroupMessage,
                args,
                senderJid,
              });
              break;

            case 'ping':
              await handlePingCommand({
                sock,
                remoteJid,
                messageInfo,
                expirationMessage,
              });
              break;

            default: {
              if (isAdminCommand(command)) {
                await handleAdminCommand({
                  command,
                  args,
                  text,
                  sock,
                  messageInfo,
                  remoteJid,
                  senderJid,
                  botJid,
                  isGroupMessage,
                  expirationMessage,
                });
                break;
              }
              logger.info(`Comando desconhecido recebido: ${command}`);

              await sock.sendMessage(
                remoteJid,
                {
                  text: `❌ *Comando não reconhecido*

O comando *${command}* não está configurado ou ainda não existe.

ℹ️ *Dica:*  
Digite *${COMMAND_PREFIX}menu* para ver a lista de comandos disponíveis.

🚧 *Fase Beta*  
O omnizap-system ainda está em desenvolvimento e novos comandos estão sendo adicionados constantemente.

📩 *Contato do Desenvolvedor*  
• Instagram: *@kaikybrofc*  
• WhatsApp: +55 95 99112-2954`,
                },
                {
                  quoted: messageInfo,
                  ephemeralExpiration: expirationMessage,
                },
              );

              break;
            }
          }
        }
      }
    } catch (error) {
      logger.error('Erro ao processar mensagens:', error.message);
    }
  } else {
    logger.info('🔄 Processando evento recebido:', {
      eventType: update?.type || 'unknown',
      eventData: update,
    });
  }
};
