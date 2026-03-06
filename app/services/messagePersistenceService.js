import logger from '../../utils/logger/loggerModule.js';
import { queueMessageInsert } from './dbWriteQueue.js';

const parseEnvInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const BAILEYS_SEND_RETRY_ATTEMPTS = parseEnvInt(process.env.BAILEYS_SEND_RETRY_ATTEMPTS, 2, 1, 5);
const BAILEYS_SEND_RETRY_BASE_DELAY_MS = parseEnvInt(process.env.BAILEYS_SEND_RETRY_BASE_DELAY_MS, 600, 100, 10_000);

/**
 * Converte um timestamp da mensagem para ms com fallback seguro.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg
 * @returns {number}
 */
const resolveMessageTimestampMs = (msg) => {
  const rawTimestamp = msg?.messageTimestamp;
  if (rawTimestamp !== null && rawTimestamp !== undefined) {
    const tsNumber = typeof rawTimestamp === 'number' ? rawTimestamp : Number(rawTimestamp);
    if (Number.isFinite(tsNumber) && tsNumber > 0) {
      return tsNumber * 1000;
    }
  }
  return Date.now();
};

/**
 * Normaliza uma mensagem do Baileys para o formato persistido no banco.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg - Mensagem recebida/enviada.
 * @param {string} [senderId] - ID do remetente (opcional).
 * @returns {Object} Objeto com dados prontos para persistencia.
 */
export const buildMessageData = (msg, senderId) => ({
  message_id: msg?.key?.id,
  chat_id: msg?.key?.remoteJid,
  sender_id: senderId || msg?.key?.participant || msg?.key?.remoteJid,
  content: msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || null,
  raw_message: msg || {},
  timestamp: new Date(resolveMessageTimestampMs(msg)),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

const isTransientSendError = (error) => {
  const statusCode = Number(error?.output?.statusCode || error?.statusCode || 0);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;

  const code = String(error?.code || '').trim().toUpperCase();
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND', 'ERR_SOCKET_CLOSED', 'ERR_NETWORK'].includes(code)) {
    return true;
  }

  const rawMessage = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
  const transientFragments = ['timeout', 'timed out', 'connection closed', 'socket closed', 'media conn', 'media_conn', 'fetch failed', 'temporarily unavailable', 'network'];
  return transientFragments.some((fragment) => rawMessage.includes(fragment));
};

const shouldRefreshMediaConnection = (error) => {
  const rawMessage = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
  return rawMessage.includes('media') || rawMessage.includes('directpath') || rawMessage.includes('upload');
};

/**
 * Envia uma mensagem via Baileys e persiste imediatamente o retorno.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {Object} content
 * @param {Object} [options]
 * @returns {Promise<import('@whiskeysockets/baileys').WAMessage|undefined>}
 */
export async function sendAndStore(sock, jid, content, options) {
  let attempt = 0;
  let sent;
  let lastError;

  while (attempt < BAILEYS_SEND_RETRY_ATTEMPTS) {
    attempt += 1;
    try {
      sent = await sock.sendMessage(jid, content, options);
      break;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < BAILEYS_SEND_RETRY_ATTEMPTS && isTransientSendError(error);
      if (!shouldRetry) {
        throw error;
      }

      if (shouldRefreshMediaConnection(error) && typeof sock?.refreshMediaConn === 'function') {
        try {
          await sock.refreshMediaConn(true);
        } catch (refreshError) {
          logger.debug('Falha ao forçar refresh de mediaConn antes do retry.', {
            error: refreshError?.message,
            attempt,
            jid,
          });
        }
      }

      const delayMs = BAILEYS_SEND_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn('Falha transitória ao enviar mensagem; novo retry agendado.', {
        attempt,
        maxAttempts: BAILEYS_SEND_RETRY_ATTEMPTS,
        delayMs,
        jid,
        code: error?.code || null,
        statusCode: error?.output?.statusCode || error?.statusCode || null,
        error: error?.message,
      });
      await wait(delayMs);
    }
  }

  if (!sent) {
    throw lastError || new Error('Falha ao enviar mensagem: resultado vazio.');
  }

  const senderId = sock?.user?.id || sent?.key?.participant;
  if (sent?.key?.id) {
    try {
      queueMessageInsert(buildMessageData(sent, senderId));
    } catch (error) {
      logger.warn('Falha ao enfileirar mensagem enviada para persistencia.', {
        error: error.message,
        messageId: sent?.key?.id,
        remoteJid: sent?.key?.remoteJid,
      });
    }
  }

  return sent;
}
