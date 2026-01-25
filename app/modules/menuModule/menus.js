import logger from '../../utils/logger/loggerModule.js';
import {
  buildAnimeMenu,
  buildAiMenu,
  buildMediaMenu,
  buildMenuCaption,
  buildQuoteMenu,
  buildStatsMenu,
  buildStickerMenu,
  MENU_ADM_TEXT,
} from './common.js';
import getImageBuffer from '../../utils/http/getImageBufferModule.js';

const MENU_IMAGE_ENV = 'IMAGE_MENU';

const sendMenuImage = async (sock, remoteJid, messageInfo, expirationMessage, caption) => {
  const imageUrl = process.env[MENU_IMAGE_ENV];
  if (!imageUrl) {
    logger.error('IMAGE_MENU environment variable not set.');
    await sock.sendMessage(
      remoteJid,
      { text: 'Ocorreu um erro ao carregar o menu.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  try {
    const imageBuffer = await getImageBuffer(imageUrl);
    await sock.sendMessage(
      remoteJid,
      {
        image: imageBuffer,
        caption,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Error fetching menu image:', error);
    await sock.sendMessage(
      remoteJid,
      { text: 'Ocorreu um erro ao carregar a imagem do menu.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
};

export async function handleMenuCommand(
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderName,
  commandPrefix,
  args = [],
) {
  const category = args?.[0]?.toLowerCase();
  const categoryMap = new Map([
    ['figurinhas', (prefix) => buildStickerMenu(prefix)],
    ['sticker', (prefix) => buildStickerMenu(prefix)],
    ['stickers', (prefix) => buildStickerMenu(prefix)],
    ['midia', (prefix) => buildMediaMenu(prefix)],
    ['media', (prefix) => buildMediaMenu(prefix)],
    ['quote', (prefix) => buildQuoteMenu(prefix)],
    ['quotes', (prefix) => buildQuoteMenu(prefix)],
    ['ia', (prefix) => buildAiMenu(prefix)],
    ['ai', (prefix) => buildAiMenu(prefix)],
    ['stats', (prefix) => buildStatsMenu(prefix)],
    ['estatisticas', (prefix) => buildStatsMenu(prefix)],
    ['estatistica', (prefix) => buildStatsMenu(prefix)],
    ['anime', (prefix) => buildAnimeMenu(prefix)],
    ['waifu', (prefix) => buildAnimeMenu(prefix)],
    ['husbando', (prefix) => buildAnimeMenu(prefix)],
  ]);

  const buildCategory = categoryMap.get(category);
  const caption = buildCategory
    ? buildCategory(commandPrefix).trim()
    : buildMenuCaption(senderName, commandPrefix).trim();

  await sendMenuImage(sock, remoteJid, messageInfo, expirationMessage, caption);
}

export async function handleMenuAdmCommand(sock, remoteJid, messageInfo, expirationMessage) {
  await sendMenuImage(sock, remoteJid, messageInfo, expirationMessage, MENU_ADM_TEXT.trim());
}
