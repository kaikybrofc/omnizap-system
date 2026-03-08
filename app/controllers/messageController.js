import 'dotenv/config';

import { isAdminCommand } from '../modules/adminModule/groupCommandHandlers.js';
import {
  explicarComandoGlobal,
  registerGlobalHelpCommandExecution,
} from '../services/globalModuleAiHelpService.js';
import {
  extractSupportedStickerMediaDetails,
  processSticker,
} from '../modules/stickerModule/stickerCommand.js';
import {
  detectAllMediaTypes,
  extractMessageContent,
  getExpiration,
  getJidServer,
  getJidUser,
  isGroupJid,
  isLidJid,
  isSameJidUser,
  isWhatsAppJid,
  normalizeJid,
  resolveBotJid,
} from '../config/baileysConfig.js';
import { isUserAdmin } from '../config/groupUtils.js';
import { isAdminSenderAsync } from '../config/adminIdentity.js';
import logger from '../../utils/logger/loggerModule.js';
import { handleAntiLink } from '../utils/antiLink/antiLinkModule.js';
import { maybeCaptureIncomingSticker } from '../modules/stickerPackModule/stickerPackCommandHandlers.js';
import groupConfigStore from '../store/groupConfigStore.js';
import { sendAndStore } from '../services/messagePersistenceService.js';
import { resolveCaptchaByMessage } from '../services/captchaService.js';
import { extractSenderInfoFromMessage, resolveUserId } from '../services/lidMapService.js';
import { buildWhatsAppGoogleLoginUrl } from '../services/whatsappLoginLinkService.js';
import { isWhatsAppUserLinkedToGoogleWebAccount } from '../services/googleWebLinkService.js';
import { createMessageAnalysisEvent } from '../modules/analyticsModule/messageAnalysisEventRepository.js';
import { routeConversationMessage } from '../services/conversationRouterService.js';
import { executeMessageCommandRoute } from '../services/messageCommandExecutionService.js';
import {
  canSendMessageInStickerFocus,
  registerMessageUsageInStickerFocus,
  resolveStickerFocusMessageClassification,
  resolveStickerFocusState,
  shouldSendStickerFocusWarning,
} from '../services/stickerFocusService.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const COMMAND_REACT_EMOJI = process.env.COMMAND_REACT_EMOJI || '🤖';
const START_LOGIN_TRIGGER =
  String(process.env.WHATSAPP_LOGIN_TRIGGER || 'iniciar')
    .trim()
    .toLowerCase() || 'iniciar';
const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};
const parseEnvInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};
const MESSAGE_ANALYTICS_ENABLED = parseEnvBool(process.env.MESSAGE_ANALYTICS_ENABLED, true);
const MESSAGE_ANALYTICS_SOURCE =
  String(process.env.MESSAGE_ANALYTICS_SOURCE || 'whatsapp')
    .trim()
    .slice(0, 32) || 'whatsapp';
const MESSAGE_COMMAND_DEDUPE_TTL_MS = parseEnvInt(
  process.env.MESSAGE_COMMAND_DEDUPE_TTL_MS,
  120_000,
  15_000,
  30 * 60 * 1000,
);
const WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN = parseEnvBool(
  process.env.WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN,
  true,
);
const SITE_ORIGIN =
  String(process.env.SITE_ORIGIN || process.env.WHATSAPP_LOGIN_BASE_URL || 'https://omnizap.shop')
    .trim()
    .replace(/\/+$/, '') || 'https://omnizap.shop';
const SITE_LOGIN_URL = `${SITE_ORIGIN}/login/`;
const SITE_GROUP_LOGIN_URL = `${SITE_ORIGIN}/login`;

const KNOWN_MESSAGE_COMMANDS = new Set([
  'menu',
  'sticker',
  's',
  'pack',
  'packs',
  'toimg',
  'tovideo',
  'tovid',
  'play',
  'playvid',
  'tiktok',
  'tt',
  'cat',
  'catimg',
  'catimage',
  'catprompt',
  'iaprompt',
  'promptia',
  'quote',
  'qc',
  'wp',
  'waifupics',
  'wpnsfw',
  'waifupicsnsfw',
  'wppicshelp',
  'stickertext',
  'st',
  'stickertextwhite',
  'stw',
  'stickertextblink',
  'stb',
  'ranking',
  'rank',
  'top5',
  'rankingglobal',
  'rankglobal',
  'globalrank',
  'globalranking',
  'ping',
  'dado',
  'dice',
  'user',
  'usuario',
  'rpg',
]);

