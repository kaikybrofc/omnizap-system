import axios from 'axios';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import logger from '../../utils/logger/loggerModule.js';
import { getJidUser } from '../../config/baileysConfig.js';
import { convertToWebp } from '../stickerModule/convertToWebp.js';
import { addStickerMetadata } from '../stickerModule/addStickerMetadata.js';
import { fetchLatestPushNames } from '../statsModule/rankingCommon.js';

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const QUOTE_API_URL = process.env.QUOTE_API_URL || 'https://bot.lyo.su/quote/generate.png';
// Default WhatsApp dark chat background.
const QUOTE_BG_COLOR = process.env.QUOTE_BG_COLOR || '#0b141a';
const QUOTE_TIMEOUT_MS = Number.parseInt(process.env.QUOTE_TIMEOUT_MS || '20000', 10);

const TEMP_DIR = path.join(process.cwd(), 'temp', 'quotes');

const extractTextFromMessage = (message = {}) => {
  const text = message.conversation?.trim() || message.extendedTextMessage?.text;
  if (text) return text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.fileName) return message.documentMessage.fileName;
  return '';
};

const getContactNameFromSock = (sock, jid) => {
  const contact = sock?.contacts?.[jid];
  return contact?.notify || contact?.name || contact?.short || null;
};

const resolveDisplayName = async (sock, jid) => {
  if (!jid) return null;
  const fromSock = getContactNameFromSock(sock, jid);
  if (fromSock) return fromSock;
  try {
    const map = await fetchLatestPushNames([jid]);
    return map.get(jid) || null;
  } catch (error) {
    return null;
  }
};

const buildFallbackAvatarUrl = (seed) =>
  `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(seed || 'OmniZap')}`;

const resolveAvatarUrl = async (sock, jid, fallbackSeed) => {
  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    if (url) return url;
  } catch (error) {
    // ignore
  }
  return buildFallbackAvatarUrl(fallbackSeed);
};

const resolveAvatarDataUrl = async (sock, jid, fallbackSeed) => {
  const url = await resolveAvatarUrl(sock, jid, fallbackSeed);
  if (!url) return buildFallbackAvatarUrl(fallbackSeed);

  // If already a data URL, keep as-is.
  if (url.startsWith('data:')) return url;

  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    const contentType = response.headers?.['content-type'] || 'image/jpeg';
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    return buildFallbackAvatarUrl(fallbackSeed);
  }
};

const writeTempFile = async (buffer, extension) => {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const filename = `quote_${uuidv4()}.${extension}`;
  const filePath = path.join(TEMP_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
};

const sendUsage = async (sock, remoteJid, messageInfo, expirationMessage) => {
  await sock.sendMessage(
    remoteJid,
    {
      text: [
        '🖼️ *Quote*',
        '',
        'Use assim:',
        `*${COMMAND_PREFIX}quote* sua mensagem`,
        '',
        'Ou responda uma mensagem com:',
        `*${COMMAND_PREFIX}quote*`,
      ].join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

export async function handleQuoteCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  senderName,
  text,
}) {
  const contextInfo = messageInfo.message?.extendedTextMessage?.contextInfo;
  const quotedMessage = contextInfo?.quotedMessage;
  const quotedParticipant = contextInfo?.participant;
  const mentionedJids = contextInfo?.mentionedJid || [];

  const targetJid = quotedParticipant || mentionedJids[0] || senderJid;

  const quoteText = quotedMessage ? extractTextFromMessage(quotedMessage) : text?.trim();
  if (!quoteText) {
    await sendUsage(sock, remoteJid, messageInfo, expirationMessage);
    return;
  }

  const resolvedName = await resolveDisplayName(sock, targetJid);
  const fallbackName = `@${getJidUser(targetJid) || 'user'}`;
  const authorName = resolvedName || senderName || fallbackName;

  const avatarUrl = await resolveAvatarDataUrl(sock, targetJid, authorName);

  const payload = {
    type: 'quote',
    format: 'png',
    backgroundColor: QUOTE_BG_COLOR,
    messages: [
      {
        entities: [],
        avatar: true,
        from: {
          id: 1,
          name: authorName,
          photo: { url: avatarUrl },
        },
        text: quoteText,
        replyMessage: {},
      },
    ],
  };

  try {
    const response = await axios.post(QUOTE_API_URL, payload, {
      responseType: 'arraybuffer',
      timeout: QUOTE_TIMEOUT_MS,
    });
    let imageBuffer = Buffer.from(response.data);
    const contentType = response.headers?.['content-type'] || '';
    if (contentType.includes('application/json')) {
      const json = JSON.parse(imageBuffer.toString('utf8'));
      if (json?.image) {
        imageBuffer = Buffer.from(json.image, 'base64');
      }
    } else if (imageBuffer.slice(0, 1).toString() === '{') {
      try {
        const json = JSON.parse(imageBuffer.toString('utf8'));
        if (json?.image) {
          imageBuffer = Buffer.from(json.image, 'base64');
        }
      } catch (error) {
        // keep raw buffer
      }
    }

    const pngPath = await writeTempFile(imageBuffer, 'png');
    const userId = getJidUser(senderJid) || senderJid || 'unknown';
    let stickerPath;

    try {
      const webpPath = await convertToWebp(pngPath, 'image', userId, uuidv4());
      stickerPath = await addStickerMetadata(webpPath, 'OmniZap Quotes', senderName || 'OmniZap', {
        senderName,
        userId: senderJid,
      });
    } catch (error) {
      stickerPath = null;
    }

    if (stickerPath) {
      const stickerBuffer = await fs.readFile(stickerPath);
      await sock.sendMessage(
        remoteJid,
        { sticker: stickerBuffer },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    await sock.sendMessage(
      remoteJid,
      { image: imageBuffer, caption: '🖼️ Quote' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleQuoteCommand: erro ao gerar quote.', error);
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Não foi possível gerar o quote agora. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
