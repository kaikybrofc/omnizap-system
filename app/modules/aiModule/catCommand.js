import OpenAI from 'openai';
import NodeCache from 'node-cache';
import fs from 'node:fs/promises';
import path from 'node:path';

import logger from '../../utils/logger/loggerModule.js';
import premiumUserStore from '../../store/premiumUserStore.js';
import aiPromptStore from '../../store/aiPromptStore.js';
import {
  downloadMediaMessage,
  extractAllMediaDetails,
  getJidUser,
} from '../../config/baileysConfig.js';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';
const OPENAI_TTS_FORMAT = (process.env.OPENAI_TTS_FORMAT || 'mp3').toLowerCase();
const OPENAI_TTS_PTT = process.env.OPENAI_TTS_PTT === 'true';
const OPENAI_TTS_MAX_CHARS = Number.parseInt(process.env.OPENAI_TTS_MAX_CHARS || '4096', 10);
const OPENAI_MAX_IMAGE_MB = Number.parseFloat(process.env.OPENAI_MAX_IMAGE_MB || '50');
const DEFAULT_SYSTEM_PROMPT = `
Você é uma IA fictícia que responde de forma IRÔNICA, ÁCIDA e SEMI-REALISTA, simulando relatos de acidentes, crimes e caos.
`.trim();
const DEFAULT_IMAGE_PROMPT = 'Descreva a imagem enviada.';
const TEMP_DIR = path.join(process.cwd(), 'temp', 'ai');

const SYSTEM_PROMPT = process.env.OPENAI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const OWNER_JID = process.env.USER_ADMIN;

const SESSION_TTL_SECONDS = Number.parseInt(process.env.OPENAI_SESSION_TTL_SECONDS || '21600', 10);
const sessionCache = new NodeCache({
  stdTTL: SESSION_TTL_SECONDS,
  checkperiod: Math.max(60, Math.floor(SESSION_TTL_SECONDS / 4)),
});
let cachedClient = null;

const AUDIO_FLAG_ALIASES = new Set(['--audio', '--voz', '--voice', '--tts', '-a']);
const TEXT_FLAG_ALIASES = new Set(['--texto', '--text', '--txt']);
const AUDIO_MIME_BY_FORMAT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
};
const SAFE_TTS_FORMAT = AUDIO_MIME_BY_FORMAT[OPENAI_TTS_FORMAT] ? OPENAI_TTS_FORMAT : 'mp3';
const TTS_MAX_CHARS =
  Number.isFinite(OPENAI_TTS_MAX_CHARS) && OPENAI_TTS_MAX_CHARS > 0 ? OPENAI_TTS_MAX_CHARS : 4096;
const MAX_IMAGE_BYTES =
  Number.isFinite(OPENAI_MAX_IMAGE_MB) && OPENAI_MAX_IMAGE_MB > 0
    ? OPENAI_MAX_IMAGE_MB * 1024 * 1024
    : 50 * 1024 * 1024;

const getClient = () => {
  if (cachedClient) return cachedClient;
  cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cachedClient;
};

const buildSessionKey = (remoteJid, senderJid) => `${remoteJid}:${senderJid}`;

