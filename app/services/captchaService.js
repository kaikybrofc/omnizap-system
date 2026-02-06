import logger from '../utils/logger/loggerModule.js';
import { getJidUser } from '../config/baileysConfig.js';
import { extractUserId, isUserAdmin, updateGroupParticipants } from '../config/groupUtils.js';
import { sendAndStore } from './messagePersistenceService.js';
import { getActiveSocket } from './socketState.js';

export const CAPTCHA_TIMEOUT_MS = 5 * 60 * 1000;
export const CAPTCHA_TIMEOUT_MINUTES = 5;
const CAPTCHA_OK_EMOJI = process.env.CAPTCHA_OK_EMOJI || '✅';

const pendingCaptchas = new Map();
const captchaMessageState = new Map();

const buildMessageStateKey = (groupId, messageId) => `${groupId}:${messageId}`;
const normalizeMessageText = (messageText) => (typeof messageText === 'string' ? messageText.trim() : '');

const normalizeUserId = (userIdOrObj) => {
  const normalized = extractUserId(userIdOrObj);
  if (normalized) return normalized;
  if (typeof userIdOrObj === 'string' && userIdOrObj.trim()) return userIdOrObj.trim();
  return null;
};

const ensureGroupMap = (groupId) => {
  if (!pendingCaptchas.has(groupId)) {
    pendingCaptchas.set(groupId, new Map());
  }
  return pendingCaptchas.get(groupId);
};

const cleanupGroupIfEmpty = (groupId, groupMap) => {
  if (!groupMap || groupMap.size > 0) return;
  pendingCaptchas.delete(groupId);
};

const cleanupMessageStateForEntry = (entry) => {
  if (!entry?.messageStateKey) return null;
  const state = captchaMessageState.get(entry.messageStateKey);
  if (!state) return null;
  state.pendingCount = Math.max(0, (state.pendingCount || 0) - 1);
  if (state.pendingCount <= 0) {
    captchaMessageState.delete(entry.messageStateKey);
  }
  return state;
};

const clearEntry = (groupId, userId, reason) => {
  const groupMap = pendingCaptchas.get(groupId);
  if (!groupMap) return null;
  const entry = groupMap.get(userId);
  if (!entry) return null;

  if (entry.timeoutId) {
    clearTimeout(entry.timeoutId);
  }

  groupMap.delete(userId);
  cleanupGroupIfEmpty(groupId, groupMap);
  const messageState = cleanupMessageStateForEntry(entry);

  logger.debug('Captcha resolvido/removido.', {
    action: 'captcha_clear',
    groupId,
    userId,
    reason,
  });

  return { entry, messageState };
};

const handleCaptchaTimeout = async (groupId, userId) => {
  const groupMap = pendingCaptchas.get(groupId);
  const entry = groupMap?.get(userId);
  if (!entry) return;

  if (Date.now() < entry.expiresAt) {
    return;
  }

  const cleared = clearEntry(groupId, userId, 'timeout');
  if (!cleared) return;
  const resolvedEntry = cleared.entry;

  try {
    const sock = getActiveSocket();
    if (!sock) {
      logger.warn('Socket ativo indisponível para aplicar timeout de captcha.', {
        groupId,
        userId,
      });
      return;
    }

    const removalId = resolvedEntry.rawId || userId;
    const isAdmin = await isUserAdmin(groupId, removalId);
    if (isAdmin) {
      logger.info('Captcha expirado, mas usuário é admin. Nenhuma ação tomada.', {
        groupId,
        userId: removalId,
      });
      return;
    }

    await updateGroupParticipants(sock, groupId, [removalId], 'remove');

    const user = getJidUser(removalId);
    await sendAndStore(sock, groupId, {
      text: `⏳ @${user || 'usuario'} foi removido por não completar a verificação em ${CAPTCHA_TIMEOUT_MINUTES} minutos.`,
      mentions: [removalId],
    });

    logger.info('Usuário removido por falha no captcha.', {
      action: 'captcha_remove',
      groupId,
      userId: removalId,
    });
  } catch (error) {
    logger.error('Erro ao aplicar timeout do captcha.', {
      groupId,
      userId,
      errorMessage: error.message,
      stack: error.stack,
    });
  }
};

const sendCaptchaApprovalReaction = async ({ groupId, messageKey, userId }) => {
  if (!groupId || !messageKey || !CAPTCHA_OK_EMOJI) return;
  const sock = getActiveSocket();
  if (!sock) {
    logger.warn('Socket ativo indisponível para enviar reação de captcha.', {
      groupId,
      userId,
    });
    return;
  }

  try {
    await sendAndStore(sock, groupId, {
      react: {
        text: CAPTCHA_OK_EMOJI,
        key: messageKey,
      },
    });
  } catch (error) {
    logger.warn('Falha ao enviar reação de captcha.', {
      groupId,
      userId,
      errorMessage: error.message,
    });
  }
};

