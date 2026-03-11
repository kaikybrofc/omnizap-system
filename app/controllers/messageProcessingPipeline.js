import 'dotenv/config';

import { isAdminCommand } from '../modules/adminModule/groupCommandHandlers.js';
import { explicarComandoGlobal, registerGlobalHelpCommandExecution } from '../services/ai/globalModuleAiHelpService.js';
import { extractSupportedStickerMediaDetails, processSticker } from '../modules/stickerModule/stickerCommand.js';
import { detectAllMediaTypes, extractMessageContent, getExpiration, getJidServer, isGroupJid, isStatusJid, isSameJidUser, normalizeJid, normalizeWAPresence, resolveBotJid, extractSenderInfoFromMessage, resolveUserId, resolveAddressingModeFromMessageKey, resolveCanonicalWhatsAppJid, parseEnvBool, parseEnvInt } from '../config/index.js';
import { isUserAdmin } from '../config/index.js';
import { isAdminSenderAsync } from '../config/index.js';
import { executeQuery, TABLES } from '../../database/index.js';
import logger from '#logger';
import { handleAntiLink } from '../utils/antiLink/antiLinkModule.js';
import { maybeCaptureIncomingSticker } from '../modules/stickerPackModule/stickerPackCommandHandlers.js';
import groupConfigStore from '../store/groupConfigStore.js';
import { sendAndStore } from '../configParts/messagePersistenceService.js';
import { resolveCaptchaByMessage } from '../services/messaging/captchaService.js';
import { buildWhatsAppGoogleLoginUrl } from '../services/auth/whatsappLoginLinkService.js';
import { isWhatsAppUserLinkedToGoogleWebAccount } from '../services/auth/googleWebLinkService.js';
import { createMessageAnalysisEvent } from '../modules/analyticsModule/messageAnalysisEventRepository.js';
import { routeConversationMessage } from '../services/ai/conversationRouterService.js';
import { executeMessageCommandRoute, isKnownNonAdminCommand } from '../services/ai/messageCommandExecutionService.js';
import { canSendMessageInStickerFocus, registerMessageUsageInStickerFocus, resolveStickerFocusMessageClassification, resolveStickerFocusState, shouldSendStickerFocusWarning } from '../services/sticker/stickerFocusService.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const COMMAND_REACT_EMOJI = process.env.COMMAND_REACT_EMOJI || '🤖';
const START_LOGIN_TRIGGER =
  String(process.env.WHATSAPP_LOGIN_TRIGGER || 'iniciar')
    .trim()
    .toLowerCase() || 'iniciar';
const MESSAGE_ANALYTICS_ENABLED = parseEnvBool(process.env.MESSAGE_ANALYTICS_ENABLED, true);
const MESSAGE_ANALYTICS_SOURCE =
  String(process.env.MESSAGE_ANALYTICS_SOURCE || 'whatsapp')
    .trim()
    .slice(0, 32) || 'whatsapp';
const MESSAGE_COMMAND_DEDUPE_TTL_MS = parseEnvInt(process.env.MESSAGE_COMMAND_DEDUPE_TTL_MS, 120_000, 15_000, 30 * 60 * 1000);
const MESSAGE_REPLY_PRESENCE_BEFORE = normalizeWAPresence(process.env.MESSAGE_REPLY_PRESENCE_BEFORE, 'composing');
const MESSAGE_REPLY_PRESENCE_AFTER = normalizeWAPresence(process.env.MESSAGE_REPLY_PRESENCE_AFTER, 'paused');
const MESSAGE_REPLY_PRESENCE_DELAY_MS = parseEnvInt(process.env.MESSAGE_REPLY_PRESENCE_DELAY_MS, 280, 0, 3_000);
const MESSAGE_REPLY_PRESENCE_SUBSCRIBE = parseEnvBool(process.env.MESSAGE_REPLY_PRESENCE_SUBSCRIBE, true);
const WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN = parseEnvBool(process.env.WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN, true);
const SITE_ORIGIN =
  String(process.env.SITE_ORIGIN || process.env.WHATSAPP_LOGIN_BASE_URL || 'https://omnizap.shop')
    .trim()
    .replace(/\/+$/, '') || 'https://omnizap.shop';