let messageAnalyticsTableMissingLogged = false;
const recentCommandExecutions = new Map();

const pruneRecentCommandExecutions = (nowMs = Date.now()) => {
  for (const [cacheKey, expiresAt] of recentCommandExecutions.entries()) {
    if (expiresAt <= nowMs) {
      recentCommandExecutions.delete(cacheKey);
    }
  }
};

const buildCommandExecutionCacheKey = (chatId, messageId) => {
  const normalizedChatId = String(chatId || '').trim();
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedChatId || !normalizedMessageId) return '';
  return `${normalizedChatId}:${normalizedMessageId}`;
};

const isDuplicateCommandExecution = (chatId, messageId) => {
  const cacheKey = buildCommandExecutionCacheKey(chatId, messageId);
  if (!cacheKey) return false;

  const nowMs = Date.now();
  const expiresAt = recentCommandExecutions.get(cacheKey) || 0;
  if (expiresAt <= nowMs) {
    recentCommandExecutions.delete(cacheKey);
    return false;
  }

  return true;
};

const markCommandExecution = (chatId, messageId) => {
  const cacheKey = buildCommandExecutionCacheKey(chatId, messageId);
  if (!cacheKey) return;
  pruneRecentCommandExecutions(Date.now());
  recentCommandExecutions.set(cacheKey, Date.now() + MESSAGE_COMMAND_DEDUPE_TTL_MS);
};

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
    if (!isWhatsAppJid(normalized)) continue;
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
  let canonicalUserId = resolveCanonicalWhatsAppJid(
    senderInfo?.jid,
    senderInfo?.remoteJidAlt,
    senderInfo?.participantAlt,
    key.remoteJidAlt,
    key.participantAlt,
    key.participant,
    key.remoteJid,
    senderJid,
  );

  try {
    const resolvedUserId = await resolveUserId(senderInfo);
    canonicalUserId = resolveCanonicalWhatsAppJid(
      resolvedUserId,
      canonicalUserId,
      senderInfo?.jid,
      senderInfo?.remoteJidAlt,
      senderInfo?.participantAlt,
    );
  } catch (error) {
    logger.warn('Falha ao resolver ID canonico do remetente.', {
      action: 'resolve_sender_canonical_id_failed',
      error: error?.message,
    });
  }

  return canonicalUserId;
};

const resolveAddressingModeFromMessageKey = (key = {}, senderInfo = {}) => {
  const explicit = String(key?.addressingMode || '')
    .trim()
    .toLowerCase();
  if (explicit === 'lid') return 'lid';
  if (explicit === 'pn') return 'pn';

  const candidates = [
    senderInfo?.lid,
    key?.participant,
    key?.participantAlt,
    key?.remoteJid,
    key?.remoteJidAlt,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeJid(String(candidate || '').trim());
    if (!normalized) continue;
    if (isLidJid(normalized)) return 'lid';
    if (isWhatsAppJid(normalized)) return 'pn';
  }

  return undefined;
};

const resolveSenderContext = async ({ messageInfo, isGroupMessage, remoteJid }) => {
  const key = messageInfo?.key || {};
  const senderInfo = extractSenderInfoFromMessage(messageInfo);
  let resolvedUserId = '';

  try {
    const resolved = await resolveUserId(senderInfo);
    resolvedUserId = String(resolved || '').trim();
  } catch (error) {
    logger.debug('Falha ao resolver senderId via lidMapService.', {
      action: 'resolve_sender_context_failed',
      error: error?.message,
    });
  }

  const senderJidCandidates = isGroupMessage
    ? [
        resolvedUserId,
        senderInfo?.jid,
        senderInfo?.participantAlt,
        key.participantAlt,
        key.participant,
        key.remoteJidAlt,
        remoteJid,
      ]
    : [
        resolvedUserId,
        senderInfo?.jid,
        senderInfo?.participantAlt,
        key.remoteJidAlt,
        key.remoteJid,
        remoteJid,
      ];

  const canonicalSender = resolveCanonicalWhatsAppJid(...senderJidCandidates);
  const fallbackSender =
    senderJidCandidates.find((candidate) => String(candidate || '').trim()) || '';
  const senderJid = canonicalSender || String(fallbackSender || '').trim();
  const addressingMode = resolveAddressingModeFromMessageKey(key, senderInfo);

  const senderIdentity = isGroupMessage
    ? {
        participant: key?.participant || null,
        participantAlt: key?.participantAlt || null,
        jid: senderJid || null,
      }
    : senderJid;

  return {
    senderJid,
    senderIdentity,
    senderInfo,
    resolvedUserId,
    addressingMode,
  };
};

