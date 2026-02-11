import { sendAndStore } from '../../services/messagePersistenceService.js';
import { resolveUserIdCached } from '../../services/lidMapService.js';
import logger from '../../utils/logger/loggerModule.js';
import { buildUsageText } from './rpgPokemonMessages.js';
import { executeRpgPokemonAction } from './rpgPokemonService.js';

const ALLOWED_ACTIONS = new Set([
  'start',
  'perfil',
  'explorar',
  'atacar',
  'capturar',
  'fugir',
  'time',
  'escolher',
  'loja',
  'comprar',
  'usar',
  'bolsa',
  'pokedex',
  'missoes',
  'missões',
  'viajar',
  'tm',
  'berry',
  'raid',
  'desafiar',
  'pvp',
  'ginasio',
  'ginásio',
  'trade',
  'coop',
  'evento',
  'social',
  'karma',
  'engajamento',
]);

const getContextInfo = (messageInfo) => {
  const root = messageInfo?.message;
  if (!root || typeof root !== 'object') return null;

  for (const value of Object.values(root)) {
    if (value?.contextInfo && typeof value.contextInfo === 'object') {
      return value.contextInfo;
    }
    if (value?.message && typeof value.message === 'object') {
      for (const nested of Object.values(value.message)) {
        if (nested?.contextInfo && typeof nested.contextInfo === 'object') {
          return nested.contextInfo;
        }
      }
    }
  }

  return null;
};

const extractMentionedJids = (messageInfo) => {
  const contextInfo = getContextInfo(messageInfo);
  if (!Array.isArray(contextInfo?.mentionedJid)) return [];
  return Array.from(new Set(contextInfo.mentionedJid.filter((jid) => typeof jid === 'string' && jid.trim())));
};

const resolveOwnerJid = ({ senderJid, senderIdentity }) => {
  if (senderIdentity && typeof senderIdentity === 'object') {
    const resolved = resolveUserIdCached({
      jid: senderIdentity?.jid || senderJid || null,
      lid: senderIdentity?.participant || senderIdentity?.jid || senderJid || null,
      participantAlt: senderIdentity?.participantAlt || null,
    });

    if (resolved) return resolved;
  }

  if (senderJid && typeof senderJid === 'string') {
    return (
      resolveUserIdCached({
        jid: senderJid,
        lid: senderJid,
        participantAlt: null,
      }) || senderJid
    );
  }

  return null;
};

export const handleRpgPokemonCommand = async ({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  senderIdentity = null,
  args = [],
  commandPrefix = '/',
}) => {
  const action = String(args?.[0] || '').trim().toLowerCase();

  if (!action) {
    await sendAndStore(
      sock,
      remoteJid,
      { text: buildUsageText(commandPrefix) },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: `${buildUsageText(commandPrefix)}\n\nUse um subcomando válido depois de ${commandPrefix}rpg.`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const ownerJid = resolveOwnerJid({ senderJid, senderIdentity });
  if (!ownerJid) {
    await sendAndStore(
      sock,
      remoteJid,
      { text: '❌ Não foi possível identificar o jogador para o RPG.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  try {
    const result = await executeRpgPokemonAction({
      ownerJid,
      chatJid: remoteJid,
      action,
      actionArgs: args.slice(1),
      mentionedJids: extractMentionedJids(messageInfo),
      commandPrefix,
    });

    const responseText = result?.text || '❌ Não foi possível processar o comando RPG agora.';
    const mentions = Array.isArray(result?.mentions) ? result.mentions.filter(Boolean) : [];
    const imageBuffer = Buffer.isBuffer(result?.imageBuffer) ? result.imageBuffer : null;
    const imageUrl = typeof result?.imageUrl === 'string' && result.imageUrl.trim() ? result.imageUrl.trim() : null;
    const caption = responseText;

    if (imageBuffer) {
      try {
        await sendAndStore(
          sock,
          remoteJid,
          {
            image: imageBuffer,
            caption,
            ...(mentions.length ? { mentions } : {}),
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        return;
      } catch (error) {
        logger.warn('Falha ao enviar frame canvas do RPG Pokemon. Fallback para imagem URL/texto.', {
          ownerJid,
          action,
          error: error.message,
        });
      }
    }

    if (imageUrl) {
      try {
        await sendAndStore(
          sock,
          remoteJid,
          {
            image: { url: imageUrl },
            caption,
            ...(mentions.length ? { mentions } : {}),
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        return;
      } catch (error) {
        logger.warn('Falha ao enviar imagem do RPG Pokemon. Enviando texto puro.', {
          ownerJid,
          action,
          imageUrl,
          error: error.message,
        });
      }
    }

    await sendAndStore(
      sock,
      remoteJid,
      { text: responseText, ...(mentions.length ? { mentions } : {}) },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('Erro no comando RPG Pokemon.', {
      ownerJid,
      action,
      error: error.message,
    });

    await sendAndStore(
      sock,
      remoteJid,
      { text: '❌ Erro ao executar comando RPG. Tente novamente em instantes.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
};