const sendUsage = async (
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
) => {
  await sock.sendMessage(
    remoteJid,
    {
      text: [
        '🤖 *Comando CAT*',
        '',
        'Use assim:',
        `*${commandPrefix}cat* [--audio] sua pergunta`,
        `*${commandPrefix}cat* (responda ou envie uma imagem com legenda)`,
        '',
        'Exemplo:',
        `*${commandPrefix}cat* Explique como funciona a fotossíntese.`,
        `*${commandPrefix}cat* --audio Resuma a imagem.`,
      ].join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

const reactToMessage = async (sock, remoteJid, messageInfo) => {
  try {
    if (!messageInfo?.key) return;
    await sock.sendMessage(remoteJid, {
      react: {
        text: '🐈‍⬛',
        key: messageInfo.key,
      },
    });
  } catch (error) {
    logger.warn('handleCatCommand: falha ao reagir à mensagem.', error);
  }
};

const isPremiumAllowed = async (senderJid) => {
  if (!OWNER_JID) return true;
  if (senderJid === OWNER_JID) return true;
  const premiumUsers = await premiumUserStore.getPremiumUsers();
  return premiumUsers.includes(senderJid);
};

const sendPremiumOnly = async (sock, remoteJid, messageInfo, expirationMessage) => {
  await sock.sendMessage(
    remoteJid,
    {
      text: [
        '⭐ *Comando Premium*',
        '',
        'Este comando é exclusivo para usuários premium.',
        'Fale com o administrador para liberar o acesso.',
      ].join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

const sendPromptUsage = async (
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
) => {
  await sock.sendMessage(
    remoteJid,
    {
      text: [
        '🧠 *Prompt da IA*',
        '',
        'Use assim:',
        `*${commandPrefix}catprompt* seu novo prompt`,
        '',
        'Para voltar ao padrão:',
        `*${commandPrefix}catprompt reset*`,
      ].join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

const parseCatOptions = (rawText = '') => {
  const tokens = rawText.trim().split(/\s+/).filter(Boolean);
  let wantsAudio = false;
  const filtered = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (AUDIO_FLAG_ALIASES.has(lower)) {
      wantsAudio = true;
      continue;
    }
    if (TEXT_FLAG_ALIASES.has(lower)) {
      wantsAudio = false;
      continue;
    }
    filtered.push(token);
  }

  return {
    prompt: filtered.join(' ').trim(),
    wantsAudio,
  };
};

const resolveAudioMimeType = (format) => AUDIO_MIME_BY_FORMAT[format] || 'audio/mpeg';

const buildUserTempDir = (senderJid) => {
  const userId = getJidUser(senderJid) || senderJid || 'anon';
  const sanitizedUserId = String(userId).replace(/[^a-zA-Z0-9.-]/g, '_');
  return path.join(TEMP_DIR, sanitizedUserId);
};

const findImageMedia = (messageInfo) => {
  const mediaEntries = extractAllMediaDetails(messageInfo, {
    includeAllTypes: true,
    includeQuoted: true,
    includeUnknown: false,
  });
  return mediaEntries.find((entry) => entry.mediaType === 'image') || null;
};

const buildImageDataUrl = async (imageMedia, senderJid) => {
  if (!imageMedia) {
    return { dataUrl: null };
  }

  const fileLength = imageMedia.fileLength || imageMedia.mediaKey?.fileLength || 0;
  if (fileLength && fileLength > MAX_IMAGE_BYTES) {
    return { error: 'too_large', fileLength };
  }

  const userDir = buildUserTempDir(senderJid);
  await fs.mkdir(userDir, { recursive: true });

  let downloadedPath = null;
  try {
    downloadedPath = await downloadMediaMessage(imageMedia.mediaKey, 'image', userDir);
    if (!downloadedPath) {
      return { error: 'download_failed' };
    }

    const buffer = await fs.readFile(downloadedPath);
    const base64 = buffer.toString('base64');
    const mimeType = imageMedia.mimetype || imageMedia.mediaKey?.mimetype || 'image/jpeg';
    return { dataUrl: `data:${mimeType};base64,${base64}` };
  } finally {
    if (downloadedPath) {
      fs.unlink(downloadedPath).catch(() => {});
    }
  }
};

export async function handleCatCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  text,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
}) {
  const { prompt: rawPrompt, wantsAudio } = parseCatOptions(text || '');

  if (!process.env.OPENAI_API_KEY) {
    logger.warn('handleCatCommand: OPENAI_API_KEY não configurada.');
    await sock.sendMessage(
      remoteJid,
      {
        text: [
          '⚠️ *OpenAI não configurada*',
          '',
          'Defina a variável *OPENAI_API_KEY* no `.env` para usar o comando *cat*.',
        ].join('\n'),
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  await reactToMessage(sock, remoteJid, messageInfo);

  if (!(await isPremiumAllowed(senderJid))) {
    await sendPremiumOnly(sock, remoteJid, messageInfo, expirationMessage);
    return;
  }

  const imageMedia = findImageMedia(messageInfo);
  const imageResult = await buildImageDataUrl(imageMedia, senderJid);
  if (imageResult.error === 'too_large') {
    const limitMb = Math.round((MAX_IMAGE_BYTES / (1024 * 1024)) * 10) / 10;
    await sock.sendMessage(
      remoteJid,
      {
        text: `⚠️ A imagem enviada ultrapassa o limite de ${limitMb} MB. Envie uma imagem menor.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  if (imageResult.error === 'download_failed') {
    await sock.sendMessage(
      remoteJid,
      { text: '⚠️ Não consegui baixar a imagem. Tente reenviar.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const prompt = rawPrompt || (imageResult.dataUrl ? DEFAULT_IMAGE_PROMPT : '');
  if (!prompt && !imageResult.dataUrl) {
    await sendUsage(sock, remoteJid, messageInfo, expirationMessage, commandPrefix);
    return;
  }

  const sessionKey = buildSessionKey(remoteJid, senderJid);
  const session = sessionCache.get(sessionKey);
  const userPrompt = await aiPromptStore.getPrompt(senderJid);
  const effectivePrompt = userPrompt || SYSTEM_PROMPT;

  const content = [];
  if (prompt) {
    content.push({ type: 'input_text', text: prompt });
  }
  if (imageResult.dataUrl) {
    content.push({ type: 'input_image', image_url: imageResult.dataUrl });
  }

  const payload = {
    model: OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content,
      },
    ],
  };

  if (effectivePrompt) {
    payload.instructions = effectivePrompt;
  }

  if (session?.previousResponseId) {
    payload.previous_response_id = session.previousResponseId;
  }

  try {
    const client = getClient();
    const response = await client.responses.create(payload);
    const outputText = response.output_text?.trim();

    sessionCache.set(sessionKey, {
      previousResponseId: response.id,
      updatedAt: Date.now(),
    });

    if (!outputText) {
      await sock.sendMessage(
        remoteJid,
        { text: '⚠️ Não consegui gerar uma resposta agora. Tente novamente.' },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    if (wantsAudio) {
      if (outputText.length > TTS_MAX_CHARS) {
        await sock.sendMessage(
          remoteJid,
          { text: '⚠️ A resposta ficou longa demais para áudio. Enviando em texto.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } else {
        try {
          const audioResponse = await client.audio.speech.create({
            model: OPENAI_TTS_MODEL,
            voice: OPENAI_TTS_VOICE,
            input: outputText,
            response_format: SAFE_TTS_FORMAT,
          });
          const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
          await sock.sendMessage(
            remoteJid,
            {
              audio: audioBuffer,
              mimetype: resolveAudioMimeType(SAFE_TTS_FORMAT),
              ptt: OPENAI_TTS_PTT,
            },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
          return;
        } catch (audioError) {
          logger.error('handleCatCommand: erro ao gerar audio.', audioError);
          await sock.sendMessage(
            remoteJid,
            { text: '⚠️ Não consegui gerar o áudio agora. Enviando texto.' },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
        }
      }
    }

    await sock.sendMessage(
      remoteJid,
      { text: `🐈‍⬛ ${outputText}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleCatCommand: erro ao chamar OpenAI.', error);
    await sock.sendMessage(
      remoteJid,
      {
        text: ['❌ *Erro ao falar com a IA*', 'Tente novamente em alguns instantes.'].join('\n'),
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}

export async function handleCatPromptCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  text,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
}) {
  const promptText = text?.trim();
  if (!promptText) {
    await sendPromptUsage(sock, remoteJid, messageInfo, expirationMessage, commandPrefix);
    return;
  }

  if (!(await isPremiumAllowed(senderJid))) {
    await sendPremiumOnly(sock, remoteJid, messageInfo, expirationMessage);
    return;
  }

  const lower = promptText.toLowerCase();
  if (lower === 'reset' || lower === 'default' || lower === 'padrao' || lower === 'padrão') {
    await aiPromptStore.clearPrompt(senderJid);
    await sock.sendMessage(
      remoteJid,
      { text: '✅ Prompt da IA restaurado para o padrão.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  if (promptText.length > 2000) {
    await sock.sendMessage(
      remoteJid,
      { text: '⚠️ Prompt muito longo. Limite: 2000 caracteres.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  await aiPromptStore.setPrompt(senderJid, promptText);
  await sock.sendMessage(
    remoteJid,
    { text: '✅ Prompt da IA atualizado para você.' },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
}
