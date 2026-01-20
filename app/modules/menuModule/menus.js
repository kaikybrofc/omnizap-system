import logger from '../../utils/logger/loggerModule.js';
import { buildMenuCaption, MENU_ADM_TEXT } from './common.js';
import getImageBuffer from '../../utils/http/getImageBufferModule.js';

const MENU_IMAGE_ENV = 'IMAGE_MENU';

export async function handleMenuCommand(sock, remoteJid, messageInfo, expirationMessage, senderName, commandPrefix) {
  const imageUrl = process.env[MENU_IMAGE_ENV];
  if (!imageUrl) {
    logger.error('IMAGE_MENU environment variable not set.');
    await sock.sendMessage(remoteJid, { text: 'Ocorreu um erro ao carregar o menu.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  const stickerCaption = buildMenuCaption(senderName, commandPrefix);

  try {
    const imageBuffer = await getImageBuffer(imageUrl);
    await sock.sendMessage(
      remoteJid,
      {
        image: imageBuffer,
        caption: stickerCaption,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Error fetching menu image:', error);
    await sock.sendMessage(remoteJid, { text: 'Ocorreu um erro ao carregar a imagem do menu.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}

export async function handleMenuAdmCommand(sock, remoteJid, messageInfo, expirationMessage) {
  await sock.sendMessage(remoteJid, { text: MENU_ADM_TEXT.trim() }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
}
