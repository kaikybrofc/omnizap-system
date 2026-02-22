import logger from '../../utils/logger/loggerModule.js';
import { resolveBotJid } from '../../config/baileysConfig.js';
import { isWhatsAppUserId } from '../../services/lidMapService.js';
import { buildRankingMessage, getRankingReport, renderRankingImage } from './rankingCommon.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const RANKING_LIMIT = 5;
const RENDER_TIMEOUT_MS = 15000;

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Tempo limite excedido (${timeoutMs}ms)`)), timeoutMs);
    }),
  ]);

/**
 * Handler do comando de ranking global.
 * @param {object} params
 * @param {object} params.sock
 * @param {string} params.remoteJid
 * @param {object} params.messageInfo
 * @param {number|undefined} params.expirationMessage
 * @param {boolean|undefined} params.isGroupMessage
 * @returns {Promise<void>}
 */
export async function handleGlobalRankingCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  isGroupMessage: _isGroupMessage,
}) {
  try {
    const botJid = resolveBotJid(sock?.user?.id);
    const report = await getRankingReport({
      scope: 'global',
      botJid,
      limit: RANKING_LIMIT,
      includeTopType: false,
      enrichRows: false,
    });
    const text = buildRankingMessage({ scope: 'global', limit: RANKING_LIMIT, ...report });
    const mentions = report.rows
      .map((row) => row.mention_id)
      .filter((jid) => isWhatsAppUserId(jid));

    try {
      const imageBuffer = await withTimeout(
        renderRankingImage({
          sock,
          remoteJid,
          rows: report.rows,
          totalMessages: report.totalMessages,
          topType: report.topType,
          scope: 'global',
          limit: RANKING_LIMIT,
        }),
        RENDER_TIMEOUT_MS,
      );
      await sendAndStore(sock, 
        remoteJid,
        { image: imageBuffer, caption: text, ...(mentions.length ? { mentions } : {}) },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
    } catch (renderError) {
      logger.warn('Falha/timeout ao renderizar imagem do ranking global; enviando somente texto.', {
        error: renderError?.message,
      });
      await sendAndStore(sock, 
        remoteJid,
        { text, ...(mentions.length ? { mentions } : {}) },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
    }
  } catch (error) {
    logger.error('Erro ao gerar ranking global:', { error: error.message });
    await sendAndStore(sock, 
      remoteJid,
      { text: `Erro ao gerar ranking global: ${error.message}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
