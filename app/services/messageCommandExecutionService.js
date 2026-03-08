import { handleMenuCommand } from '../modules/menuModule/menus.js';
import { handleAdminCommand } from '../modules/adminModule/groupCommandHandlers.js';
import { buildGlobalUnknownCommandSuggestion } from './globalModuleAiHelpService.js';
import { processSticker } from '../modules/stickerModule/stickerCommand.js';
import {
  processBlinkingTextSticker,
  processTextSticker,
} from '../modules/stickerModule/stickerTextCommand.js';
import { handlePlayCommand, handlePlayVidCommand } from '../modules/playModule/playCommand.js';
import { handleRankingCommand } from '../modules/statsModule/rankingCommand.js';
import { handleGlobalRankingCommand } from '../modules/statsModule/globalRankingCommand.js';
import { handlePingCommand } from '../modules/systemMetricsModule/pingCommand.js';
import {
  handleCatCommand,
  handleCatImageCommand,
  handleCatPromptCommand,
} from '../modules/aiModule/catCommand.js';
import { handleQuoteCommand } from '../modules/quoteModule/quoteCommand.js';
import { handleStickerConvertCommand } from '../modules/stickerModule/stickerConvertCommand.js';
import {
  handleWaifuPicsCommand,
  getWaifuPicsUsageText,
} from '../modules/waifuPicsModule/waifuPicsCommand.js';
import { handlePackCommand } from '../modules/stickerPackModule/stickerPackCommandHandlers.js';
import { handleUserCommand } from '../modules/userModule/userCommand.js';
import { handleDiceCommand } from '../modules/gameModule/diceCommand.js';
import { handleTikTokCommand } from '../modules/tiktokModule/tiktokCommand.js';
import { handleRpgPokemonCommand } from '../modules/rpgPokemonModule/rpgPokemonCommand.js';
import logger from '../../utils/logger/loggerModule.js';

const normalizeCommand = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

