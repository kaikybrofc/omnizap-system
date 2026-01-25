import axios from 'axios';

import logger from '../../utils/logger/loggerModule.js';

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const WAIFU_PICS_BASE = (process.env.WAIFU_PICS_BASE || 'https://api.waifu.pics').replace(/\/$/, '');
const WAIFU_PICS_TIMEOUT_MS = Number.parseInt(process.env.WAIFU_PICS_TIMEOUT_MS || '15000', 10);
const WAIFU_PICS_ALLOW_NSFW = process.env.WAIFU_PICS_ALLOW_NSFW === 'true';

const SFW_CATEGORIES = [
  'waifu',
  'neko',
  'shinobu',
  'megumin',
  'bully',
  'cuddle',
  'cry',
  'hug',
  'awoo',
  'kiss',
  'lick',
  'pat',
  'smug',
  'bonk',
  'yeet',
  'blush',
  'smile',
  'wave',
  'highfive',
  'handhold',
  'nom',
  'bite',
  'glomp',
  'slap',
  'kill',
  'kick',
  'happy',
  'wink',
  'poke',
  'dance',
  'cringe',
];

const NSFW_CATEGORIES = ['waifu', 'neko', 'trap', 'blowjob'];

const sendUsage = async (sock, remoteJid, messageInfo, expirationMessage, type) => {
  const list = type === 'nsfw' ? NSFW_CATEGORIES : SFW_CATEGORIES;
  await sock.sendMessage(
    remoteJid,
    {
      text: [
        `🖼️ *Waifu.pics (${type.toUpperCase()})*`,
        '',
        `Use: *${COMMAND_PREFIX}wp${type === 'nsfw' ? 'nsfw' : ''} <categoria>*`,
        '',
        `Categorias: ${list.join(', ')}`,
      ].join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

const fetchWaifuPics = async (type, category) => {
  const url = `${WAIFU_PICS_BASE}/${type}/${category}`;
  const { data } = await axios.get(url, { timeout: WAIFU_PICS_TIMEOUT_MS });
  return data?.url || null;
};

export async function handleWaifuPicsCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  text,
  type = 'sfw',
}) {
  const category = (text || '').trim().toLowerCase() || 'waifu';

  if (type === 'nsfw' && !WAIFU_PICS_ALLOW_NSFW) {
    await sock.sendMessage(
      remoteJid,
      { text: '⚠️ Conteúdo NSFW desativado. Habilite WAIFU_PICS_ALLOW_NSFW=true no .env.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const allowed = type === 'nsfw' ? NSFW_CATEGORIES : SFW_CATEGORIES;
  if (!allowed.includes(category)) {
    await sendUsage(sock, remoteJid, messageInfo, expirationMessage, type);
    return;
  }

  try {
    const imageUrl = await fetchWaifuPics(type, category);
    if (!imageUrl) {
      await sock.sendMessage(
        remoteJid,
        { text: '❌ Não foi possível obter a imagem agora. Tente novamente.' },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    await sock.sendMessage(
      remoteJid,
      { image: { url: imageUrl }, caption: `🖼️ ${type.toUpperCase()} • ${category}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleWaifuPicsCommand: erro na Waifu.pics.', error);
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Erro ao consultar a Waifu.pics. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}

export const getWaifuPicsUsageText = () =>
  [
    '🖼️ *Waifu.pics*',
    '',
    `*${COMMAND_PREFIX}wp* <categoria>`,
    `*${COMMAND_PREFIX}wpnsfw* <categoria>`,
    '',
    `SFW: ${SFW_CATEGORIES.join(', ')}`,
    `NSFW: ${NSFW_CATEGORIES.join(', ')}`,
  ].join('\n');
