import 'dotenv/config';

import { handleMenuCommand } from '../modules/menuModule/menus.js';
import { handleAdminCommand, isAdminCommand } from '../modules/adminModule/groupCommandHandlers.js';
import { extractSupportedStickerMediaDetails, processSticker } from '../modules/stickerModule/stickerCommand.js';
import { processBlinkingTextSticker, processTextSticker } from '../modules/stickerModule/stickerTextCommand.js';
import { handlePlayCommand, handlePlayVidCommand } from '../modules/playModule/playCommand.js';
import { handleRankingCommand } from '../modules/statsModule/rankingCommand.js';
import { handleGlobalRankingCommand } from '../modules/statsModule/globalRankingCommand.js';
import { handleNoMessageCommand } from '../modules/statsModule/noMessageCommand.js';
import { handlePingCommand } from '../modules/systemMetricsModule/pingCommand.js';
import { detectAllMediaTypes, extractMessageContent, getExpiration, getJidServer, getJidUser, isGroupJid, isSameJidUser, normalizeJid, resolveBotJid } from '../config/baileysConfig.js';
import logger from '../utils/logger/loggerModule.js';
import { handleAntiLink } from '../utils/antiLink/antiLinkModule.js';
import { handleCatCommand, handleCatImageCommand, handleCatPromptCommand } from '../modules/aiModule/catCommand.js';
import { handleNoticeCommand } from '../modules/broadcastModule/noticeCommand.js';
import { handleQuoteCommand } from '../modules/quoteModule/quoteCommand.js';
import { handleStickerConvertCommand } from '../modules/stickerModule/stickerConvertCommand.js';
import { handleWaifuPicsCommand, getWaifuPicsUsageText } from '../modules/waifuPicsModule/waifuPicsCommand.js';
import { handlePackCommand, maybeCaptureIncomingSticker } from '../modules/stickerPackModule/stickerPackCommandHandlers.js';
import { handleUserCommand } from '../modules/userModule/userCommand.js';
import { handleDiceCommand } from '../modules/gameModule/diceCommand.js';
import { handleTikTokCommand } from '../modules/tiktokModule/tiktokCommand.js';
import { handleRpgPokemonCommand } from '../modules/rpgPokemonModule/rpgPokemonCommand.js';
import groupConfigStore from '../store/groupConfigStore.js';
import { sendAndStore } from '../services/messagePersistenceService.js';
import { resolveCaptchaByMessage } from '../services/captchaService.js';
import { extractSenderInfoFromMessage, resolveUserId } from '../services/lidMapService.js';
import { buildWhatsAppGoogleLoginUrl } from '../services/whatsappLoginLinkService.js';
import { isWhatsAppUserLinkedToGoogleWebAccount } from '../services/googleWebLinkService.js';
import { createMessageAnalysisEvent } from '../modules/analyticsModule/messageAnalysisEventRepository.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const COMMAND_REACT_EMOJI = process.env.COMMAND_REACT_EMOJI || '🤖';
const START_LOGIN_TRIGGER =
  String(process.env.WHATSAPP_LOGIN_TRIGGER || 'iniciar')
    .trim()
    .toLowerCase() || 'iniciar';
const WHATSAPP_USER_SERVERS = new Set(['s.whatsapp.net', 'c.us', 'hosted']);
const WHATSAPP_LID_SERVERS = new Set(['lid', 'hosted.lid']);
const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};
const MESSAGE_ANALYTICS_ENABLED = parseEnvBool(process.env.MESSAGE_ANALYTICS_ENABLED, true);
const MESSAGE_ANALYTICS_SOURCE =
  String(process.env.MESSAGE_ANALYTICS_SOURCE || 'whatsapp')
    .trim()
    .slice(0, 32) || 'whatsapp';
const WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN = parseEnvBool(process.env.WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN, true);
const SITE_ORIGIN =
  String(process.env.SITE_ORIGIN || process.env.WHATSAPP_LOGIN_BASE_URL || 'https://omnizap.shop')
    .trim()
    .replace(/\/+$/, '') || 'https://omnizap.shop';
const SITE_LOGIN_URL = `${SITE_ORIGIN}/login/`;
const SITE_GROUP_LOGIN_URL = `${SITE_ORIGIN}/login`;

const KNOWN_MESSAGE_COMMANDS = new Set(['menu', 'sticker', 's', 'pack', 'packs', 'toimg', 'tovideo', 'tovid', 'play', 'playvid', 'tiktok', 'tt', 'cat', 'catimg', 'catimage', 'catprompt', 'iaprompt', 'promptia', 'quote', 'qc', 'wp', 'waifupics', 'wpnsfw', 'waifupicsnsfw', 'wppicshelp', 'stickertext', 'st', 'stickertextwhite', 'stw', 'stickertextblink', 'stb', 'ranking', 'rank', 'top5', 'rankingglobal', 'rankglobal', 'globalrank', 'globalranking', 'semmsg', 'zeromsg', 'nomsg', 'inativos', 'ping', 'dado', 'dice', 'user', 'usuario', 'rpg', 'aviso', 'notice']);