const sendReply = (sock, remoteJid, messageInfo, expirationMessage, content, options = {}) =>
  sendAndStore(sock, remoteJid, content, {
    quoted: messageInfo,
    ephemeralExpiration: expirationMessage,
    ...(options || {}),
  });

const maybeHandleStartLoginMessage = async ({
  sock,
  messageInfo,
  extractedText,
  senderName,
  senderJid,
  remoteJid,
  expirationMessage,
  isMessageFromBot,
  isGroupMessage,
}) => {
  if (isMessageFromBot || !isStartLoginTrigger(extractedText)) return false;

  if (isGroupMessage) {
    await sendReply(sock, remoteJid, messageInfo, expirationMessage, {
      text: 'Por seguranca, envie *iniciar* no privado do bot para receber seu link de login.',
    });
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
      remoteAltServer: getJidServer(key.remoteJidAlt || ''),
      participantServer: getJidServer(key.participant || ''),
      participantAltServer: getJidServer(key.participantAlt || ''),
      hasLid: Boolean(senderInfo?.lid),
      hasJid: Boolean(senderInfo?.jid),
    });
    await sendReply(sock, remoteJid, messageInfo, expirationMessage, {
      text: 'Nao consegui identificar seu numero de WhatsApp para o login. Tente novamente em alguns segundos.',
    });
    return true;
  }

  const safeName = String(senderName || '').trim();
  const greeting = safeName ? `Oi, *${safeName}*!` : 'Oi!';
  await sendReply(sock, remoteJid, messageInfo, expirationMessage, {
    text:
      `${greeting}\n\n` +
      'Para continuar no OmniZap, faca login com Google neste link:\n' +
      `${loginUrl}\n\n` +
      'Seu numero do WhatsApp sera vinculado automaticamente a conta logada.',
  });

  return true;
};

/**
 * Resolve o prefixo de comandos.
 * Usa o prefixo do grupo quando existir, senão usa o padrão.
 */
const resolveCommandPrefix = async (isGroupMessage, remoteJid, groupConfig = null) => {
  if (!isGroupMessage) return DEFAULT_COMMAND_PREFIX;
  const config = groupConfig || (await groupConfigStore.getGroupConfig(remoteJid));
  if (!config || typeof config.commandPrefix !== 'string') {
    return DEFAULT_COMMAND_PREFIX;
  }
  const prefix = config.commandPrefix.trim();
  return prefix || DEFAULT_COMMAND_PREFIX;
};

const resolveBotIdentityCandidates = (sockUser = {}) => {
  const candidates = new Set();
  const addCandidate = (value) => {
    const normalized = normalizeJid(String(value || '').trim());
    if (!normalized) return;
    candidates.add(normalized);
  };

  addCandidate(sockUser?.id);
  addCandidate(sockUser?.jid);
  addCandidate(sockUser?.lid);
  addCandidate(resolveBotJid(sockUser?.id));

  return Array.from(candidates);
};

const formatRemainingMinutesLabel = (remainingMs) => {
  const safeMs = Math.max(0, Number(remainingMs) || 0);
  const remainingMinutes = Math.ceil(safeMs / (60 * 1000));
  return Math.max(1, remainingMinutes);
};

const formatStickerFocusRuleLabel = ({ messageAllowanceCount, messageCooldownMinutes }) => {
  const allowanceCount = Math.max(1, Math.floor(Number(messageAllowanceCount) || 1));
  const cooldownMinutes = Math.max(1, Math.floor(Number(messageCooldownMinutes) || 1));
  const messageLabel = allowanceCount === 1 ? 'mensagem' : 'mensagens';
  return `${allowanceCount} ${messageLabel} a cada ${cooldownMinutes} min`;
};

/**
 * Executa um comando com tratamento de erro.
 * Captura erros síncronos e promessas rejeitadas.
 */
