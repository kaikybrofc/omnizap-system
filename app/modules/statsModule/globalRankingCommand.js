import logger from '../../utils/logger/loggerModule.js';
import { resolveBotJid } from '../../config/baileysConfig.js';
import { isWhatsAppUserId } from '../../services/lidMapService.js';
import { buildRankingMessage, getRankingReport, renderRankingImage } from './rankingCommon.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const RANKING_LIMIT = 5;

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
  isGroupMessage,
}) {
  try {
    const botJid = resolveBotJid(sock?.user?.id);
    const report = await getRankingReport({
      scope: 'global',
      botJid,
      limit: RANKING_LIMIT,
    });
    const text = buildRankingMessage({ scope: 'global', limit: RANKING_LIMIT, ...report });
    const mentions = report.rows
      .map((row) => row.mention_id)
      .filter((jid) => isWhatsAppUserId(jid));

    const imageBuffer = await renderRankingImage({
      sock,
      remoteJid,
      rows: report.rows,
      totalMessages: report.totalMessages,
      topType: report.topType,
      scope: 'global',
      limit: RANKING_LIMIT,
    });
    await sendAndStore(sock, 
      remoteJid,
      { image: imageBuffer, caption: text, ...(mentions.length ? { mentions } : {}) },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro ao gerar ranking global:', { error: error.message });
    await sendAndStore(sock, 
      remoteJid,
      { text: `Erro ao gerar ranking global: ${error.message}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
