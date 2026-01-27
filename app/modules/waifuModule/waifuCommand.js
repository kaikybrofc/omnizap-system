import axios from 'axios';

import logger from '../../utils/logger/loggerModule.js';

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const WAIFU_API_BASE = process.env.WAIFU_API_BASE || 'https://waifu.it/api/v4';
const WAIFU_API_TOKEN = process.env.WAIFU_API_TOKEN;
const WAIFU_TIMEOUT_MS = Number.parseInt(process.env.WAIFU_TIMEOUT_MS || '15000', 10);

const ensureToken = async (sock, remoteJid, messageInfo, expirationMessage) => {
  if (WAIFU_API_TOKEN) return true;
  await sock.sendMessage(
    remoteJid,
    { text: '❌ WAIFU_API_TOKEN não configurado no ambiente.' },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
  return false;
};

const extractParam = (text, key) => {
  if (!text) return { value: null, rest: text };
  const pattern = new RegExp(`${key}\\s*[:=]\\s*([^]+?)(?=\\s+\\w+\\s*[:=]|$)`, 'i');
  const match = text.match(pattern);
  if (!match) return { value: null, rest: text };
  const value = match[1].trim();
  const rest = text.replace(match[0], '').trim();
  return { value, rest };
};

const parseParams = (text, keys, defaultKey) => {
  let remaining = text?.trim() || '';
  const params = {};
  for (const key of keys) {
    const { value, rest } = extractParam(remaining, key);
    if (value) params[key] = value;
    remaining = rest;
  }
  if (remaining && !params[defaultKey]) params[defaultKey] = remaining;
  return params;
};

const buildWaifuCaption = (data) => {
  const name = data?.name?.full || data?.name?.userPreferred || 'Personagem';
  const node = data?.media?.nodes?.[0];
  const title =
    node?.title?.romaji ||
    node?.title?.english ||
    node?.title?.native ||
    node?.title?.userPreferred;
  if (title) {
    return `✨ *${name}*\n🎬 *${title}*`;
  }
  return `✨ *${name}*`;
};

export async function handleWaifuImageCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  text,
  endpoint,
}) {
  if (!(await ensureToken(sock, remoteJid, messageInfo, expirationMessage))) return;

  const params = parseParams(text, ['name', 'anime'], 'name');

  try {
    const { data } = await axios.get(`${WAIFU_API_BASE}/${endpoint}`, {
      headers: { Authorization: WAIFU_API_TOKEN },
      params,
      timeout: WAIFU_TIMEOUT_MS,
    });

    const imageUrl = data?.image?.large;
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
      {
        image: { url: imageUrl },
        caption: buildWaifuCaption(data),
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleWaifuImageCommand: erro na Waifu.it.', error);
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Erro ao consultar a Waifu.it. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}

export async function handleWaifuFactCommand({ sock, remoteJid, messageInfo, expirationMessage }) {
  if (!(await ensureToken(sock, remoteJid, messageInfo, expirationMessage))) return;

  try {
    const { data } = await axios.get(`${WAIFU_API_BASE}/fact`, {
      headers: { Authorization: WAIFU_API_TOKEN },
      timeout: WAIFU_TIMEOUT_MS,
    });
    const fact = data?.fact;
    if (!fact) throw new Error('fact vazio');

    await sock.sendMessage(
      remoteJid,
      { text: `📚 *Anime Fact*\n${fact}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleWaifuFactCommand: erro na Waifu.it.', error);
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Erro ao consultar a Waifu.it. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}

export async function handleWaifuQuoteCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  text,
}) {
  if (!(await ensureToken(sock, remoteJid, messageInfo, expirationMessage))) return;

  const params = parseParams(text, ['character', 'anime'], 'character');

  try {
    const { data } = await axios.get(`${WAIFU_API_BASE}/quote`, {
      headers: { Authorization: WAIFU_API_TOKEN },
      params,
      timeout: WAIFU_TIMEOUT_MS,
    });
    const quote = data?.quote;
    if (!quote) throw new Error('quote vazio');

    const author = data?.author ? `— ${data.author}` : '';
    const from = data?.from ? `\n🎬 ${data.from}` : '';

    await sock.sendMessage(
      remoteJid,
      { text: `💬 *Anime Quote*\n${quote}\n${author}${from}`.trim() },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleWaifuQuoteCommand: erro na Waifu.it.', error);
    await sock.sendMessage(
      remoteJid,
      { text: '❌ Erro ao consultar a Waifu.it. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}

export const getWaifuUsageText = (commandPrefix = DEFAULT_COMMAND_PREFIX) =>
  [
    '🌸 *Waifu.it*',
    '',
    `*${commandPrefix}waifu* [nome|anime:Nome]`,
    `*${commandPrefix}husbando* [nome|anime:Nome]`,
    `*${commandPrefix}animefact*`,
    `*${commandPrefix}animequote* [character:Nome|anime:Nome]`,
  ].join('\n');
