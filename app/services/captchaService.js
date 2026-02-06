import logger from '../utils/logger/loggerModule.js';
import { getJidUser } from '../config/baileysConfig.js';
import { extractUserId, isUserAdmin, updateGroupParticipants } from '../config/groupUtils.js';
import { sendAndStore } from './messagePersistenceService.js';
import { getActiveSocket } from './socketState.js';

export const CAPTCHA_TIMEOUT_MS = 5 * 60 * 1000;
export const CAPTCHA_TIMEOUT_MINUTES = 5;

const pendingCaptchas = new Map();

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

const clearEntry = (groupId, userId, reason) => {
  const groupMap = pendingCaptchas.get(groupId);
  if (!groupMap) return false;
  const entry = groupMap.get(userId);
  if (!entry) return false;

  if (entry.timeoutId) {
    clearTimeout(entry.timeoutId);
  }

  groupMap.delete(userId);
  cleanupGroupIfEmpty(groupId, groupMap);

  logger.debug('Captcha resolvido/removido.', {
    action: 'captcha_clear',
    groupId,
    userId,
    reason,
  });

  return true;
};

const handleCaptchaTimeout = async (groupId, userId) => {
  const groupMap = pendingCaptchas.get(groupId);
  const entry = groupMap?.get(userId);
  if (!entry) return;

  if (Date.now() < entry.expiresAt) {
    return;
  }

  groupMap.delete(userId);
  cleanupGroupIfEmpty(groupId, groupMap);

  try {
    const sock = getActiveSocket();
    if (!sock) {
      logger.warn('Socket ativo indisponível para aplicar timeout de captcha.', {
        groupId,
        userId,
      });
      return;
    }

    const removalId = entry.rawId || userId;
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

export const registerCaptchaChallenge = ({ groupId, participantJid, messageKey }) => {
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

  const timeoutId = setTimeout(() => {
    handleCaptchaTimeout(groupId, userId);
  }, CAPTCHA_TIMEOUT_MS);

  groupMap.set(userId, {
    userId,
    rawId,
    messageId,
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
  return clearEntry(groupId, userId, reason);
};

export const clearCaptchasForGroup = (groupId, reason = 'manual') => {
  const groupMap = pendingCaptchas.get(groupId);
  if (!groupMap) return;

  for (const entry of groupMap.values()) {
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
  }

  pendingCaptchas.delete(groupId);

  logger.debug('Captchas do grupo limpos.', {
    action: 'captcha_clear_group',
    groupId,
    reason,
  });
};

export const resolveCaptchaByMessage = ({ groupId, senderJid }) => {
  if (!groupId) return false;
  return clearCaptchaForUser(groupId, senderJid, 'message');
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

  return clearEntry(groupId, userId, 'reaction');
};
