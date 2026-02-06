import 'dotenv/config';

import { handleMenuCommand } from '../modules/menuModule/menus.js';
import { handleAdminCommand, isAdminCommand } from '../modules/adminModule/groupCommandHandlers.js';
import { extractSupportedStickerMediaDetails, processSticker } from '../modules/stickerModule/stickerCommand.js';
import { processBlinkingTextSticker, processTextSticker } from '../modules/stickerModule/stickerTextCommand.js';
import { handlePlayCommand, handlePlayVidCommand } from '../modules/playModule/playCommand.js';
import { handleRankingCommand } from '../modules/statsModule/rankingCommand.js';
import { handleGlobalRankingCommand } from '../modules/statsModule/globalRankingCommand.js';
import { handleNoMessageCommand } from '../modules/statsModule/noMessageCommand.js';
import { handleInteractionGraphCommand } from '../modules/statsModule/interactionGraphCommand.js';
import { handlePingCommand } from '../modules/systemMetricsModule/pingCommand.js';
import { extractMessageContent, getExpiration, isGroupJid, isSameJidUser, resolveBotJid } from '../config/baileysConfig.js';
import logger from '../utils/logger/loggerModule.js';
import { handleAntiLink } from '../utils/antiLink/antiLinkModule.js';
import { handleCatCommand, handleCatImageCommand, handleCatPromptCommand } from '../modules/aiModule/catCommand.js';
import { handleNoticeCommand } from '../modules/broadcastModule/noticeCommand.js';
import { handleQuoteCommand } from '../modules/quoteModule/quoteCommand.js';
import { handleStickerConvertCommand } from '../modules/stickerModule/stickerConvertCommand.js';
import { handleWaifuPicsCommand, getWaifuPicsUsageText } from '../modules/waifuPicsModule/waifuPicsCommand.js';
import { handlePackCommand, maybeCaptureIncomingSticker } from '../modules/stickerPackModule/stickerPackCommandHandlers.js';
import groupConfigStore from '../store/groupConfigStore.js';
import { sendAndStore } from '../services/messagePersistenceService.js';
import { resolveCaptchaByMessage } from '../services/captchaService.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const COMMAND_REACT_EMOJI = process.env.COMMAND_REACT_EMOJI || '🤖';

/**
 * Resolve o prefixo de comandos.
 * Usa o prefixo do grupo quando existir, senão usa o padrão.
 */
const resolveCommandPrefix = async (isGroupMessage, remoteJid) => {
  if (!isGroupMessage) return DEFAULT_COMMAND_PREFIX;
  const config = await groupConfigStore.getGroupConfig(remoteJid);
  if (!config || typeof config.commandPrefix !== 'string') {
    return DEFAULT_COMMAND_PREFIX;
  }
  const prefix = config.commandPrefix.trim();
  return prefix || DEFAULT_COMMAND_PREFIX;
};

/**
 * Executa um comando com tratamento de erro.
 * Captura erros síncronos e promessas rejeitadas.
 */