const sendCaptchaApprovalEdit = async ({ groupId, entry, messageState }) => {
  if (!groupId || !entry?.messageKey) return;

  const mentionId = entry.rawId || entry.userId;
  const userLabel = getJidUser(mentionId) || 'usuario';
  const approvalLine = `✅ @${userLabel} passou na verificação.`;
  const baseText = normalizeMessageText(messageState?.text);
  const updatedText = baseText.includes(approvalLine)
    ? baseText
    : `${baseText}${baseText ? '\n' : ''}${approvalLine}`;

  const mentionsSet = new Set(Array.isArray(messageState?.mentions) ? messageState.mentions : []);
  if (mentionId) {
    mentionsSet.add(mentionId);
  }
  const mentions = Array.from(mentionsSet);

  const sock = getActiveSocket();
  if (!sock) {
    logger.warn('Socket ativo indisponível para editar mensagem de captcha.', {
      groupId,
      userId: mentionId,
    });
    return;
  }

  try {
    await sendAndStore(sock, groupId, {
      text: updatedText,
      mentions,
      edit: entry.messageKey,
    });
    if (messageState) {
      messageState.text = updatedText;
      messageState.mentions = mentions;
    }
  } catch (error) {
    logger.warn('Falha ao editar mensagem de captcha.', {
      groupId,
      userId: mentionId,
      errorMessage: error.message,
    });
  }
};

export const registerCaptchaChallenge = ({
  groupId,
  participantJid,
  messageKey,
  messageText,
  messageMentions,
}) => {
  if (!groupId) return;
  const userId = normalizeUserId(participantJid);
  if (!userId) return;
  const rawId = typeof participantJid === 'string' && participantJid.trim() ? participantJid.trim() : userId;

  const groupMap = ensureGroupMap(groupId);
  const existing = groupMap.get(userId);
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  const expiresAt = Date.now() + CAPTCHA_TIMEOUT_MS;
  const messageId = messageKey?.id || null;
  const normalizedText = normalizeMessageText(messageText);
  const messageStateKey = messageId && normalizedText ? buildMessageStateKey(groupId, messageId) : null;

  if (messageStateKey) {
    const mentions = Array.isArray(messageMentions)
      ? Array.from(new Set(messageMentions.filter(Boolean)))
      : [];
    const existingState = captchaMessageState.get(messageStateKey);
    if (existingState) {
      existingState.pendingCount = (existingState.pendingCount || 0) + 1;
      if (!existingState.text) existingState.text = normalizedText;
      if ((!existingState.mentions || existingState.mentions.length === 0) && mentions.length > 0) {
        existingState.mentions = mentions;
      }
    } else {
      captchaMessageState.set(messageStateKey, {
        text: normalizedText,
        mentions,
        pendingCount: 1,
      });
    }
  }

  const timeoutId = setTimeout(() => {
    handleCaptchaTimeout(groupId, userId);
  }, CAPTCHA_TIMEOUT_MS);

  groupMap.set(userId, {
    userId,
    rawId,
    messageId,
    messageKey: messageKey || null,
    messageStateKey,
    expiresAt,
    timeoutId,
  });

  logger.debug('Captcha iniciado para usuário.', {
    action: 'captcha_start',
    groupId,
    userId,
    expiresAt,
    messageId,
  });
};

export const clearCaptchaForUser = (groupId, participantJid, reason = 'manual') => {
  const userId = normalizeUserId(participantJid);
  if (!userId) return false;
  const cleared = clearEntry(groupId, userId, reason);
  return Boolean(cleared);
};

export const clearCaptchasForGroup = (groupId, reason = 'manual') => {
  const groupMap = pendingCaptchas.get(groupId);
  if (!groupMap) return;

  for (const entry of groupMap.values()) {
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    cleanupMessageStateForEntry(entry);
  }

  pendingCaptchas.delete(groupId);

  logger.debug('Captchas do grupo limpos.', {
    action: 'captcha_clear_group',
    groupId,
    reason,
  });
};

export const resolveCaptchaByMessage = ({ groupId, senderJid, messageKey }) => {
  if (!groupId) return false;
  const userId = normalizeUserId(senderJid);
  if (!userId) return false;

  const groupMap = pendingCaptchas.get(groupId);
  const entry = groupMap?.get(userId);
  if (!entry) return false;

  const cleared = clearEntry(groupId, userId, 'message');
  if (!cleared) return false;

  sendCaptchaApprovalReaction({ groupId, messageKey, userId });
  return true;
};

export const resolveCaptchaByReaction = ({ groupId, senderJid, reactedMessageId }) => {
  if (!groupId) return false;
  const userId = normalizeUserId(senderJid);
  if (!userId) return false;

  const groupMap = pendingCaptchas.get(groupId);
  const entry = groupMap?.get(userId);
  if (!entry) return false;

  if (entry.messageId && reactedMessageId && entry.messageId !== reactedMessageId) {
    return false;
  }

  const cleared = clearEntry(groupId, userId, 'reaction');
  if (!cleared) return false;

  sendCaptchaApprovalEdit({ groupId, entry: cleared.entry, messageState: cleared.messageState });
  return true;
};