const runCommand = (label, handler) => {
  try {
    return Promise.resolve(handler())
      .then(() => ({ ok: true }))
      .catch((error) => {
        logger.error(`Erro ao executar comando ${label}:`, error?.message);
        return { ok: false, error };
      });
  } catch (error) {
    logger.error(`Erro ao executar comando ${label}:`, error?.message);
    return Promise.resolve({ ok: false, error });
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

const buildCommandErrorHelpText = async ({
  command,
  commandRoute,
  commandPrefix,
  isGroupMessage,
  isSenderAdmin,
  isSenderOwner,
}) => {
  const normalizedCommand = String(command || '')
    .trim()
    .toLowerCase();
  if (!normalizedCommand) return '';

  if (commandRoute === 'unknown') {
    return '';
  }

  try {
    const helpResult = await explicarComandoGlobal(normalizedCommand, {
      commandPrefix,
      isGroupMessage,
      isSenderAdmin,
      isSenderOwner,
    });
    return String(helpResult?.text || '').trim();
  } catch (error) {
    logger.warn('Falha ao gerar ajuda IA para erro de comando.', {
      action: 'command_error_ai_help_failed',
      command: normalizedCommand,
      commandRoute,
      error: error?.message,
    });
    return '';
  }
};

const persistMessageAnalysisEvent = (payload) => {
  if (!MESSAGE_ANALYTICS_ENABLED) return;
  void createMessageAnalysisEvent(payload).catch((error) => {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      if (messageAnalyticsTableMissingLogged) return;
      messageAnalyticsTableMissingLogged = true;
      logger.warn(
        'Tabela de analytics de mensagens ainda não existe. Execute a migracao 20260301_0028.',
        {
          action: 'message_analysis_table_missing',
        },
      );
      return;
    }

    logger.warn('Falha ao persistir analytics de mensagem.', {
      action: 'message_analysis_insert_failed',
      error: error?.message,
    });
  });
};

const buildSiteLoginUrlForUser = (canonicalUserId) =>
  buildWhatsAppGoogleLoginUrl({ userId: canonicalUserId }) || SITE_LOGIN_URL;

const ensureUserHasGoogleWebLoginForCommand = async ({
  sock,
  messageInfo,
  senderJid,
  remoteJid,
  expirationMessage,
  commandPrefix,
}) => {
  const isGroupMessage = isGroupJid(remoteJid);
  const canonicalUserId = await resolveCanonicalSenderJidFromMessage({ messageInfo, senderJid });
  let linked = false;
  try {
    linked = await isWhatsAppUserLinkedToGoogleWebAccount({
      ownerJid: canonicalUserId || senderJid,
    });
  } catch (error) {
    logger.warn(
      'Falha ao validar vínculo Google Web para comando do WhatsApp. Comando liberado por fallback.',
      {
        action: 'whatsapp_command_google_link_check_failed',
        error: error?.message,
      },
    );
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

  const loginUrl = isGroupMessage
    ? SITE_GROUP_LOGIN_URL
    : buildSiteLoginUrlForUser(canonicalUserId || senderJid);
  const loginMessage = isGroupMessage
    ? `Para usar os comandos do bot, você precisa estar logado no site com sua conta Google.\n\nAcesse:\n${loginUrl}`
    : `Para usar os comandos do bot, você precisa estar logado no site com sua conta Google.\n\nCadastre-se / faça login em:\n${loginUrl}\n\nDepois volte aqui e envie o comando novamente (ex.: ${commandPrefix}menu).`;

  await sendReply(sock, remoteJid, messageInfo, expirationMessage, {
    text: loginMessage,
  });

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
      const upsertType = update?.type || null;
      const isNotifyUpsert = upsertType === 'notify';

      for (const messageInfo of update.messages) {
        const key = messageInfo?.key || {};
        const remoteJid = key?.remoteJid;
        if (!remoteJid) continue;

        const isGroupMessage = isGroupJid(remoteJid);
        const extractedText = extractMessageContent(messageInfo);
        const { senderJid, senderIdentity, addressingMode } = await resolveSenderContext({
          messageInfo,
          isGroupMessage,
          remoteJid,
        });

        const senderName = messageInfo?.pushName;
        const expirationMessage = getExpiration(messageInfo);
        const botJidCandidates = resolveBotIdentityCandidates(sock?.user || {});
        const botJid = botJidCandidates[0] || null;
        const isMessageFromBot =
          Boolean(key?.fromMe) ||
          botJidCandidates.some((candidate) => isSameJidUser(senderJid, candidate));
        let commandPrefix = DEFAULT_COMMAND_PREFIX;
        let groupConfig = null;
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
          messageId: key?.id || null,
          chatId: remoteJid || null,
          senderId: senderJid || null,
          senderName,
          upsertType,
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
            upsert_type: upsertType,
            is_notify_upsert: isNotifyUpsert,
            is_history_append: upsertType === 'append',
            addressing_mode: addressingMode || null,
            participant_alt: key?.participantAlt || null,
            remote_jid_alt: key?.remoteJidAlt || null,
          },
        };

        try {
          const isStatusBroadcast = remoteJid === 'status@broadcast';
          const isStubMessage = typeof messageInfo?.messageStubType === 'number';
          const isProtocolMessage = Boolean(messageInfo?.message?.protocolMessage);
          const isMissingMessage = !messageInfo?.message;

          if (isStatusBroadcast || isStubMessage || isProtocolMessage || isMissingMessage) {
            analysisPayload.processingResult = 'ignored_unprocessable';
            analysisPayload.metadata = {
              ...analysisPayload.metadata,
              ignored_reason: isStatusBroadcast
                ? 'status_broadcast'
                : isStubMessage
                  ? 'stub_message'
                  : isProtocolMessage
                    ? 'protocol_message'
                    : 'missing_message_node',
            };
            continue;
          }

          if (isGroupMessage) {
            const shouldSkip = await handleAntiLink({
              sock,
              messageInfo,
              extractedText,
              remoteJid,
              senderJid,
              senderIdentity,
              botJid,
            });
            if (shouldSkip) {
              analysisPayload.processingResult = 'blocked_antilink';
              analysisPayload.metadata = {
                ...analysisPayload.metadata,
                blocked_by: 'anti_link',
              };
              continue;
            }

            groupConfig = await groupConfigStore.getGroupConfig(remoteJid);
            commandPrefix = await resolveCommandPrefix(true, remoteJid, groupConfig);
            analysisPayload.commandPrefix = commandPrefix;
          }

          if (isGroupMessage && !isMessageFromBot) {
            await resolveCaptchaByMessage({
              groupId: remoteJid,
              senderJid,
              senderIdentity,
              messageKey: key,
              messageInfo,
              extractedText,
            });
          }

          const handledStartLogin = isNotifyUpsert
            ? await maybeHandleStartLoginMessage({
                sock,
                messageInfo,
                extractedText,
                senderName,
                senderJid,
                remoteJid,
                expirationMessage,
                isMessageFromBot,
                isGroupMessage,
              })
            : false;

          if (handledStartLogin) {
            analysisPayload.processingResult = 'handled_start_login';
            analysisPayload.metadata = {
              ...analysisPayload.metadata,
              flow: 'whatsapp_google_login',
            };
            continue;
          }

          const hasCommandPrefix = extractedText.startsWith(commandPrefix);
          const isCommandMessage = hasCommandPrefix && isNotifyUpsert;
          analysisPayload.isCommand = isCommandMessage;
          analysisPayload.commandPrefix = commandPrefix;

          if (hasCommandPrefix && !isNotifyUpsert) {
            analysisPayload.metadata = {
              ...analysisPayload.metadata,
              command_suppressed_reason: 'non_notify_upsert',
            };
          }

          if (isGroupMessage && !isCommandMessage && !isMessageFromBot) {
            const activeGroupConfig =
              groupConfig || (await groupConfigStore.getGroupConfig(remoteJid));
            groupConfig = activeGroupConfig;
            const stickerFocusState = resolveStickerFocusState(activeGroupConfig);

            if (stickerFocusState.enabled) {
              const messageClassification = resolveStickerFocusMessageClassification({
                messageInfo,
                extractedText,
                mediaEntries,
              });

              if (messageClassification.isThrottleCandidate) {
                const senderIsAdmin = await isUserAdmin(remoteJid, senderJid);
                if (!senderIsAdmin && !stickerFocusState.isChatWindowOpen) {
                  const messageGate = canSendMessageInStickerFocus({
                    groupId: remoteJid,
                    senderJid,
                    messageCooldownMs: stickerFocusState.messageCooldownMs,
                    messageAllowanceCount: stickerFocusState.messageAllowanceCount,
                  });

                  if (!messageGate.allowed) {
                    analysisPayload.processingResult = 'blocked_sticker_focus_message';
                    analysisPayload.metadata = {
                      ...analysisPayload.metadata,
                      blocked_by: 'sticker_focus_mode',
                      sticker_focus_message_type: messageClassification.messageType,
                      sticker_focus_message_allowance_count:
                        stickerFocusState.messageAllowanceCount,
                      sticker_focus_message_cooldown_minutes:
                        stickerFocusState.messageCooldownMinutes,
                      sticker_focus_remaining_minutes: formatRemainingMinutesLabel(
                        messageGate.remainingMs,
                      ),
                      sticker_focus_alert_only: true,
                    };

                    if (shouldSendStickerFocusWarning({ groupId: remoteJid, senderJid })) {
                      try {
                        await sendReply(sock, remoteJid, messageInfo, expirationMessage, {
                          text:
                            '🖼️ Este chat está com *foco em sticker* ativo.\n' +
                            'Siga o padrão: envie apenas *imagens* ou *vídeos* para criação automática, ou compartilhe seus *stickers*.\n' +
                            `Mensagens como texto e áudio seguem uma janela de tempo: *${formatStickerFocusRuleLabel(stickerFocusState)}*.\n` +
                            `Tente novamente em ~${formatRemainingMinutesLabel(messageGate.remainingMs)} min ou peça para um admin abrir a janela com *${commandPrefix}chatwindow on*.`,
                        });
                      } catch (error) {
                        logger.warn('Falha ao enviar aviso de sticker focus.', {
                          action: 'sticker_focus_warning_failed',
                          groupId: remoteJid,
                          senderJid,
                          error: error?.message,
                        });
                      }
                    }

                    continue;
                  }

                  registerMessageUsageInStickerFocus({
                    groupId: remoteJid,
                    senderJid,
                    messageCooldownMs: stickerFocusState.messageCooldownMs,
                    messageAllowanceCount: stickerFocusState.messageAllowanceCount,
                  });
                }
              }
            }
          }

          let cachedToolSecurityContext = null;
          const resolveToolSecurityContext = async () => {
            if (cachedToolSecurityContext) return cachedToolSecurityContext;

            let isSenderAdmin = false;
            if (isGroupMessage) {
              try {
                isSenderAdmin = await isUserAdmin(remoteJid, senderIdentity);
              } catch (error) {
                logger.warn('Falha ao resolver permissao admin para tool execution.', {
                  action: 'tool_security_admin_check_failed',
                  remoteJid,
                  senderJid,
                  error: error?.message,
                });
              }
            }

            let isSenderOwner = false;
            try {
              isSenderOwner = await isAdminSenderAsync(senderIdentity);
            } catch (error) {
              logger.warn('Falha ao resolver admin principal para tool execution.', {
                action: 'tool_security_owner_check_failed',
                remoteJid,
                senderJid,
                error: error?.message,
              });
            }

            let hasGoogleLogin;
            if (!isMessageFromBot && WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN) {
              try {
                const canonicalSenderJid = await resolveCanonicalSenderJidFromMessage({
                  messageInfo,
                  senderJid,
                });
                if (canonicalSenderJid) {
                  hasGoogleLogin = await isWhatsAppUserLinkedToGoogleWebAccount(canonicalSenderJid);
                }
              } catch (error) {
                logger.warn('Falha ao resolver estado de login para tool execution.', {
                  action: 'tool_security_google_login_check_failed',
                  remoteJid,
                  senderJid,
                  error: error?.message,
                });
              }
            }

            cachedToolSecurityContext = {
              isGroupMessage,
              isSenderAdmin,
              isSenderOwner,
              hasGoogleLogin,
            };
            return cachedToolSecurityContext;
          };

          const executeToolCommandFromConversation = async ({
            commandName,
            args = [],
            text = '',
          } = {}) => {
            const normalizedCommand = String(commandName || '')
              .trim()
              .toLowerCase();
            if (!normalizedCommand) {
              return {
                ok: false,
                alreadyResponded: false,
                text: 'Comando invalido na tool call.',
              };
            }

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
                return {
                  ok: false,
                  alreadyResponded: true,
                  text: '',
                  errorCode: 'auth_required',
                };
              }
            }

            const commandExecution = await executeMessageCommandRoute({
              command: normalizedCommand,
              args: Array.isArray(args) ? args : [],
              text: String(text || ''),
              isAdminCommandRoute: isAdminCommand(normalizedCommand),
              sock,
              remoteJid,
              messageInfo,
              expirationMessage,
              senderJid,
              senderName,
              senderIdentity,
              botJid,
              isGroupMessage,
              commandPrefix,
              runCommand,
              sendReply,
            });

            const commandRoute = commandExecution?.commandRoute || 'unknown';
            const commandResult = commandExecution?.commandResult || { ok: false };
            return {
              ok: commandResult.ok && commandRoute !== 'unknown',
              commandRoute,
              alreadyResponded: commandResult.ok || commandRoute === 'unknown',
              text: '',
              error: commandResult?.error || null,
            };
          };

          if (!isCommandMessage && !isMessageFromBot && isNotifyUpsert) {
            try {
              const conversationResult = await routeConversationMessage({
                messageInfo,
                extractedText,
                isCommandMessage,
                mediaEntries,
                isGroupMessage,
                remoteJid,
                senderJid,
                botJid,
                botJidCandidates,
                commandPrefix,
                toolCommandExecutor: executeToolCommandFromConversation,
                resolveToolSecurityContext,
              });

              if (conversationResult?.handled) {
                if (conversationResult?.text) {
                  await sendReply(sock, remoteJid, messageInfo, expirationMessage, {
                    text: conversationResult.text,
                  });
                }

                analysisPayload.processingResult = 'conversation_reply';
                analysisPayload.metadata = {
                  ...analysisPayload.metadata,
                  conversation_router: true,
                  conversation_reason: conversationResult.reason || null,
                  conversation_trigger_kind: conversationResult?.metadata?.trigger_kind || null,
                  conversation_intent_type: conversationResult?.metadata?.intent_type || null,
                  conversation_module_key: conversationResult?.metadata?.module_key || null,
                  conversation_command_name: conversationResult?.metadata?.command_name || null,
                  conversation_suppress_reply: Boolean(
                    conversationResult?.metadata?.suppress_reply,
                  ),
                };
                continue;
              }
            } catch (error) {
              logger.warn('Falha ao processar rota conversacional global.', {
                action: 'conversation_router_failed',
                remoteJid,
                senderJid,
                isGroupMessage,
                error: error?.message,
              });
            }
          }

          if (isCommandMessage) {
            const commandBody = extractedText.substring(commandPrefix.length);
            const match = commandBody.match(/^(\S+)([\s\S]*)$/);
            const command = match ? match[1].toLowerCase() : '';
            const rawArgs = match && match[2] !== undefined ? match[2].trim() : '';
            const args = rawArgs ? rawArgs.split(/\s+/) : [];
            const text = match && match[2] !== undefined ? match[2] : '';
            const isAdminCommandRoute = isAdminCommand(command);
            const isKnownCommand = KNOWN_MESSAGE_COMMANDS.has(command) || isAdminCommandRoute;

            analysisPayload.commandName = command || null;
            analysisPayload.commandArgsCount = args.length;
            analysisPayload.commandKnown = isKnownCommand;

            if (isDuplicateCommandExecution(remoteJid, key?.id)) {
              analysisPayload.processingResult = 'duplicate_command_ignored';
              analysisPayload.metadata = {
                ...analysisPayload.metadata,
                dedupe_ttl_ms: MESSAGE_COMMAND_DEDUPE_TTL_MS,
              };
              continue;
            }
            markCommandExecution(remoteJid, key?.id);

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
                    key,
                  },
                });
              } catch (error) {
                logger.warn('Falha ao enviar reação de comando:', error?.message);
              }
            }

            const execution = await executeMessageCommandRoute({
              command,
              args,
              text,
              isAdminCommandRoute,
              sock,
              remoteJid,
              messageInfo,
              expirationMessage,
              senderJid,
              senderName,
              senderIdentity,
              botJid,
              isGroupMessage,
              commandPrefix,
              runCommand,
              sendReply,
            });
            const commandResult = execution?.commandResult || { ok: false };
            const commandRoute = execution?.commandRoute || 'unknown';
            if (commandRoute === 'unknown') {
              analysisPayload.processingResult = 'unknown_command';
            }

            analysisPayload.metadata = {
              ...analysisPayload.metadata,
              command_route: commandRoute,
            };

            if (analysisPayload.processingResult === 'processed') {
              analysisPayload.processingResult = commandResult.ok
                ? 'command_executed'
                : 'command_error';
            }

            if (commandResult.ok && commandRoute !== 'unknown') {
              try {
                await registerGlobalHelpCommandExecution({
                  chatId: remoteJid,
                  userId: senderJid,
                  isGroupMessage,
                  executedCommand: command,
                });
              } catch (error) {
                logger.warn('Falha ao registrar feedback de sugestao global.', {
                  action: 'global_help_feedback_register_failed',
                  command,
                  commandRoute,
                  remoteJid,
                  senderJid,
                  error: error?.message,
                });
              }
            }

            if (!commandResult.ok) {
              analysisPayload.errorCode = normalizeAnalysisErrorCode(commandResult.error);
              let senderIsAdminForHelp = false;
              if (isGroupMessage) {
                try {
                  senderIsAdminForHelp = await isUserAdmin(remoteJid, senderIdentity);
                } catch (error) {
                  logger.warn('Falha ao resolver permissao de admin para ajuda de comando.', {
                    action: 'command_error_help_admin_check_failed',
                    command,
                    remoteJid,
                    senderJid,
                    error: error?.message,
                  });
                }
              }

              const commandErrorHelpText = await buildCommandErrorHelpText({
                command,
                commandRoute,
                commandPrefix,
                isGroupMessage,
                isSenderAdmin: senderIsAdminForHelp,
              });

              const fallbackErrorText = commandErrorHelpText
                ? `❌ Houve um erro ao processar *${commandPrefix}${command}*.\n\n${commandErrorHelpText}`
                : `❌ Houve um erro ao processar *${commandPrefix}${command}*.\n\nTente novamente ou use *${commandPrefix}menu* para validar o formato de uso.`;

              await runCommand('command-error-help', () =>
                sendReply(sock, remoteJid, messageInfo, expirationMessage, {
                  text: fallbackErrorText,
                }),
              );
            }
          }

          if (!isMessageFromBot) {
            await runCommand('pack-capture', () =>
              maybeCaptureIncomingSticker({
                messageInfo,
                senderJid,
                isMessageFromBot,
              }),
            );
          }

          if (isGroupMessage && !isCommandMessage && !isMessageFromBot) {
            const autoStickerMedia = extractSupportedStickerMediaDetails(messageInfo, {
              includeQuoted: false,
            });

            if (autoStickerMedia && autoStickerMedia.mediaType !== 'sticker') {
              const activeGroupConfig =
                groupConfig || (await groupConfigStore.getGroupConfig(remoteJid));
              groupConfig = activeGroupConfig;
              if (activeGroupConfig.autoStickerEnabled) {
                analysisPayload.processingResult = 'autosticker_triggered';
                analysisPayload.metadata = {
                  ...analysisPayload.metadata,
                  auto_sticker_media_type: autoStickerMedia.mediaType || null,
                };
                const autoStickerResult = await runCommand('autosticker', () =>
                  processSticker(
                    sock,
                    messageInfo,
                    senderJid,
                    remoteJid,
                    expirationMessage,
                    senderName,
                    '',
                    {
                      includeQuotedMedia: false,
                      showAutoPackNotice: false,
                      commandPrefix,
                    },
                  ),
                );

                if (!autoStickerResult.ok) {
                  analysisPayload.errorCode = normalizeAnalysisErrorCode(autoStickerResult.error);
                }
              }
            }
          }
        } catch (messageError) {
          analysisPayload.processingResult = 'error';
          analysisPayload.errorCode = normalizeAnalysisErrorCode(messageError);
          logger.error('Erro ao processar mensagem individual:', {
            error: messageError?.message,
            messageId: key?.id || null,
            remoteJid,
          });
        } finally {
          persistMessageAnalysisEvent(analysisPayload);
        }
      }
    } catch (error) {
      logger.error('Erro ao processar mensagens:', error?.message);
    }
  } else {
    logger.info('🔄 Processando evento recebido:', {
      eventType: update?.type || 'unknown',
      eventData: update,
    });
  }
};