const runCommand = (label, handler) => {
  try {
    const result = handler();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        logger.error(`Erro ao executar comando ${label}:`, error.message);
      });
    }
  } catch (error) {
    logger.error(`Erro ao executar comando ${label}:`, error.message);
  }
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
        const senderIdentity = isGroupMessage
          ? {
              participant: messageInfo.key?.participant || null,
              participantAlt: messageInfo.key?.participantAlt || null,
              jid: senderJid || null,
            }
          : senderJid;
        const senderName = messageInfo.pushName;
        const expirationMessage = getExpiration(messageInfo);
        const botJid = resolveBotJid(sock?.user?.id);
        const isMessageFromBot = Boolean(messageInfo?.key?.fromMe) || (botJid ? isSameJidUser(senderJid, botJid) : false);
        let commandPrefix = DEFAULT_COMMAND_PREFIX;

        /**
         * Executa validações de grupo.
         * Aplica o Anti-Link e resolve o prefixo do grupo.
         * Se a mensagem for bloqueada, interrompe o processamento.
         */
        if (isGroupMessage) {
          const shouldSkip = await handleAntiLink({ sock, messageInfo, extractedText, remoteJid, senderJid, botJid });

          if (shouldSkip) {
            continue;
          }
          commandPrefix = await resolveCommandPrefix(true, remoteJid);
        }

        if (isGroupMessage && !isMessageFromBot) {
          resolveCaptchaByMessage({
            groupId: remoteJid,
            senderJid,
            senderIdentity,
            messageKey: messageInfo.key,
          });
        }

        /**
         * Envia uma reação automática quando a mensagem começa com o prefixo de comando.
         * A falha no envio da reação não interrompe o processamento do comando.
         */
        const isCommandMessage = extractedText.startsWith(commandPrefix);

        if (isCommandMessage) {
          if (COMMAND_REACT_EMOJI) {
            try {
              await sendAndStore(sock, remoteJid, {
                react: {
                  text: COMMAND_REACT_EMOJI,
                  key: messageInfo.key,
                },
              });
            } catch (error) {
              logger.warn('Falha ao enviar reação de comando:', error.message);
            }
          }

          const commandBody = extractedText.substring(commandPrefix.length);
          const match = commandBody.match(/^(\S+)([\s\S]*)$/);
          const command = match ? match[1].toLowerCase() : '';
          const rawArgs = match && match[2] !== undefined ? match[2].trim() : '';
          const args = rawArgs ? rawArgs.split(/\s+/) : [];
          const text = match && match[2] !== undefined ? match[2] : '';

          switch (command) {
            case 'menu':
              runCommand('menu', () => handleMenuCommand(sock, remoteJid, messageInfo, expirationMessage, senderName, commandPrefix, args));
              break;

            case 'sticker':
            case 's':
              runCommand('sticker', () => processSticker(sock, messageInfo, senderJid, remoteJid, expirationMessage, senderName, args.join(' '), { commandPrefix }));
              break;

            case 'pack':
            case 'packs':
              runCommand('pack', () => handlePackCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, senderName, text, commandPrefix }));
              break;

            case 'toimg':
            case 'tovideo':
            case 'tovid':
              runCommand('toimg', () => handleStickerConvertCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid }));
              break;

            case 'play':
              runCommand('play', () => handlePlayCommand(sock, remoteJid, messageInfo, expirationMessage, text, commandPrefix));
              break;

            case 'playvid':
              runCommand('playvid', () => handlePlayVidCommand(sock, remoteJid, messageInfo, expirationMessage, text, commandPrefix));
              break;

            case 'cat':
              runCommand('cat', () => handleCatCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text, commandPrefix }));
              break;

            case 'catimg':
            case 'catimage':
              runCommand('catimg', () =>
                handleCatImageCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text, commandPrefix }),
              );
              break;

            case 'catprompt':
            case 'iaprompt':
            case 'promptia':
              runCommand('catprompt', () => handleCatPromptCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text, commandPrefix }));
              break;

            case 'quote':
            case 'qc':
              runCommand('quote', () => handleQuoteCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, senderName, text, commandPrefix }));
              break;

            case 'wp':
            case 'waifupics':
              runCommand('waifupics', () => handleWaifuPicsCommand({ sock, remoteJid, messageInfo, expirationMessage, text, type: 'sfw', commandPrefix }));
              break;

            case 'wpnsfw':
            case 'waifupicsnsfw':
              runCommand('waifupicsnsfw', () => handleWaifuPicsCommand({ sock, remoteJid, messageInfo, expirationMessage, text, type: 'nsfw', commandPrefix }));
              break;

            case 'wppicshelp':
              runCommand('wppicshelp', () => sendAndStore(sock, remoteJid, { text: getWaifuPicsUsageText(commandPrefix) }, { quoted: messageInfo, ephemeralExpiration: expirationMessage }));
              break;

            case 'stickertext':
            case 'st':
              runCommand('stickertext', () => processTextSticker({ sock, messageInfo, remoteJid, senderJid, senderName, text, extraText: 'PackZoeira', expirationMessage, color: 'black', commandPrefix }));
              break;

            case 'stickertextwhite':
            case 'stw':
              runCommand('stickertextwhite', () => processTextSticker({ sock, messageInfo, remoteJid, senderJid, senderName, text, extraText: 'PackZoeira', expirationMessage, color: 'white', commandPrefix }));
              break;

            case 'stickertextblink':
            case 'stb':
              runCommand('stickertextblink', () => processBlinkingTextSticker({ sock, messageInfo, remoteJid, senderJid, senderName, text, extraText: 'PackZoeira', expirationMessage, color: 'white', commandPrefix }));
              break;

            case 'ranking':
            case 'rank':
            case 'top5':
              runCommand('ranking', () => handleRankingCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }));
              break;

            case 'rankingglobal':
            case 'rankglobal':
            case 'globalrank':
              runCommand('rankingglobal', () => handleGlobalRankingCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }));
              break;

            case 'semmsg':
            case 'zeromsg':
            case 'nomsg':
            case 'inativos':
              runCommand('semmsg', () => handleNoMessageCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage, senderJid, text }));
              break;

            case 'social':
            case 'grafo':
            case 'interacoes':
            case 'interacao':
              runCommand('social', () => handleInteractionGraphCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage, args, senderJid }));
              break;

            case 'ping':
              runCommand('ping', () => handlePingCommand({ sock, remoteJid, messageInfo, expirationMessage }));
              break;

            case 'aviso':
            case 'notice':
              runCommand('aviso', () => handleNoticeCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text, commandPrefix }));
              break;

            default:
              if (isAdminCommand(command)) {
                runCommand('admin', () => handleAdminCommand({ command, args, text, sock, messageInfo, remoteJid, senderJid, botJid, isGroupMessage, expirationMessage, commandPrefix }));
                break;
              }

              logger.info(`Comando desconhecido recebido: ${command}`);
              runCommand('unknown', () =>
                sendAndStore(
                  sock,
                  remoteJid,
                  {
                    text: `❌ *Comando não reconhecido*

O comando *${command}* não está configurado ou ainda não existe.

ℹ️ *Dica:*  
Digite *${commandPrefix}menu* para ver a lista de comandos disponíveis.

🚧 *Fase Beta*  
O omnizap-system ainda está em desenvolvimento e novos comandos estão sendo adicionados constantemente.`,
                  },
                  { quoted: messageInfo, ephemeralExpiration: expirationMessage },
                ),
              );
              break;
          }
        }

        if (!isMessageFromBot) {
          runCommand('pack-capture', () =>
            maybeCaptureIncomingSticker({
              messageInfo,
              senderJid,
              isMessageFromBot,
            }),
          );
        }

        if (isGroupMessage && !isCommandMessage && !isMessageFromBot) {
          const autoStickerMedia = extractSupportedStickerMediaDetails(messageInfo, { includeQuoted: false });

          if (autoStickerMedia && autoStickerMedia.mediaType !== 'sticker') {
            const groupConfig = await groupConfigStore.getGroupConfig(remoteJid);
            if (groupConfig.autoStickerEnabled) {
              runCommand('autosticker', () =>
                processSticker(sock, messageInfo, senderJid, remoteJid, expirationMessage, senderName, '', {
                  includeQuotedMedia: false,
                  showAutoPackNotice: false,
                  commandPrefix,
                }),
              );
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