export const executeMessageCommandRoute = async ({
  command,
  args = [],
  text = '',
  isAdminCommandRoute = false,
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  senderName,
  senderIdentity,
  botJid,
  isGroupMessage,
  commandPrefix = '/',
  runCommand,
  sendReply,
} = {}) => {
  if (typeof runCommand !== 'function') {
    throw new Error('executeMessageCommandRoute: runCommand e obrigatorio');
  }
  if (typeof sendReply !== 'function') {
    throw new Error('executeMessageCommandRoute: sendReply e obrigatorio');
  }

  const normalizedCommand = normalizeCommand(command);
  const safeArgs = Array.isArray(args) ? args : [];
  const safeText = String(text || '');

  let commandResult = { ok: true };
  let commandRoute = normalizedCommand || 'unknown';

  switch (normalizedCommand) {
    case 'menu':
      commandResult = await runCommand('menu', () =>
        handleMenuCommand(
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderName,
          commandPrefix,
          safeArgs,
        ),
      );
      break;
    case 'sticker':
    case 's':
      commandResult = await runCommand('sticker', () =>
        processSticker(
          sock,
          messageInfo,
          senderJid,
          remoteJid,
          expirationMessage,
          senderName,
          safeArgs.join(' '),
          { commandPrefix },
        ),
      );
      break;
    case 'pack':
    case 'packs':
      commandResult = await runCommand('pack', () =>
        handlePackCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
          senderName,
          text: safeText,
          commandPrefix,
        }),
      );
      break;
    case 'toimg':
    case 'tovideo':
    case 'tovid':
      commandResult = await runCommand('toimg', () =>
        handleStickerConvertCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
        }),
      );
      break;
    case 'play':
      commandResult = await runCommand('play', () =>
        handlePlayCommand(sock, remoteJid, messageInfo, expirationMessage, safeText, commandPrefix),
      );
      break;
    case 'playvid':
      commandResult = await runCommand('playvid', () =>
        handlePlayVidCommand(
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          safeText,
          commandPrefix,
        ),
      );
      break;
    case 'tiktok':
    case 'tt':
      commandResult = await runCommand('tiktok', () =>
        handleTikTokCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: safeText,
          commandPrefix,
        }),
      );
      break;
    case 'cat':
      commandResult = await runCommand('cat', () =>
        handleCatCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
          text: safeText,
          commandPrefix,
        }),
      );
      break;
    case 'catimg':
    case 'catimage':
      commandResult = await runCommand('catimg', () =>
        handleCatImageCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
          text: safeText,
          commandPrefix,
        }),
      );
      break;
    case 'catprompt':
    case 'iaprompt':
    case 'promptia':
      commandResult = await runCommand('catprompt', () =>
        handleCatPromptCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
          text: safeText,
          commandPrefix,
        }),
      );
      break;
    case 'quote':
    case 'qc':
      commandResult = await runCommand('quote', () =>
        handleQuoteCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
          senderName,
          text: safeText,
          commandPrefix,
        }),
      );
      break;
    case 'wp':
    case 'waifupics':
      commandResult = await runCommand('waifupics', () =>
        handleWaifuPicsCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: safeText,
          type: 'sfw',
          commandPrefix,
        }),
      );
      break;
    case 'wpnsfw':
    case 'waifupicsnsfw':
      commandResult = await runCommand('waifupicsnsfw', () =>
        handleWaifuPicsCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: safeText,
          type: 'nsfw',
          commandPrefix,
        }),
      );
      break;
    case 'wppicshelp':
      commandResult = await runCommand('wppicshelp', () =>
        sendReply(sock, remoteJid, messageInfo, expirationMessage, {
          text: getWaifuPicsUsageText(commandPrefix),
        }),
      );
      break;
    case 'stickertext':
    case 'st':
      commandResult = await runCommand('stickertext', () =>
        processTextSticker({
          sock,
          messageInfo,
          remoteJid,
          senderJid,
          senderName,
          text: safeText,
          extraText: 'PackZoeira',
          expirationMessage,
          color: 'black',
          commandPrefix,
        }),
      );
      break;
    case 'stickertextwhite':
    case 'stw':
      commandResult = await runCommand('stickertextwhite', () =>
        processTextSticker({
          sock,
          messageInfo,
          remoteJid,
          senderJid,
          senderName,
          text: safeText,
          extraText: 'PackZoeira',
          expirationMessage,
          color: 'white',
          commandPrefix,
        }),
      );
      break;
    case 'stickertextblink':
    case 'stb':
      commandResult = await runCommand('stickertextblink', () =>
        processBlinkingTextSticker({
          sock,
          messageInfo,
          remoteJid,
          senderJid,
          senderName,
          text: safeText,
          extraText: 'PackZoeira',
          expirationMessage,
          color: 'white',
          commandPrefix,
        }),
      );
      break;
    case 'ranking':
    case 'rank':
    case 'top5':
      commandResult = await runCommand('ranking', () =>
        handleRankingCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          isGroupMessage,
        }),
      );
      break;
    case 'rankingglobal':
    case 'rankglobal':
    case 'globalrank':
    case 'globalranking':
      commandResult = await runCommand('rankingglobal', () =>
        handleGlobalRankingCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          isGroupMessage,
        }),
      );
      break;
    case 'ping':
      commandResult = await runCommand('ping', () =>
        handlePingCommand({ sock, remoteJid, messageInfo, expirationMessage }),
      );
      break;
    case 'dado':
    case 'dice':
      commandResult = await runCommand('dado', () =>
        handleDiceCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          args: safeArgs,
          commandPrefix,
        }),
      );
      break;
    case 'user':
    case 'usuario':
      commandResult = await runCommand('user', () =>
        handleUserCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
          args: safeArgs,
          isGroupMessage,
          commandPrefix,
        }),
      );
      break;
    case 'rpg':
      commandResult = await runCommand('rpg', () =>
        handleRpgPokemonCommand({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          senderJid,
          senderIdentity,
          args: safeArgs,
          commandPrefix,
        }),
      );
      break;
    default: {
      if (isAdminCommandRoute) {
        commandRoute = 'admin';
        commandResult = await runCommand('admin', () =>
          handleAdminCommand({
            command: normalizedCommand,
            args: safeArgs,
            text: safeText,
            sock,
            messageInfo,
            remoteJid,
            senderJid,
            botJid,
            isGroupMessage,
            expirationMessage,
            commandPrefix,
          }),
        );
        break;
      }

      commandRoute = 'unknown';
      logger.info(`Comando desconhecido recebido: ${normalizedCommand}`);
      const globalSuggestion = buildGlobalUnknownCommandSuggestion(normalizedCommand, {
        commandPrefix,
      });
      commandResult = await runCommand('unknown', () =>
        sendReply(sock, remoteJid, messageInfo, expirationMessage, {
          text: globalSuggestion
            ? `❌ *Comando não reconhecido*\n\nO comando *${normalizedCommand}* não está configurado ou ainda não existe.\n\n${globalSuggestion}\n\nℹ️ *Dica:*  \nDigite *${commandPrefix}menu* para ver a lista geral de comandos.\n\n🚧 *Fase Beta*  \nO omnizap-system ainda está em desenvolvimento e novos comandos estão sendo adicionados constantemente.`
            : `❌ *Comando não reconhecido*\n\nO comando *${normalizedCommand}* não está configurado ou ainda não existe.\n\nℹ️ *Dica:*  \nDigite *${commandPrefix}menu* para ver a lista de comandos disponíveis.\n\n🚧 *Fase Beta*  \nO omnizap-system ainda está em desenvolvimento e novos comandos estão sendo adicionados constantemente.`,
        }),
      );
      break;
    }
  }

  return {
    commandRoute,
    commandResult,
  };
};
