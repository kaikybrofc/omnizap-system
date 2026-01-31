import logger from '../utils/logger/loggerModule.js';
import { queueMessageInsert } from './dbWriteQueue.js';

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

/**
 * Envia uma mensagem via Baileys e persiste imediatamente o retorno.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {Object} content
 * @param {Object} [options]
 * @returns {Promise<import('@whiskeysockets/baileys').WAMessage>}
 */
export async function sendAndStore(sock, jid, content, options) {
  const sent = await sock.sendMessage(jid, content, options);
  const senderId = sock?.user?.id || sent?.key?.participant;
  try {
    queueMessageInsert(buildMessageData(sent, senderId));
  } catch (error) {
    logger.warn('Falha ao enfileirar mensagem enviada para persistencia.', {
      error: error.message,
      messageId: sent?.key?.id,
      remoteJid: sent?.key?.remoteJid,
    });
  }
  return sent;
}
