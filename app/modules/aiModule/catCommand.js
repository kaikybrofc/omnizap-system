import OpenAI from 'openai';
import NodeCache from 'node-cache';

import logger from '../../utils/logger/loggerModule.js';
import premiumUserStore from '../../store/premiumUserStore.js';
import aiPromptStore from '../../store/aiPromptStore.js';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';
const DEFAULT_SYSTEM_PROMPT = `
Você é uma IA fictícia que responde de forma IRÔNICA, ÁCIDA e SEMI-REALISTA, simulando relatos de acidentes, crimes e caos.
`.trim();

const SYSTEM_PROMPT = process.env.OPENAI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const OWNER_JID = process.env.USER_ADMIN;

const SESSION_TTL_SECONDS = Number.parseInt(process.env.OPENAI_SESSION_TTL_SECONDS || '21600', 10);
const sessionCache = new NodeCache({
  stdTTL: SESSION_TTL_SECONDS,
  checkperiod: Math.max(60, Math.floor(SESSION_TTL_SECONDS / 4)),
});
let cachedClient = null;

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
        `*${commandPrefix}cat* sua pergunta ou mensagem`,
        '',
        'Exemplo:',
        `*${commandPrefix}cat* Explique como funciona a fotossíntese.`,
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

export async function handleCatCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  text,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
}) {
  const prompt = text?.trim();
  if (!prompt) {
    await sendUsage(sock, remoteJid, messageInfo, expirationMessage, commandPrefix);
    return;
  }

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

  const sessionKey = buildSessionKey(remoteJid, senderJid);
  const session = sessionCache.get(sessionKey);
  const userPrompt = await aiPromptStore.getPrompt(senderJid);
  const effectivePrompt = userPrompt || SYSTEM_PROMPT;

  const payload = {
    model: OPENAI_MODEL,
    input: prompt,
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
