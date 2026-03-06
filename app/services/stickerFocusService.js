import { normalizeJid } from '../config/baileysConfig.js';

const parseEnvInt = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

export const MIN_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES = 1;
export const MAX_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES = 24 * 60;
export const DEFAULT_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES = parseEnvInt(
  process.env.STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES ?? process.env.STICKER_FOCUS_TEXT_COOLDOWN_MINUTES,
  60,
  MIN_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES,
  MAX_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES,
);

export const MIN_STICKER_FOCUS_CHAT_WINDOW_MINUTES = 1;
export const MAX_STICKER_FOCUS_CHAT_WINDOW_MINUTES = 6 * 60;
export const DEFAULT_STICKER_FOCUS_CHAT_WINDOW_MINUTES = parseEnvInt(
  process.env.STICKER_FOCUS_CHAT_WINDOW_MINUTES,
  15,
  MIN_STICKER_FOCUS_CHAT_WINDOW_MINUTES,
  MAX_STICKER_FOCUS_CHAT_WINDOW_MINUTES,
);

const STICKER_FOCUS_WARNING_COOLDOWN_MS = parseEnvInt(process.env.STICKER_FOCUS_WARNING_COOLDOWN_MS, 45_000, 10_000, 5 * 60_000);
const NON_HUMAN_PLACEHOLDERS = new Set(['Mensagem vazia', 'Tipo de mensagem não suportado ou sem conteúdo.']);
const IGNORED_MESSAGE_TYPES = new Set([
  'messagehistorybundle',
  'messagehistorynotice',
  'keydistribution',
  'senderkeydistribution',
  'reaction',
  'devicesent',
  'contextinfo',
  'protocol',
  'botinvoke',
]);
const NON_THROTTLED_MESSAGE_TYPES = new Set(['sticker', 'image', 'video']);
const MESSAGE_WRAPPER_KEYS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'deviceSentMessage', 'editedMessage'];

const sharedMessageAllowance = globalThis.__omnizapStickerFocusMessageAllowance instanceof Map ? globalThis.__omnizapStickerFocusMessageAllowance : new Map();
const sharedWarningThrottle = globalThis.__omnizapStickerFocusWarningThrottle instanceof Map ? globalThis.__omnizapStickerFocusWarningThrottle : new Map();

globalThis.__omnizapStickerFocusMessageAllowance = sharedMessageAllowance;
globalThis.__omnizapStickerFocusWarningThrottle = sharedWarningThrottle;

const normalizeMinutes = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const parseTimestampMs = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 0;
};

const buildSenderKey = ({ groupId = '', senderJid = '' }) => {
  const normalizedGroup = normalizeJid(groupId) || String(groupId || '').trim();
  const normalizedSender = normalizeJid(senderJid) || String(senderJid || '').trim();
  if (!normalizedGroup || !normalizedSender) return '';
  return `${normalizedGroup}:${normalizedSender}`;
};

const hasExplicitTextPayload = (messagePayload) => {
  if (!messagePayload || typeof messagePayload !== 'object') return false;

  const queue = [messagePayload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;

    const conversationText = typeof current.conversation === 'string' ? current.conversation.trim() : '';
    if (conversationText) return true;

    const extendedText = typeof current.extendedTextMessage?.text === 'string' ? current.extendedTextMessage.text.trim() : '';
    if (extendedText) return true;

    for (const wrapperKey of MESSAGE_WRAPPER_KEYS) {
      const nestedMessage = current?.[wrapperKey]?.message;
      if (nestedMessage && typeof nestedMessage === 'object') {
        queue.push(nestedMessage);
      }
    }
  }

  return false;
};

const isPlaceholderOnlyText = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return true;
  if (NON_HUMAN_PLACEHOLDERS.has(normalized)) return true;
  return /^\[[^\]]+\]$/.test(normalized);
};

