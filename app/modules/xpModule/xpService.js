import { pool } from '../../../database/index.js';
import { getJidUser } from '../../config/baileysConfig.js';
import { getActiveSocket } from '../../services/socketState.js';
import { isWhatsAppUserId } from '../../services/lidMapService.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import logger from '../../utils/logger/loggerModule.js';
import { XP_CONFIG, calculateLevelFromXp, isEligibleContentForXp, resolveXpGainForLevel } from './xpConfig.js';
import { ensureUserXpRowForUpdate, getUserXpBySenderId, insertXpTransaction, updateUserXpRow } from './xpRepository.js';

const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const toTimestamp = (value) => {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
};

const buildMentionText = (senderId) => {
  if (isWhatsAppUserId(senderId)) {
    const user = getJidUser(senderId);
    if (user) return `@${user}`;
  }
  return senderId;
};

const sendLevelUpNotice = async ({ sock, chatId, senderId, newLevel, xpGain, totalXp, quoteMessage, expirationMessage }) => {
  if (!sock || !chatId) return;

  const mentionText = buildMentionText(senderId);
  const mentions = isWhatsAppUserId(senderId) ? [senderId] : undefined;
  const text = `🎉 *Level up!*\n${mentionText} alcançou o nível *${newLevel}*!\n+${xpGain} XP (total: ${totalXp})`;

  await sendAndStore(
    sock,
    chatId,
    mentions ? { text, mentions } : { text },
    { quoted: quoteMessage, ...(expirationMessage ? { ephemeralExpiration: expirationMessage } : {}) },
  );
};

export const isValidMessageForXp = ({ messageInfo, extractedText, isMessageFromBot = false, isCommandMessage = false }) => {
  if (isMessageFromBot) return false;
  if (!messageInfo?.message || typeof messageInfo.message !== 'object') return false;
  if (messageInfo?.messageStubType !== null && messageInfo?.messageStubType !== undefined) return false;
  if (!isEligibleContentForXp(extractedText)) return false;
  if (XP_CONFIG.ignoreCommandMessages && isCommandMessage) return false;
  return true;
};

export const awardXpForMessage = async ({
  senderId,
  chatId,
  messageInfo,
  extractedText,
  isMessageFromBot = false,
  isCommandMessage = false,
  sock,
  expirationMessage,
}) => {
  if (!senderId) {
    return { awarded: false, skipped: true, reason: 'missing_sender' };
  }

  const eligible = isValidMessageForXp({ messageInfo, extractedText, isMessageFromBot, isCommandMessage });
  if (!eligible) {
    return { awarded: false, skipped: true, reason: 'ineligible_message' };
  }

  const now = Date.now();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const current = await ensureUserXpRowForUpdate({ senderId, connection });
    const currentXp = toInt(current?.xp, 0);
    const currentLevel = Math.max(1, toInt(current?.level, 1));
    const currentMessages = Math.max(0, toInt(current?.messages_count, 0));
    const lastXpAtTs = toTimestamp(current?.last_xp_at);

    const nextMessagesCount = currentMessages + 1;
    const isCooldownActive =
      lastXpAtTs !== null && XP_CONFIG.cooldownMs > 0 && now - lastXpAtTs < XP_CONFIG.cooldownMs;

    if (isCooldownActive) {
      await updateUserXpRow(
        {
          senderId,
          xp: currentXp,
          level: currentLevel,
          messagesCount: nextMessagesCount,
          lastXpAt: current?.last_xp_at || null,
        },
        connection,
      );

      await connection.commit();
      return {
        awarded: false,
        skipped: true,
        reason: 'cooldown',
        level: currentLevel,
        xp: currentXp,
        messagesCount: nextMessagesCount,
      };
    }

    const xpGain = resolveXpGainForLevel(currentLevel);
    const nextXp = currentXp + xpGain;
    const nextLevel = calculateLevelFromXp(nextXp).level;
    const leveledUp = nextLevel > currentLevel;

    await updateUserXpRow(
      {
        senderId,
        xp: nextXp,
        level: nextLevel,
        messagesCount: nextMessagesCount,
        lastXpAt: new Date(now),
      },
      connection,
    );

    await connection.commit();

    if (leveledUp && XP_CONFIG.notifyLevelUp) {
      try {
        await sendLevelUpNotice({
          sock,
          chatId,
          senderId,
          newLevel: nextLevel,
          xpGain,
          totalXp: nextXp,
          quoteMessage: messageInfo,
          expirationMessage,
        });
      } catch (error) {
        logger.warn('Falha ao enviar aviso de level up.', {
          error: error.message,
          senderId,
          chatId,
        });
      }
    }

    return {
      awarded: true,
      xpGain,
      levelBefore: currentLevel,
      levelAfter: nextLevel,
      xpBefore: currentXp,
      xpAfter: nextXp,
      messagesCount: nextMessagesCount,
      leveledUp,
    };
  } catch (error) {
    await connection.rollback();
    logger.error('Erro ao conceder XP por mensagem.', {
      error: error.message,
      senderId,
      chatId,
    });
    throw error;
  } finally {
    connection.release();
  }
};