const SITE_LOGIN_URL = `${SITE_ORIGIN}/login/`;
const SITE_GROUP_LOGIN_URL = `${SITE_ORIGIN}/login`;

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

const resolveCanonicalSenderJidFromMessage = async ({ messageInfo, senderJid }) => {
  const key = messageInfo?.key || {};
  const senderInfo = extractSenderInfoFromMessage(messageInfo);
  let canonicalUserId = resolveCanonicalWhatsAppJid(senderInfo?.jid, senderInfo?.remoteJidAlt, senderInfo?.participantAlt, key.remoteJidAlt, key.participantAlt, key.participant, key.remoteJid, senderJid);

  try {
    const resolvedUserId = await resolveUserId(senderInfo);
    canonicalUserId = resolveCanonicalWhatsAppJid(resolvedUserId, canonicalUserId, senderInfo?.jid, senderInfo?.remoteJidAlt, senderInfo?.participantAlt);
  } catch (error) {
    logger.warn('Falha ao resolver ID canonico do remetente.', {
      action: 'resolve_sender_canonical_id_failed',
      error: error?.message,
    });
  }

  return canonicalUserId;
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

  const senderJidCandidates = isGroupMessage ? [resolvedUserId, senderInfo?.jid, senderInfo?.participantAlt, key.participantAlt, key.participant, key.remoteJidAlt, remoteJid] : [resolvedUserId, senderInfo?.jid, senderInfo?.participantAlt, key.remoteJidAlt, key.remoteJid, remoteJid];

  const canonicalSender = resolveCanonicalWhatsAppJid(...senderJidCandidates);
  const fallbackSender = senderJidCandidates.find((candidate) => String(candidate || '').trim()) || '';
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
    presenceBefore: MESSAGE_REPLY_PRESENCE_BEFORE,
    presenceAfter: MESSAGE_REPLY_PRESENCE_AFTER,
    presenceDelayMs: MESSAGE_REPLY_PRESENCE_DELAY_MS,
    presenceSubscribe: MESSAGE_REPLY_PRESENCE_SUBSCRIBE,
    ...(options || {}),
  });