const normalizeMessageTypes = (mediaEntries = []) => {
  if (!Array.isArray(mediaEntries)) return [];
  return mediaEntries
    .map((entry) =>
      String(entry?.mediaType || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
};

const isIgnoredSystemMessageType = (type) => {
  const normalized = String(type || '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (IGNORED_MESSAGE_TYPES.has(normalized)) return true;
  // Cobre variações do Baileys/proto para eventos internos de distribuição de chave.
  if (normalized.includes('keydistribution')) return true;
  if (normalized.includes('senderkeydistribution')) return true;
  return false;
};

export const clampStickerFocusMessageCooldownMinutes = (value, fallback = DEFAULT_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES) =>
  normalizeMinutes(value, fallback, MIN_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES, MAX_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES);

export const clampStickerFocusChatWindowMinutes = (value, fallback = DEFAULT_STICKER_FOCUS_CHAT_WINDOW_MINUTES) =>
  normalizeMinutes(value, fallback, MIN_STICKER_FOCUS_CHAT_WINDOW_MINUTES, MAX_STICKER_FOCUS_CHAT_WINDOW_MINUTES);

export const minutesToMs = (minutes) => Math.max(0, Math.floor(Number(minutes) || 0) * 60 * 1000);

export const resolveStickerFocusState = (groupConfig = {}, now = Date.now()) => {
  const rawCooldown = groupConfig?.stickerFocusMessageCooldownMinutes ?? groupConfig?.stickerFocusTextCooldownMinutes;
  const messageCooldownMinutes = clampStickerFocusMessageCooldownMinutes(rawCooldown);
  const messageCooldownMs = minutesToMs(messageCooldownMinutes);
  const chatWindowUntilMs = parseTimestampMs(groupConfig?.stickerFocusChatWindowUntilMs);
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const chatWindowRemainingMs = Math.max(0, chatWindowUntilMs - safeNow);

  return {
    enabled: Boolean(groupConfig?.stickerFocusEnabled),
    messageCooldownMinutes,
    messageCooldownMs,
    // backward compatibility for old reads
    textCooldownMinutes: messageCooldownMinutes,
    textCooldownMs: messageCooldownMs,
    chatWindowUntilMs,
    chatWindowRemainingMs,
    isChatWindowOpen: chatWindowRemainingMs > 0,
  };
};

export const resolveStickerFocusMessageClassification = ({ messageInfo, extractedText, mediaEntries = [] }) => {
  if (messageInfo?.messageStubType !== undefined && messageInfo?.messageStubType !== null) {
    return {
      isThrottleCandidate: false,
      messageType: 'system_stub',
      reason: 'stub',
    };
  }

  const messageTypes = normalizeMessageTypes(mediaEntries);
  const filteredTypes = messageTypes.filter((type) => !isIgnoredSystemMessageType(type));
  const primaryType = filteredTypes[0] || messageTypes[0] || 'unknown';

  if (filteredTypes.some((type) => NON_THROTTLED_MESSAGE_TYPES.has(type))) {
    return {
      isThrottleCandidate: false,
      messageType: filteredTypes.find((type) => NON_THROTTLED_MESSAGE_TYPES.has(type)) || primaryType,
      reason: 'sticker_flow_media',
    };
  }

  if (filteredTypes.length > 0) {
    return {
      isThrottleCandidate: true,
      messageType: primaryType,
      reason: 'message_type',
    };
  }

  if (!isPlaceholderOnlyText(extractedText) && hasExplicitTextPayload(messageInfo?.message)) {
    return {
      isThrottleCandidate: true,
      messageType: 'text',
      reason: 'explicit_text_payload',
    };
  }

  return {
    isThrottleCandidate: false,
    messageType: primaryType,
    reason: 'non_human_or_empty',
  };
};

export const canSendMessageInStickerFocus = ({ groupId, senderJid, messageCooldownMs, now = Date.now() }) => {
  const senderKey = buildSenderKey({ groupId, senderJid });
  if (!senderKey) {
    return {
      allowed: true,
      remainingMs: 0,
      lastAllowedAt: 0,
    };
  }

  const normalizedCooldownMs = Math.max(0, Math.floor(Number(messageCooldownMs) || 0));
  if (normalizedCooldownMs <= 0) {
    return {
      allowed: true,
      remainingMs: 0,
      lastAllowedAt: Number(sharedMessageAllowance.get(senderKey) || 0),
    };
  }

  const safeNow = Number.isFinite(now) ? now : Date.now();
  const lastAllowedAt = Number(sharedMessageAllowance.get(senderKey) || 0);
  if (!lastAllowedAt || safeNow - lastAllowedAt >= normalizedCooldownMs) {
    return {
      allowed: true,
      remainingMs: 0,
      lastAllowedAt,
    };
  }

  return {
    allowed: false,
    remainingMs: Math.max(0, normalizedCooldownMs - (safeNow - lastAllowedAt)),
    lastAllowedAt,
  };
};

export const registerMessageUsageInStickerFocus = ({ groupId, senderJid, now = Date.now() }) => {
  const senderKey = buildSenderKey({ groupId, senderJid });
  if (!senderKey) return;
  const safeNow = Number.isFinite(now) ? now : Date.now();
  sharedMessageAllowance.set(senderKey, safeNow);
};

export const shouldSendStickerFocusWarning = ({ groupId, senderJid, now = Date.now() }) => {
  const senderKey = buildSenderKey({ groupId, senderJid });
  if (!senderKey) return true;
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const lastWarningAt = Number(sharedWarningThrottle.get(senderKey) || 0);
  if (!lastWarningAt || safeNow - lastWarningAt >= STICKER_FOCUS_WARNING_COOLDOWN_MS) {
    sharedWarningThrottle.set(senderKey, safeNow);
    return true;
  }
  return false;
};

// Backward compatibility aliases
export const MIN_STICKER_FOCUS_TEXT_COOLDOWN_MINUTES = MIN_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES;
export const MAX_STICKER_FOCUS_TEXT_COOLDOWN_MINUTES = MAX_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES;
export const DEFAULT_STICKER_FOCUS_TEXT_COOLDOWN_MINUTES = DEFAULT_STICKER_FOCUS_MESSAGE_COOLDOWN_MINUTES;
export const clampStickerFocusTextCooldownMinutes = clampStickerFocusMessageCooldownMinutes;
export const isPlainTextMessageForStickerFocus = ({ messageInfo, extractedText, mediaEntries = [] }) => resolveStickerFocusMessageClassification({ messageInfo, extractedText, mediaEntries }).messageType === 'text';
export const canSendTextInStickerFocus = ({ groupId, senderJid, textCooldownMs, now = Date.now() }) =>
  canSendMessageInStickerFocus({
    groupId,
    senderJid,
    messageCooldownMs: textCooldownMs,
    now,
  });
export const registerTextUsageInStickerFocus = ({ groupId, senderJid, now = Date.now() }) => registerMessageUsageInStickerFocus({ groupId, senderJid, now });
