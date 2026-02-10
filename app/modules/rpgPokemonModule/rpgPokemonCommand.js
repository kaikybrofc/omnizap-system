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
]);

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
      commandPrefix,
    });

    const responseText = result?.text || '❌ Não foi possível processar o comando RPG agora.';
    const imageUrl = typeof result?.imageUrl === 'string' && result.imageUrl.trim() ? result.imageUrl.trim() : null;
    const caption = responseText;

    if (imageUrl) {
      try {
        await sendAndStore(
          sock,
          remoteJid,
          {
            image: { url: imageUrl },
            caption,
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
      { text: responseText },
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
