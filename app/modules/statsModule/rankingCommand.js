import logger from '../../utils/logger/loggerModule.js';
import { resolveBotJid } from '../../config/baileysConfig.js';
import { isWhatsAppUserId } from '../../services/lidMapService.js';
import { buildRankingMessage, getRankingReport, renderRankingImage } from './rankingCommon.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const RANKING_LIMIT = 5;

export async function handleRankingCommand({ sock, remoteJid, messageInfo, expirationMessage, isGroupMessage }) {
  if (!isGroupMessage) {
    await sendAndStore(sock, remoteJid, { text: 'Este comando so pode ser usado em grupos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  try {
    const botJid = resolveBotJid(sock?.user?.id);
    const report = await getRankingReport({
      scope: 'group',
      remoteJid,
      botJid,
      limit: RANKING_LIMIT,
    });
    const text = buildRankingMessage({ scope: 'group', limit: RANKING_LIMIT, ...report });
    const mentions = report.rows.map((row) => row.mention_id).filter((jid) => isWhatsAppUserId(jid));

    const imageBuffer = await renderRankingImage({
      sock,
      remoteJid,
      rows: report.rows,
      totalMessages: report.totalMessages,
      topType: report.topType,
      scope: 'group',
      limit: RANKING_LIMIT,
    });
    await sendAndStore(sock, remoteJid, { image: imageBuffer, caption: text, ...(mentions.length ? { mentions } : {}) }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  } catch (error) {
    logger.error('Erro ao gerar ranking do grupo:', { error: error.message });
    await sendAndStore(sock, remoteJid, { text: `Erro ao gerar ranking: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}
