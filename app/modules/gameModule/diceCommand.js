import logger from '../../utils/logger/loggerModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const MAX_SIDES = 1000;

const parseSidesArgument = (rawArg) => {
  if (!rawArg) return 6;
  const parsed = Number.parseInt(rawArg, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 2 || parsed > MAX_SIDES) return null;
  return parsed;
};

const rollDice = (sides) => Math.floor(Math.random() * sides) + 1;

const buildUsageText = (commandPrefix) =>
  [`Formato de uso:`, `${commandPrefix}dado`, `${commandPrefix}dado <lados (2-${MAX_SIDES})>`, `${commandPrefix}dice <lados (2-${MAX_SIDES})>`].join('\n');

export async function handleDiceCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  args = [],
  commandPrefix = '/',
}) {
  const sides = parseSidesArgument(args[0]);
  if (sides === null) {
    await sendAndStore(
      sock,
      remoteJid,
      { text: `❌ Número de lados inválido.\n\n${buildUsageText(commandPrefix)}` },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const result = rollDice(sides);
  const face = sides === 6 ? DICE_FACES[result - 1] : '🎲';
  const messageText =
    sides === 6
      ? `🎲 Você rolou o dado e caiu em *${result}* ${face}`
      : `🎲 Você rolou um dado de *${sides}* lados e caiu em *${result}*`;

  try {
    await sendAndStore(
      sock,
      remoteJid,
      { text: messageText },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleDiceCommand: erro ao enviar resultado do dado.', {
      error: error.message,
      remoteJid,
      sides,
      result,
    });
    await sendAndStore(
      sock,
      remoteJid,
      { text: '❌ Não foi possível rolar o dado agora. Tente novamente.' },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  }
}