let messageAnalyticsTableMissingLogged = false;

const normalizeTriggerText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const isStartLoginTrigger = (text) => normalizeTriggerText(text) === START_LOGIN_TRIGGER;

const resolveCanonicalWhatsAppJid = (...candidates) => {
  for (const candidate of candidates) {
    const normalized = normalizeJid(String(candidate || '').trim());
    if (!normalized) continue;
    const server = getJidServer(normalized);
    if (!WHATSAPP_USER_SERVERS.has(server) && !WHATSAPP_LID_SERVERS.has(server)) continue;
    const user = String(getJidUser(normalized) || '')
      .split(':')[0]
      .replace(/\D+/g, '');
    if (!user) continue;
    if (user.length < 10 || user.length > 15) continue;
    return normalizeJid(`${user}@s.whatsapp.net`) || normalized;
  }
  return '';
};

const resolveCanonicalSenderJidFromMessage = async ({ messageInfo, senderJid }) => {
  const key = messageInfo?.key || {};
  const senderInfo = extractSenderInfoFromMessage(messageInfo);
  let canonicalUserId = resolveCanonicalWhatsAppJid(senderInfo?.jid, senderInfo?.lid, senderInfo?.participantAlt, key.participantAlt, key.participant, key.remoteJid, senderJid);

  try {
    const resolvedUserId = await resolveUserId(senderInfo);
    canonicalUserId = resolveCanonicalWhatsAppJid(resolvedUserId, canonicalUserId, senderInfo?.jid, senderInfo?.lid);
  } catch (error) {
    logger.warn('Falha ao resolver ID canonico do remetente.', {
      action: 'resolve_sender_canonical_id_failed',
      error: error?.message,
    });
  }

  return canonicalUserId;
};

const maybeHandleStartLoginMessage = async ({ sock, messageInfo, extractedText, senderName, senderJid, remoteJid, expirationMessage, isMessageFromBot, isGroupMessage }) => {
  if (isMessageFromBot || !isStartLoginTrigger(extractedText)) return false;

  if (isGroupMessage) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: 'Por seguranca, envie *iniciar* no privado do bot para receber seu link de login.',
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return true;
  }

  const key = messageInfo?.key || {};
  const senderInfo = extractSenderInfoFromMessage(messageInfo);
  const canonicalUserId = await resolveCanonicalSenderJidFromMessage({ messageInfo, senderJid });

  const loginUrl = buildWhatsAppGoogleLoginUrl({ userId: canonicalUserId });
  if (!loginUrl) {
    logger.warn('Nao foi possivel montar link de login para mensagem "iniciar".', {
      action: 'login_link_missing_user_phone',
      remoteServer: getJidServer(key.remoteJid || ''),
      participantServer: getJidServer(key.participant || ''),
      participantAltServer: getJidServer(key.participantAlt || ''),
      hasLid: Boolean(senderInfo?.lid),
      hasJid: Boolean(senderInfo?.jid),
    });
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: 'Nao consegui identificar seu numero de WhatsApp para o login. Tente novamente em alguns segundos.',
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return true;
  }

  const safeName = String(senderName || '').trim();
  const greeting = safeName ? `Oi, *${safeName}*!` : 'Oi!';
  await sendAndStore(
    sock,
    remoteJid,
    {
      text: `${greeting}\n\n` + 'Para continuar no OmniZap, faca login com Google neste link:\n' + `${loginUrl}\n\n` + 'Seu numero do WhatsApp sera vinculado automaticamente a conta logada.',
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );

  return true;
};

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

const normalizeMessageKind = (mediaEntries, extractedText) => {
  if (Array.isArray(mediaEntries) && mediaEntries.length > 0) {
    const primaryType =
      String(mediaEntries[0]?.mediaType || '')
        .trim()
        .toLowerCase() || 'media';
    return primaryType.slice(0, 48);
  }

  const safeText = String(extractedText || '').trim();
  if (!safeText || safeText === 'Mensagem vazia') return 'empty';
  if (safeText.startsWith('[') && safeText.endsWith(']')) {
    return safeText.slice(1, -1).trim().toLowerCase().replace(/\s+/g, '_').slice(0, 48);
  }
  return 'text';
};

const normalizeAnalysisErrorCode = (error) =>
  String(error?.code || error?.name || 'processing_error')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 96) || 'processing_error';