export const addXpToUser = async ({
  senderId,
  amount,
  reason,
  silent = true,
  chatId,
  quoteMessage,
  actorId = null,
  sock = null,
  expirationMessage,
}) => {
  if (!senderId || typeof senderId !== 'string') {
    throw new Error('senderId inválido para ajuste de XP.');
  }

  const parsedAmount = toInt(amount, NaN);
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
    throw new Error('amount deve ser um número inteiro diferente de zero.');
  }

  const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 255) : '';

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const current = await ensureUserXpRowForUpdate({ senderId, connection });
    const currentXp = Math.max(0, toInt(current?.xp, 0));
    const currentLevel = Math.max(1, toInt(current?.level, 1));
    const currentMessages = Math.max(0, toInt(current?.messages_count, 0));

    const nextXp = Math.max(0, currentXp + parsedAmount);
    const appliedAmount = nextXp - currentXp;
    const nextLevel = calculateLevelFromXp(nextXp).level;
    const leveledUp = nextLevel > currentLevel;

    await updateUserXpRow(
      {
        senderId,
        xp: nextXp,
        level: nextLevel,
        messagesCount: currentMessages,
        lastXpAt: current?.last_xp_at || null,
      },
      connection,
    );

    await insertXpTransaction(
      {
        senderId,
        amount: appliedAmount,
        reason: normalizedReason || null,
        actorId,
      },
      connection,
    );

    await connection.commit();

    if (!silent && chatId) {
      const activeSock = sock || getActiveSocket();
      if (activeSock) {
        const mentionText = buildMentionText(senderId);
        const mentions = isWhatsAppUserId(senderId) ? [senderId] : undefined;
        const changeLabel = appliedAmount >= 0 ? `+${appliedAmount}` : `${appliedAmount}`;
        const levelLine = leveledUp
          ? `📈 Nível: *${currentLevel}* → *${nextLevel}*`
          : `🏅 Nível atual: *${nextLevel}*`;

        const lines = [
          '✅ *XP atualizado*',
          `Usuário: ${mentionText}`,
          `Alteração: *${changeLabel} XP*`,
          `XP total: *${nextXp}*`,
          levelLine,
        ];

        if (normalizedReason) {
          lines.push(`Motivo: ${normalizedReason}`);
        }

        await sendAndStore(
          activeSock,
          chatId,
          mentions ? { text: lines.join('\n'), mentions } : { text: lines.join('\n') },
          { quoted: quoteMessage, ...(expirationMessage ? { ephemeralExpiration: expirationMessage } : {}) },
        );
      } else {
        logger.warn('XP ajustado, mas não foi possível anunciar por falta de socket ativo.', {
          senderId,
          chatId,
        });
      }
    }

    return {
      senderId,
      appliedAmount,
      requestedAmount: parsedAmount,
      xpBefore: currentXp,
      xpAfter: nextXp,
      levelBefore: currentLevel,
      levelAfter: nextLevel,
      leveledUp,
      reason: normalizedReason || null,
    };
  } catch (error) {
    await connection.rollback();
    logger.error('Erro ao ajustar XP manualmente.', {
      error: error.message,
      senderId,
      amount,
      actorId,
    });
    throw error;
  } finally {
    connection.release();
  }
};

export const getUserXp = async (senderId) => {
  if (!senderId) return null;
  return getUserXpBySenderId(senderId);
};