const maybeHandleStartLoginMessage = async ({ sock, messageInfo, extractedText, senderName, senderJid, remoteJid, expirationMessage, isMessageFromBot, isGroupMessage }) => {
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
    text: `${greeting}\n\n` + 'Para continuar no OmniZap, faca login com Google neste link:\n' + `${loginUrl}\n\n` + 'Seu numero do WhatsApp sera vinculado automaticamente a conta logada.',
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

const buildCommandErrorHelpText = async ({ command, commandRoute, commandPrefix, isGroupMessage, isSenderAdmin, isSenderOwner }) => {
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

const ensureUserHasGoogleWebLoginForCommand = async ({ sock, messageInfo, senderJid, remoteJid, expirationMessage, commandPrefix, canonicalUserId = '' }) => {
  const isGroupMessage = isGroupJid(remoteJid);
  const normalizedCanonicalUserId = String(canonicalUserId || '').trim();
  const resolvedCanonicalUserId = normalizedCanonicalUserId || (await resolveCanonicalSenderJidFromMessage({ messageInfo, senderJid }));
  let linked = false;
  try {
    linked = await isWhatsAppUserLinkedToGoogleWebAccount({
      ownerJid: resolvedCanonicalUserId || senderJid,
    });
  } catch (error) {
    logger.warn('Falha ao validar vínculo Google Web para comando do WhatsApp. Comando liberado por fallback.', {
      action: 'whatsapp_command_google_link_check_failed',
      error: error?.message,
    });
    return {
      allowed: true,
      canonicalUserId: resolvedCanonicalUserId,
      loginUrl: '',
    };
  }

  if (linked) {
    return {
      allowed: true,
      canonicalUserId: resolvedCanonicalUserId,
      loginUrl: '',
    };
  }

  const loginUrl = isGroupMessage ? SITE_GROUP_LOGIN_URL : buildSiteLoginUrlForUser(resolvedCanonicalUserId || senderJid);
  const loginMessage = isGroupMessage ? `Para usar os comandos do bot, você precisa estar logado no site com sua conta Google.\n\nAcesse:\n${loginUrl}` : `Para usar os comandos do bot, você precisa estar logado no site com sua conta Google.\n\nCadastre-se / faça login em:\n${loginUrl}\n\nDepois volte aqui e envie o comando novamente (ex.: ${commandPrefix}menu).`;

  await sendReply(sock, remoteJid, messageInfo, expirationMessage, {
    text: loginMessage,
  });

  return {
    allowed: false,
    canonicalUserId: resolvedCanonicalUserId,
    loginUrl,
  };
};

const mergeAnalysisMetadata = (analysisPayload, metadataPatch = {}) => {
  if (!metadataPatch || typeof metadataPatch !== 'object') return;
  analysisPayload.metadata = {
    ...analysisPayload.metadata,
    ...metadataPatch,
  };
};

const stopMessagePipeline = (ctx, processingResult = '', metadataPatch = null) => {
  if (processingResult) {
    ctx.analysisPayload.processingResult = processingResult;
  }
  if (metadataPatch) {
    mergeAnalysisMetadata(ctx.analysisPayload, metadataPatch);
  }
  ctx.pipelineStopped = true;
  return { stop: true };
};

const ensureGroupConfigForContext = async (ctx) => {
  if (!ctx.isGroupMessage) return null;
  if (ctx.groupConfigLoaded) return ctx.groupConfig;
  ctx.groupConfigLoaded = true;
  ctx.groupConfig = await groupConfigStore.getGroupConfig(ctx.remoteJid);
  return ctx.groupConfig;
};

const ensureCommandPrefixForContext = async (ctx) => {
  if (!ctx.isGroupMessage) {
    ctx.commandPrefix = DEFAULT_COMMAND_PREFIX;
  } else {
    const activeGroupConfig = await ensureGroupConfigForContext(ctx);
    ctx.commandPrefix = await resolveCommandPrefix(true, ctx.remoteJid, activeGroupConfig);
  }
  ctx.analysisPayload.commandPrefix = ctx.commandPrefix;
  return ctx.commandPrefix;
};

const resolveCanonicalSenderJidForContext = async (ctx) => {
  if (!ctx.memo.canonicalSenderJidPromise) {
    ctx.memo.canonicalSenderJidPromise = resolveCanonicalSenderJidFromMessage({
      messageInfo: ctx.messageInfo,
      senderJid: ctx.senderJid,
    });
  }
  return ctx.memo.canonicalSenderJidPromise;
};

const createMessagePipelineContext = async ({ messageInfo, upsertType, isNotifyUpsert, sock }) => {
  const key = messageInfo?.key || {};
  const remoteJid = key?.remoteJid;
  if (!remoteJid) return null;

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
  const isMessageFromBot = Boolean(key?.fromMe) || botJidCandidates.some((candidate) => isSameJidUser(senderJid, candidate));
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
    commandPrefix: DEFAULT_COMMAND_PREFIX,
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

  return {
    sock,
    messageInfo,
    key,
    remoteJid,
    isGroupMessage,
    extractedText,
    senderJid,
    senderIdentity,
    senderName,
    expirationMessage,
    botJidCandidates,
    botJid,
    isMessageFromBot,
    commandPrefix: DEFAULT_COMMAND_PREFIX,
    groupConfig: null,
    groupConfigLoaded: false,
    mediaEntries,
    upsertType,
    isNotifyUpsert,
    isCommandMessage: false,
    hasCommandPrefix: false,
    analysisPayload,
    pipelineStopped: false,
    memo: Object.create(null),
  };
};

const touchSenderLastSeenMiddleware = async (ctx) => {
  if (!ctx.senderJid || isStatusJid(ctx.remoteJid)) return;

  void executeQuery(`UPDATE ${TABLES.RPG_PLAYER} SET updated_at = CURRENT_TIMESTAMP WHERE jid = ?`, [ctx.senderJid]).catch(() => {});
  void executeQuery(`UPDATE web_google_user SET last_seen_at = CURRENT_TIMESTAMP WHERE owner_jid = ?`, [ctx.senderJid]).catch(() => {});
};

const ignoreUnprocessableMessageMiddleware = async (ctx) => {
  const isStatusBroadcast = ctx.remoteJid === 'status@broadcast';
  const isStubMessage = typeof ctx.messageInfo?.messageStubType === 'number';
  const isProtocolMessage = Boolean(ctx.messageInfo?.message?.protocolMessage);
  const isMissingMessage = !ctx.messageInfo?.message;

  if (!isStatusBroadcast && !isStubMessage && !isProtocolMessage && !isMissingMessage) {
    return null;
  }

  return stopMessagePipeline(ctx, 'ignored_unprocessable', {
    ignored_reason: isStatusBroadcast ? 'status_broadcast' : isStubMessage ? 'stub_message' : isProtocolMessage ? 'protocol_message' : 'missing_message_node',
  });
};

const applyGroupPolicyMiddleware = async (ctx) => {
  if (!ctx.isGroupMessage) return null;

  const shouldSkip = await handleAntiLink({
    sock: ctx.sock,
    messageInfo: ctx.messageInfo,
    extractedText: ctx.extractedText,
    remoteJid: ctx.remoteJid,
    senderJid: ctx.senderJid,
    senderIdentity: ctx.senderIdentity,
    botJid: ctx.botJid,
  });
  if (shouldSkip) {
    return stopMessagePipeline(ctx, 'blocked_antilink', {
      blocked_by: 'anti_link',
    });
  }

  await ensureCommandPrefixForContext(ctx);
  return null;
};

const resolveCaptchaMiddleware = async (ctx) => {
  if (!ctx.isGroupMessage || ctx.isMessageFromBot) return;

  await resolveCaptchaByMessage({
    groupId: ctx.remoteJid,
    senderJid: ctx.senderJid,
    senderIdentity: ctx.senderIdentity,
    messageKey: ctx.key,
    messageInfo: ctx.messageInfo,
    extractedText: ctx.extractedText,
  });
};

const handleStartLoginTriggerMiddleware = async (ctx) => {
  if (!ctx.isNotifyUpsert) return null;

  const handledStartLogin = await maybeHandleStartLoginMessage({
    sock: ctx.sock,
    messageInfo: ctx.messageInfo,
    extractedText: ctx.extractedText,
    senderName: ctx.senderName,
    senderJid: ctx.senderJid,
    remoteJid: ctx.remoteJid,
    expirationMessage: ctx.expirationMessage,
    isMessageFromBot: ctx.isMessageFromBot,
    isGroupMessage: ctx.isGroupMessage,
  });

  if (!handledStartLogin) return null;
  return stopMessagePipeline(ctx, 'handled_start_login', {
    flow: 'whatsapp_google_login',
  });
};

const detectCommandIntentMiddleware = async (ctx) => {
  ctx.hasCommandPrefix = ctx.extractedText.startsWith(ctx.commandPrefix);
  ctx.isCommandMessage = ctx.hasCommandPrefix && ctx.isNotifyUpsert;

  ctx.analysisPayload.isCommand = ctx.isCommandMessage;
  ctx.analysisPayload.commandPrefix = ctx.commandPrefix;

  if (ctx.hasCommandPrefix && !ctx.isNotifyUpsert) {
    mergeAnalysisMetadata(ctx.analysisPayload, {
      command_suppressed_reason: 'non_notify_upsert',
    });
  }
};

const applyStickerFocusMiddleware = async (ctx) => {
  if (!ctx.isGroupMessage || ctx.isCommandMessage || ctx.isMessageFromBot) return null;

  const activeGroupConfig = await ensureGroupConfigForContext(ctx);
  const stickerFocusState = resolveStickerFocusState(activeGroupConfig);
  if (!stickerFocusState.enabled) return null;

  const messageClassification = resolveStickerFocusMessageClassification({
    messageInfo: ctx.messageInfo,
    extractedText: ctx.extractedText,
    mediaEntries: ctx.mediaEntries,
  });
  if (!messageClassification.isThrottleCandidate) return null;

  const senderIsAdmin = await isUserAdmin(ctx.remoteJid, ctx.senderJid);
  if (senderIsAdmin || stickerFocusState.isChatWindowOpen) return null;

  const messageGate = canSendMessageInStickerFocus({
    groupId: ctx.remoteJid,
    senderJid: ctx.senderJid,
    messageCooldownMs: stickerFocusState.messageCooldownMs,
    messageAllowanceCount: stickerFocusState.messageAllowanceCount,
  });

  if (!messageGate.allowed) {
    ctx.analysisPayload.processingResult = 'blocked_sticker_focus_message';
    mergeAnalysisMetadata(ctx.analysisPayload, {
      blocked_by: 'sticker_focus_mode',
      sticker_focus_message_type: messageClassification.messageType,
      sticker_focus_message_allowance_count: stickerFocusState.messageAllowanceCount,
      sticker_focus_message_cooldown_minutes: stickerFocusState.messageCooldownMinutes,
      sticker_focus_remaining_minutes: formatRemainingMinutesLabel(messageGate.remainingMs),
      sticker_focus_alert_only: true,
    });

    if (shouldSendStickerFocusWarning({ groupId: ctx.remoteJid, senderJid: ctx.senderJid })) {
      try {
        await sendReply(ctx.sock, ctx.remoteJid, ctx.messageInfo, ctx.expirationMessage, {
          text: '🖼️ Este chat está com *foco em sticker* ativo.\n' + 'Siga o padrão: envie apenas *imagens* ou *vídeos* para criação automática, ou compartilhe seus *stickers*.\n' + `Mensagens como texto e áudio seguem uma janela de tempo: *${formatStickerFocusRuleLabel(stickerFocusState)}*.\n` + `Tente novamente em ~${formatRemainingMinutesLabel(messageGate.remainingMs)} min ou peça para um admin abrir a janela com *${ctx.commandPrefix}chatwindow on*.`,
        });
      } catch (error) {
        logger.warn('Falha ao enviar aviso de sticker focus.', {
          action: 'sticker_focus_warning_failed',
          groupId: ctx.remoteJid,
          senderJid: ctx.senderJid,
          error: error?.message,
        });
      }
    }

    return stopMessagePipeline(ctx);
  }

  registerMessageUsageInStickerFocus({
    groupId: ctx.remoteJid,
    senderJid: ctx.senderJid,
    messageCooldownMs: stickerFocusState.messageCooldownMs,
    messageAllowanceCount: stickerFocusState.messageAllowanceCount,
  });

  return null;
};

const resolveToolSecurityContextForConversation = async (ctx) => {
  if (ctx.memo.toolSecurityContext) return ctx.memo.toolSecurityContext;

  let isSenderAdmin = false;
  if (ctx.isGroupMessage) {
    try {
      isSenderAdmin = await isUserAdmin(ctx.remoteJid, ctx.senderIdentity);
    } catch (error) {
      logger.warn('Falha ao resolver permissao admin para tool execution.', {
        action: 'tool_security_admin_check_failed',
        remoteJid: ctx.remoteJid,
        senderJid: ctx.senderJid,
        error: error?.message,
      });
    }
  }

  let isSenderOwner = false;
  try {
    isSenderOwner = await isAdminSenderAsync(ctx.senderIdentity);
  } catch (error) {
    logger.warn('Falha ao resolver admin principal para tool execution.', {
      action: 'tool_security_owner_check_failed',
      remoteJid: ctx.remoteJid,
      senderJid: ctx.senderJid,
      error: error?.message,
    });
  }

  let hasGoogleLogin;
  if (!ctx.isMessageFromBot && WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN) {
    try {
      const canonicalSenderJid = await resolveCanonicalSenderJidForContext(ctx);
      if (canonicalSenderJid) {
        hasGoogleLogin = await isWhatsAppUserLinkedToGoogleWebAccount(canonicalSenderJid);
      }
    } catch (error) {
      logger.warn('Falha ao resolver estado de login para tool execution.', {
        action: 'tool_security_google_login_check_failed',
        remoteJid: ctx.remoteJid,
        senderJid: ctx.senderJid,
        error: error?.message,
      });
    }
  }

  ctx.memo.toolSecurityContext = {
    isGroupMessage: ctx.isGroupMessage,
    isSenderAdmin,
    isSenderOwner,
    hasGoogleLogin,
  };
  return ctx.memo.toolSecurityContext;
};

const executeToolCommandFromConversation = async (ctx, { commandName, args = [], text = '' } = {}) => {
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

  if (!ctx.isMessageFromBot && WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN) {
    const authCheck = await ensureUserHasGoogleWebLoginForCommand({
      sock: ctx.sock,
      messageInfo: ctx.messageInfo,
      senderJid: ctx.senderJid,
      remoteJid: ctx.remoteJid,
      expirationMessage: ctx.expirationMessage,
      commandPrefix: ctx.commandPrefix,
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
    sock: ctx.sock,
    remoteJid: ctx.remoteJid,
    messageInfo: ctx.messageInfo,
    expirationMessage: ctx.expirationMessage,
    senderJid: ctx.senderJid,
    senderName: ctx.senderName,
    senderIdentity: ctx.senderIdentity,
    botJid: ctx.botJid,
    isGroupMessage: ctx.isGroupMessage,
    commandPrefix: ctx.commandPrefix,
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

const routeConversationMiddleware = async (ctx) => {
  if (ctx.isCommandMessage || ctx.isMessageFromBot || !ctx.isNotifyUpsert) return null;

  try {
    const conversationResult = await routeConversationMessage({
      messageInfo: ctx.messageInfo,
      extractedText: ctx.extractedText,
      isCommandMessage: ctx.isCommandMessage,
      mediaEntries: ctx.mediaEntries,
      isGroupMessage: ctx.isGroupMessage,
      remoteJid: ctx.remoteJid,
      senderJid: ctx.senderJid,
      botJid: ctx.botJid,
      botJidCandidates: ctx.botJidCandidates,
      commandPrefix: ctx.commandPrefix,
      toolCommandExecutor: (payload) => executeToolCommandFromConversation(ctx, payload),
      resolveToolSecurityContext: () => resolveToolSecurityContextForConversation(ctx),
    });

    if (!conversationResult?.handled) return null;

    if (conversationResult?.text) {
      await sendReply(ctx.sock, ctx.remoteJid, ctx.messageInfo, ctx.expirationMessage, {
        text: conversationResult.text,
      });
    }

    return stopMessagePipeline(ctx, 'conversation_reply', {
      conversation_router: true,
      conversation_reason: conversationResult.reason || null,
      conversation_trigger_kind: conversationResult?.metadata?.trigger_kind || null,
      conversation_intent_type: conversationResult?.metadata?.intent_type || null,
      conversation_module_key: conversationResult?.metadata?.module_key || null,
      conversation_command_name: conversationResult?.metadata?.command_name || null,
      conversation_suppress_reply: Boolean(conversationResult?.metadata?.suppress_reply),
    });
  } catch (error) {
    logger.warn('Falha ao processar rota conversacional global.', {
      action: 'conversation_router_failed',
      remoteJid: ctx.remoteJid,
      senderJid: ctx.senderJid,
      isGroupMessage: ctx.isGroupMessage,
      error: error?.message,
    });
  }

  return null;
};

const executeCommandMiddleware = async (ctx) => {
  if (!ctx.isCommandMessage) return null;

  const commandBody = ctx.extractedText.substring(ctx.commandPrefix.length);
  const match = commandBody.match(/^(\S+)([\s\S]*)$/);
  const command = match ? match[1].toLowerCase() : '';
  const rawArgs = match && match[2] !== undefined ? match[2].trim() : '';
  const args = rawArgs ? rawArgs.split(/\s+/) : [];
  const text = match && match[2] !== undefined ? match[2] : '';
  const isAdminCommandRoute = isAdminCommand(command);
  const isKnownCommand = isKnownNonAdminCommand(command) || isAdminCommandRoute;

  ctx.analysisPayload.commandName = command || null;
  ctx.analysisPayload.commandArgsCount = args.length;
  ctx.analysisPayload.commandKnown = isKnownCommand;

  if (isDuplicateCommandExecution(ctx.remoteJid, ctx.key?.id)) {
    return stopMessagePipeline(ctx, 'duplicate_command_ignored', {
      dedupe_ttl_ms: MESSAGE_COMMAND_DEDUPE_TTL_MS,
    });
  }
  markCommandExecution(ctx.remoteJid, ctx.key?.id);

  if (!ctx.isMessageFromBot && WHATSAPP_COMMAND_REQUIRES_GOOGLE_LOGIN) {
    const canonicalSenderJid = await resolveCanonicalSenderJidForContext(ctx);
    const authCheck = await ensureUserHasGoogleWebLoginForCommand({
      sock: ctx.sock,
      messageInfo: ctx.messageInfo,
      senderJid: ctx.senderJid,
      remoteJid: ctx.remoteJid,
      expirationMessage: ctx.expirationMessage,
      commandPrefix: ctx.commandPrefix,
      canonicalUserId: canonicalSenderJid,
    });

    if (!authCheck.allowed) {
      return stopMessagePipeline(ctx, 'auth_required', {
        auth_required_for_command: command || null,
        auth_login_url: authCheck.loginUrl || SITE_LOGIN_URL,
      });
    }
  }

  if (COMMAND_REACT_EMOJI) {
    try {
      await sendAndStore(ctx.sock, ctx.remoteJid, {
        react: {
          text: COMMAND_REACT_EMOJI,
          key: ctx.key,
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
    sock: ctx.sock,
    remoteJid: ctx.remoteJid,
    messageInfo: ctx.messageInfo,
    expirationMessage: ctx.expirationMessage,
    senderJid: ctx.senderJid,
    senderName: ctx.senderName,
    senderIdentity: ctx.senderIdentity,
    botJid: ctx.botJid,
    isGroupMessage: ctx.isGroupMessage,
    commandPrefix: ctx.commandPrefix,
    runCommand,
    sendReply,
  });
  const commandResult = execution?.commandResult || { ok: false };
  const commandRoute = execution?.commandRoute || 'unknown';
  if (commandRoute === 'unknown') {
    ctx.analysisPayload.processingResult = 'unknown_command';
  }

  mergeAnalysisMetadata(ctx.analysisPayload, {
    command_route: commandRoute,
  });

  if (ctx.analysisPayload.processingResult === 'processed') {
    ctx.analysisPayload.processingResult = commandResult.ok ? 'command_executed' : 'command_error';
  }

  if (commandResult.ok && commandRoute !== 'unknown') {
    try {
      await registerGlobalHelpCommandExecution({
        chatId: ctx.remoteJid,
        userId: ctx.senderJid,
        isGroupMessage: ctx.isGroupMessage,
        executedCommand: command,
      });
    } catch (error) {
      logger.warn('Falha ao registrar feedback de sugestao global.', {
        action: 'global_help_feedback_register_failed',
        command,
        commandRoute,
        remoteJid: ctx.remoteJid,
        senderJid: ctx.senderJid,
        error: error?.message,
      });
    }
  }

  if (!commandResult.ok) {
    ctx.analysisPayload.errorCode = normalizeAnalysisErrorCode(commandResult.error);
    let senderIsAdminForHelp = false;
    if (ctx.isGroupMessage) {
      try {
        senderIsAdminForHelp = await isUserAdmin(ctx.remoteJid, ctx.senderIdentity);
      } catch (error) {
        logger.warn('Falha ao resolver permissao de admin para ajuda de comando.', {
          action: 'command_error_help_admin_check_failed',
          command,
          remoteJid: ctx.remoteJid,
          senderJid: ctx.senderJid,
          error: error?.message,
        });
      }
    }

    const commandErrorHelpText = await buildCommandErrorHelpText({
      command,
      commandRoute,
      commandPrefix: ctx.commandPrefix,
      isGroupMessage: ctx.isGroupMessage,
      isSenderAdmin: senderIsAdminForHelp,
    });

    const fallbackErrorText = commandErrorHelpText ? `❌ Houve um erro ao processar *${ctx.commandPrefix}${command}*.\n\n${commandErrorHelpText}` : `❌ Houve um erro ao processar *${ctx.commandPrefix}${command}*.\n\nTente novamente ou use *${ctx.commandPrefix}menu* para validar o formato de uso.`;

    await runCommand('command-error-help', () =>
      sendReply(ctx.sock, ctx.remoteJid, ctx.messageInfo, ctx.expirationMessage, {
        text: fallbackErrorText,
      }),
    );
  }

  return null;
};

const runPostProcessingMiddleware = async (ctx) => {
  if (!ctx.isMessageFromBot) {
    await runCommand('pack-capture', () =>
      maybeCaptureIncomingSticker({
        messageInfo: ctx.messageInfo,
        senderJid: ctx.senderJid,
        isMessageFromBot: ctx.isMessageFromBot,
      }),
    );
  }

  if (!ctx.isGroupMessage || ctx.isCommandMessage || ctx.isMessageFromBot) return;

  const autoStickerMedia = extractSupportedStickerMediaDetails(ctx.messageInfo, {
    includeQuoted: false,
  });

  if (!autoStickerMedia || autoStickerMedia.mediaType === 'sticker') return;

  const activeGroupConfig = await ensureGroupConfigForContext(ctx);
  if (!activeGroupConfig?.autoStickerEnabled) return;

  ctx.analysisPayload.processingResult = 'autosticker_triggered';
  mergeAnalysisMetadata(ctx.analysisPayload, {
    auto_sticker_media_type: autoStickerMedia.mediaType || null,
  });

  const autoStickerResult = await runCommand('autosticker', () =>
    processSticker(ctx.sock, ctx.messageInfo, ctx.senderJid, ctx.remoteJid, ctx.expirationMessage, ctx.senderName, '', {
      includeQuotedMedia: false,
      showAutoPackNotice: false,
      commandPrefix: ctx.commandPrefix,
    }),
  );

  if (!autoStickerResult.ok) {
    ctx.analysisPayload.errorCode = normalizeAnalysisErrorCode(autoStickerResult.error);
  }
};

const MESSAGE_PIPELINE_MIDDLEWARES = [
  touchSenderLastSeenMiddleware,
  ignoreUnprocessableMessageMiddleware,
  applyGroupPolicyMiddleware,
  resolveCaptchaMiddleware,
  handleStartLoginTriggerMiddleware,
  detectCommandIntentMiddleware,
  applyStickerFocusMiddleware,
  routeConversationMiddleware,
  executeCommandMiddleware,
  runPostProcessingMiddleware,
];

const runMessagePipeline = async (ctx) => {
  for (const middleware of MESSAGE_PIPELINE_MIDDLEWARES) {
    if (ctx.pipelineStopped) break;
    const result = await middleware(ctx);
    if (result?.stop) break;
  }
};

/**
 * Lida com atualizações do WhatsApp, sejam mensagens ou eventos genéricos.
 *
 * @param {Object} update - Objeto contendo a atualização do WhatsApp.
 */
export const handleMessagesThroughPipeline = async (update, sock) => {
  if (update.messages && Array.isArray(update.messages)) {
    try {
      const upsertType = update?.type || null;
      const isNotifyUpsert = upsertType === 'notify';

      for (const messageInfo of update.messages) {
        const context = await createMessagePipelineContext({
          messageInfo,
          upsertType,
          isNotifyUpsert,
          sock,
        });
        if (!context) continue;

        try {
          await runMessagePipeline(context);
        } catch (messageError) {
          context.analysisPayload.processingResult = 'error';
          context.analysisPayload.errorCode = normalizeAnalysisErrorCode(messageError);
          logger.error('Erro ao processar mensagem individual:', {
            error: messageError?.message,
            messageId: context.key?.id || null,
            remoteJid: context.remoteJid,
          });
        } finally {
          persistMessageAnalysisEvent(context.analysisPayload);
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

export const handleMessages = handleMessagesThroughPipeline;