const persistMessageAnalysisEvent = (payload) => {
  if (!MESSAGE_ANALYTICS_ENABLED) return;
  void createMessageAnalysisEvent(payload).catch((error) => {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      if (messageAnalyticsTableMissingLogged) return;
      messageAnalyticsTableMissingLogged = true;
      logger.warn('Tabela de analytics de mensagens ainda não existe. Execute a migracao 20260301_0028.', {
        action: 'message_analysis_table_missing',
      });
      return;
    }

    logger.warn('Falha ao persistir analytics de mensagem.', {
      action: 'message_analysis_insert_failed',
      error: error?.message,
    });
  });
};

const buildSiteLoginUrlForUser = (canonicalUserId) => buildWhatsAppGoogleLoginUrl({ userId: canonicalUserId }) || SITE_LOGIN_URL;

const ensureUserHasGoogleWebLoginForCommand = async ({ sock, messageInfo, senderJid, remoteJid, expirationMessage, commandPrefix }) => {
  const isGroupMessage = isGroupJid(remoteJid);
  const canonicalUserId = await resolveCanonicalSenderJidFromMessage({ messageInfo, senderJid });
  let linked = false;
  try {
    linked = await isWhatsAppUserLinkedToGoogleWebAccount({
      ownerJid: canonicalUserId || senderJid,
    });
  } catch (error) {
    logger.warn('Falha ao validar vínculo Google Web para comando do WhatsApp. Comando liberado por fallback.', {
      action: 'whatsapp_command_google_link_check_failed',
      error: error?.message,
    });
    return {
      allowed: true,
      canonicalUserId,
      loginUrl: '',
    };
  }

  if (linked) {
    return {
      allowed: true,
      canonicalUserId,
      loginUrl: '',
    };
  }

  const loginUrl = isGroupMessage ? SITE_GROUP_LOGIN_URL : buildSiteLoginUrlForUser(canonicalUserId || senderJid);
  const loginMessage = isGroupMessage ? `Para usar os comandos do bot, você precisa estar logado no site com sua conta Google.\n\nAcesse:\n${loginUrl}` : `Para usar os comandos do bot, você precisa estar logado no site com sua conta Google.\n\nCadastre-se / faça login em:\n${loginUrl}\n\nDepois volte aqui e envie o comando novamente (ex.: ${commandPrefix}menu).`;

  await sendAndStore(
    sock,
    remoteJid,
    {
      text: loginMessage,
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );

  return {
    allowed: false,
    canonicalUserId,
    loginUrl,
  };
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
        const mediaEntries = detectAllMediaTypes(messageInfo?.message, false);
        const mediaTypes = mediaEntries
          .map((entry) =>
            String(entry?.mediaType || '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean)
          .slice(0, 10);
        const analysisPayload = {
          messageId: messageInfo?.key?.id || null,
          chatId: remoteJid || null,
          senderId: senderJid || null,
          senderName,
          upsertType: update?.type || null,
          source: MESSAGE_ANALYTICS_SOURCE,
          isGroup: isGroupMessage,
          isFromBot: isMessageFromBot,
          isCommand: false,
          commandName: null,
          commandArgsCount: 0,
          commandKnown: null,
          commandPrefix,
          messageKind: normalizeMessageKind(mediaEntries, extractedText),
          hasMedia: mediaEntries.length > 0,
          mediaCount: mediaEntries.length,
          textLength: String(extractedText || '').length,
          processingResult: 'processed',
          errorCode: null,
          metadata: {
            media_types: mediaTypes,
            start_login_trigger: isStartLoginTrigger(extractedText),
          },
        };

        try {
          /**
           * Executa validações de grupo.
           * Aplica o Anti-Link e resolve o prefixo do grupo.
           * Se a mensagem for bloqueada, interrompe o processamento.
           */
          if (isGroupMessage) {
            const shouldSkip = await handleAntiLink({ sock, messageInfo, extractedText, remoteJid, senderJid, botJid });

            if (shouldSkip) {
              analysisPayload.processingResult = 'blocked_antilink';
              analysisPayload.metadata = {
                ...analysisPayload.metadata,
                blocked_by: 'anti_link',
              };
              continue;
            }
            commandPrefix = await resolveCommandPrefix(true, remoteJid);
            analysisPayload.commandPrefix = commandPrefix;
          }

          if (isGroupMessage && !isMessageFromBot) {
            await resolveCaptchaByMessage({
              groupId: remoteJid,
              senderJid,
              senderIdentity,
              messageKey: messageInfo.key,
              messageInfo,
              extractedText,
            });
          }

          const handledStartLogin = await maybeHandleStartLoginMessage({
            sock,
            messageInfo,
            extractedText,
            senderName,
            senderJid,
            remoteJid,
            expirationMessage,
            isMessageFromBot,
            isGroupMessage,
          });

          if (handledStartLogin) {
            analysisPayload.processingResult = 'handled_start_login';
            analysisPayload.metadata = {
              ...analysisPayload.metadata,
              flow: 'whatsapp_google_login',
            };
            continue;
          }

          /**
           * Envia uma reação automática quando a mensagem começa com o prefixo de comando.
           * A falha no envio da reação não interrompe o processamento do comando.
           */
          const isCommandMessage = extractedText.startsWith(commandPrefix);
          analysisPayload.isCommand = isCommandMessage;
          analysisPayload.commandPrefix = commandPrefix;

          if (isCommandMessage) {
            const commandBody = extractedText.substring(commandPrefix.length);
            const match = commandBody.match(/^(\S+)([\s\S]*)$/);
            const command = match ? match[1].toLowerCase() : '';
            const rawArgs = match && match[2] !== undefined ? match[2].trim() : '';
            const args = rawArgs ? rawArgs.split(/\s+/) : [];
            const text = match && match[2] !== undefined ? match[2] : '';
            const isAdminCommandRoute = isAdminCommand(command);

            analysisPayload.commandName = command || null;
            analysisPayload.commandArgsCount = args.length;
            analysisPayload.commandKnown = KNOWN_MESSAGE_COMMANDS.has(command) || isAdminCommandRoute;

            if (!isMessageFromBot && WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN) {
              const authCheck = await ensureUserHasGoogleWebLoginForCommand({
                sock,
                messageInfo,
                senderJid,
                remoteJid,
                expirationMessage,
                commandPrefix,
              });

              if (!authCheck.allowed) {
                analysisPayload.processingResult = 'auth_required';
                analysisPayload.metadata = {
                  ...analysisPayload.metadata,
                  auth_required_for_command: command || null,
                  auth_login_url: authCheck.loginUrl || SITE_LOGIN_URL,
                };
                continue;
              }
            }

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

              case 'tiktok':
              case 'tt':
                runCommand('tiktok', () => handleTikTokCommand({ sock, remoteJid, messageInfo, expirationMessage, text, commandPrefix }));
                break;

              case 'cat':
                runCommand('cat', () => handleCatCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text, commandPrefix }));
                break;

              case 'catimg':
              case 'catimage':
                runCommand('catimg', () => handleCatImageCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text, commandPrefix }));
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
              case 'globalranking':
                runCommand('rankingglobal', () => handleGlobalRankingCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }));
                break;

              case 'semmsg':
              case 'zeromsg':
              case 'nomsg':
              case 'inativos':
                runCommand('semmsg', () => handleNoMessageCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage, senderJid, text }));
                break;

              case 'ping':
                runCommand('ping', () => handlePingCommand({ sock, remoteJid, messageInfo, expirationMessage }));
                break;

              case 'dado':
              case 'dice':
                runCommand('dado', () => handleDiceCommand({ sock, remoteJid, messageInfo, expirationMessage, args, commandPrefix }));
                break;

              case 'user':
              case 'usuario':
                runCommand('user', () =>
                  handleUserCommand({
                    sock,
                    remoteJid,
                    messageInfo,
                    expirationMessage,
                    senderJid,
                    args,
                    isGroupMessage,
                    commandPrefix,
                  }),
                );
                break;

              case 'rpg':
                runCommand('rpg', () =>
                  handleRpgPokemonCommand({
                    sock,
                    remoteJid,
                    messageInfo,
                    expirationMessage,
                    senderJid,
                    senderIdentity,
                    args,
                    commandPrefix,
                  }),
                );
                break;

              case 'aviso':
              case 'notice':
                runCommand('aviso', () => handleNoticeCommand({ sock, remoteJid, messageInfo, expirationMessage, senderJid, text, commandPrefix }));
                break;

              default:
                if (isAdminCommandRoute) {
                  runCommand('admin', () => handleAdminCommand({ command, args, text, sock, messageInfo, remoteJid, senderJid, botJid, isGroupMessage, expirationMessage, commandPrefix }));
                  break;
                }

                analysisPayload.processingResult = 'unknown_command';
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
                analysisPayload.processingResult = 'autosticker_triggered';
                analysisPayload.metadata = {
                  ...analysisPayload.metadata,
                  auto_sticker_media_type: autoStickerMedia.mediaType || null,
                };
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
        } catch (messageError) {
          analysisPayload.processingResult = 'error';
          analysisPayload.errorCode = normalizeAnalysisErrorCode(messageError);
          logger.error('Erro ao processar mensagem individual:', {
            error: messageError?.message,
            messageId: messageInfo?.key?.id || null,
            remoteJid,
          });
        } finally {
          persistMessageAnalysisEvent(analysisPayload);
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
