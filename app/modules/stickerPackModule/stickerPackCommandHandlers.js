import logger from '../../utils/logger/loggerModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import stickerPackService from './stickerPackServiceRuntime.js';
import { STICKER_PACK_ERROR_CODES, StickerPackError } from './stickerPackErrors.js';
import {
  captureIncomingStickerAsset,
  resolveStickerAssetForCommand,
} from './stickerStorageService.js';
import { buildStickerPackMessage, sendStickerPackWithFallback } from './stickerPackMessageService.js';

const RATE_WINDOW_MS = Math.max(10_000, Number(process.env.STICKER_PACK_RATE_WINDOW_MS) || 60_000);
const RATE_MAX_ACTIONS = Math.max(1, Number(process.env.STICKER_PACK_RATE_MAX_ACTIONS) || 20);

const rateMap = new Map();

const extractCommandParts = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return { command: '', rest: '' };

  const firstSpace = raw.indexOf(' ');
  if (firstSpace === -1) {
    return { command: raw.toLowerCase(), rest: '' };
  }

  return {
    command: raw.slice(0, firstSpace).toLowerCase(),
    rest: raw.slice(firstSpace + 1).trim(),
  };
};

const unquote = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }

  return raw;
};

const readToken = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return { token: null, rest: '' };

  const match = raw.match(/^("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+)([\s\S]*)$/);
  if (!match) return { token: null, rest: '' };

  return {
    token: unquote(match[1]),
    rest: (match[4] || '').trim(),
  };
};

const splitPipeSegments = (value) =>
  String(value || '')
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);

const parsePipeOptions = (segments) => {
  const options = {};

  for (const segment of segments) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = segment.slice(0, eqIndex).trim().toLowerCase();
    const value = unquote(segment.slice(eqIndex + 1));

    if (!key) continue;
    options[key] = value;
  }

  return options;
};

const sendReply = async ({ sock, remoteJid, messageInfo, expirationMessage, text }) =>
  sendAndStore(
    sock,
    remoteJid,
    { text },
    {
      quoted: messageInfo,
      ephemeralExpiration: expirationMessage,
    },
  );

const formatPackList = (packs) => {
  if (!packs.length) {
    return '📦 Você ainda não tem packs. Use /pack create "Nome" para começar.';
  }

  const lines = packs.map((pack, index) => {
    const count = Number(pack.sticker_count || 0);
    return `${index + 1}. *${pack.name}* (${count}) [${pack.visibility}]\n   id: ${pack.pack_key}`;
  });

  return `📦 *Seus packs* (${packs.length})\n\n${lines.join('\n')}`;
};

const formatPackInfo = (pack) => {
  const itemLines = pack.items.slice(0, 12).map((item, index) => {
    const emojis = Array.isArray(item.emojis) && item.emojis.length ? ` ${item.emojis.join(' ')}` : '';
    const coverTag = item.sticker_id === pack.cover_sticker_id ? ' (capa)' : '';
    return `${index + 1}. ${item.sticker_id.slice(0, 8)}${emojis}${coverTag}`;
  });

  const more = pack.items.length > 12 ? `\n... e mais ${pack.items.length - 12} figurinha(s)` : '';

  return [
    `📦 *${pack.name}*`,
    `id: ${pack.pack_key}`,
    `publisher: ${pack.publisher}`,
    `visibilidade: ${pack.visibility}`,
    `figurinhas: ${pack.items.length}`,
    `descrição: ${pack.description || '—'}`,
    '',
    itemLines.join('\n') || 'Sem figurinhas no pack.',
  ].join('\n') + more;
};

const buildPackHelp = (prefix) =>
  [
    `📦 *Gerenciador de Packs*`,
    `${prefix}pack create "Nome" | publisher="Seu nome" | desc="Descrição"`,
    `${prefix}pack list`,
    `${prefix}pack info <pack>`,
    `${prefix}pack add <pack> (responda uma figurinha ou use a última)`,
    `${prefix}pack setcover <pack>`,
    `${prefix}pack send <pack>`,
  ].join('\n');

const formatErrorMessage = (error) => {
  if (!(error instanceof StickerPackError)) {
    return '❌ Falha ao processar comando de pack. Tente novamente.';
  }

  switch (error.code) {
    case STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND:
      return '❌ Pack não encontrado. Use /pack list para conferir os IDs.';
    case STICKER_PACK_ERROR_CODES.DUPLICATE_STICKER:
      return '⚠️ Essa figurinha já está nesse pack.';
    case STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED:
      return `⚠️ ${error.message}`;
    case STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND:
      return '❌ Não encontrei figurinha válida (responda uma figurinha ou envie uma antes).';
    case STICKER_PACK_ERROR_CODES.INVALID_INPUT:
      return `❌ ${error.message}`;
    case STICKER_PACK_ERROR_CODES.STORAGE_ERROR:
      return `❌ ${error.message}`;
    default:
      return `❌ ${error.message || 'Erro interno ao manipular packs.'}`;
  }
};

const checkRateLimit = (ownerJid) => {
  const now = Date.now();
  const entry = rateMap.get(ownerJid);

  if (!entry || entry.resetAt <= now) {
    rateMap.set(ownerJid, {
      count: 1,
      resetAt: now + RATE_WINDOW_MS,
    });
    return { limited: false, remainingMs: 0 };
  }

  if (entry.count >= RATE_MAX_ACTIONS) {
    return {
      limited: true,
      remainingMs: entry.resetAt - now,
    };
  }

  entry.count += 1;
  rateMap.set(ownerJid, entry);
  return { limited: false, remainingMs: 0 };
};

const parseIdentifierAndValue = (input) => {
  const { token: identifier, rest } = readToken(input);
  return {
    identifier,
    value: unquote(rest),
  };
};

const parseReorderInput = async ({ ownerJid, identifier, rawOrder }) => {
  const tokens = String(rawOrder || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!tokens.length) {
    return [];
  }

  const onlyNumbers = tokens.every((token) => /^\d+$/.test(token));
  if (!onlyNumbers) {
    return tokens;
  }

  const pack = await stickerPackService.getPackInfo({ ownerJid, identifier });
  const ids = [];

  for (const token of tokens) {
    const index = Number(token);
    const item = pack.items[index - 1];
    if (item?.sticker_id) ids.push(item.sticker_id);
  }

  return ids;
};

const resolveStickerFromCommandContext = async ({ messageInfo, ownerJid, includeQuoted = true }) => {
  return resolveStickerAssetForCommand({
    messageInfo,
    ownerJid,
    includeQuoted,
    fallbackToLast: true,
  });
};

export async function handlePackCommand({
  sock,
  remoteJid,
  messageInfo,
  expirationMessage,
  senderJid,
  senderName,
  text,
  commandPrefix,
}) {
  const ownerJid = senderJid;
  const rate = checkRateLimit(ownerJid);

  if (rate.limited) {
    const waitSeconds = Math.ceil(rate.remainingMs / 1000);
    await sendReply({
      sock,
      remoteJid,
      messageInfo,
      expirationMessage,
      text: `⏳ Muitas ações de pack em sequência. Aguarde ${waitSeconds}s e tente novamente.`,
    });
    return;
  }

  const { command, rest } = extractCommandParts(text);
  const subcommand = command || 'help';

  try {
    switch (subcommand) {
      case 'create': {
        const segments = splitPipeSegments(rest);
        const base = segments.shift() || '';
        const options = parsePipeOptions(segments);

        const name = unquote(base);
        const publisher = options.publisher || options.pub || options.autor || senderName || 'OmniZap';
        const description = options.desc || options.description || '';
        const visibility = options.visibility || options.vis || 'private';

        const created = await stickerPackService.createPack({
          ownerJid,
          name,
          publisher,
          description,
          visibility,
        });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Pack criado: *${created.name}*\nid: ${created.pack_key}`,
        });
        return;
      }

      case 'list': {
        const packs = await stickerPackService.listPacks({ ownerJid, limit: 100 });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: formatPackList(packs),
        });
        return;
      }

      case 'info': {
        const { token: identifier } = readToken(rest);
        const pack = await stickerPackService.getPackInfo({ ownerJid, identifier });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: formatPackInfo(pack),
        });
        return;
      }

      case 'rename': {
        const { identifier, value } = parseIdentifierAndValue(rest);
        const updated = await stickerPackService.renamePack({ ownerJid, identifier, name: value });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Pack renomeado para *${updated.name}*.`,
        });
        return;
      }

      case 'setpub': {
        const { identifier, value } = parseIdentifierAndValue(rest);
        const updated = await stickerPackService.setPackPublisher({ ownerJid, identifier, publisher: value });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Publisher atualizado: *${updated.publisher}*.`,
        });
        return;
      }

      case 'setdesc': {
        const { identifier, value } = parseIdentifierAndValue(rest);
        const description = value === '-' || value.toLowerCase() === 'clear' ? '' : value;
        const updated = await stickerPackService.setPackDescription({ ownerJid, identifier, description });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Descrição atualizada em *${updated.name}*.`,
        });
        return;
      }

      case 'setcover': {
        const { token: identifier } = readToken(rest);
        const asset = await resolveStickerFromCommandContext({ messageInfo, ownerJid });

        if (!asset) {
          throw new StickerPackError(
            STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND,
            'Não encontrei figurinha para definir capa.',
          );
        }

        const updated = await stickerPackService.setPackCover({
          ownerJid,
          identifier,
          stickerId: asset.id,
        });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Capa atualizada em *${updated.name}*.`,
        });
        return;
      }

      case 'add': {
        const segments = splitPipeSegments(rest);
        const identifier = readToken(segments.shift() || '').token;
        const options = parsePipeOptions(segments);

        const asset = await resolveStickerFromCommandContext({ messageInfo, ownerJid });
        if (!asset) {
          throw new StickerPackError(
            STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND,
            'Não encontrei figurinha para adicionar.',
          );
        }

        const updated = await stickerPackService.addStickerToPack({
          ownerJid,
          identifier,
          asset,
          emojis: options.emojis,
          accessibilityLabel: options.label || options.accessibility || null,
        });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Figurinha adicionada em *${updated.name}* (${updated.items.length}/${Number(process.env.STICKER_PACK_MAX_ITEMS) || 30}).`,
        });
        return;
      }

      case 'remove': {
        const { token: identifier, rest: selectorRest } = readToken(rest);
        const { token: selector } = readToken(selectorRest);

        const result = await stickerPackService.removeStickerFromPack({
          ownerJid,
          identifier,
          selector,
        });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Figurinha removida de *${result.pack.name}*.`,
        });
        return;
      }

      case 'reorder': {
        const { token: identifier, rest: rawOrder } = readToken(rest);
        const orderStickerIds = await parseReorderInput({
          ownerJid,
          identifier,
          rawOrder,
        });

        const updated = await stickerPackService.reorderPackItems({
          ownerJid,
          identifier,
          orderStickerIds,
        });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Ordem atualizada em *${updated.name}*.`,
        });
        return;
      }

      case 'clone': {
        const { token: identifier, rest: cloneNameRaw } = readToken(rest);
        const cloneName = unquote(cloneNameRaw);

        const cloned = await stickerPackService.clonePack({
          ownerJid,
          identifier,
          newName: cloneName,
        });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Clone criado: *${cloned.name}*\nid: ${cloned.pack_key}`,
        });
        return;
      }

      case 'delete': {
        const { token: identifier } = readToken(rest);
        const deleted = await stickerPackService.deletePack({ ownerJid, identifier });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `🗑️ Pack *${deleted.name}* removido.`,
        });
        return;
      }

      case 'publish': {
        const { token: identifier, rest: visibilityRaw } = readToken(rest);
        const visibility = unquote(visibilityRaw);

        const updated = await stickerPackService.setPackVisibility({
          ownerJid,
          identifier,
          visibility,
        });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: `✅ Visibilidade de *${updated.name}* -> ${updated.visibility}.`,
        });
        return;
      }

      case 'send': {
        const { token: identifier } = readToken(rest);
        const packDetails = await stickerPackService.getPackInfo({ ownerJid, identifier });
        const packBuild = await buildStickerPackMessage(packDetails);
        const sendResult = await sendStickerPackWithFallback({
          sock,
          jid: remoteJid,
          messageInfo,
          expirationMessage,
          packBuild,
        });

        if (sendResult.mode === 'native') {
          await sendReply({
            sock,
            remoteJid,
            messageInfo,
            expirationMessage,
            text: `✅ Pack enviado em modo nativo (${sendResult.sentCount} figurinhas).`,
          });
        } else {
          await sendReply({
            sock,
            remoteJid,
            messageInfo,
            expirationMessage,
            text: `ℹ️ O cliente não aceitou stickerPack nativo. Enviei preview/fallback (${sendResult.sentCount}/${sendResult.total}).`,
          });
        }
        return;
      }

      default: {
        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: buildPackHelp(commandPrefix),
        });
      }
    }
  } catch (error) {
    logger.error('Erro ao processar comando de sticker pack.', {
      action: 'pack_command_error',
      subcommand,
      owner_jid: ownerJid,
      error: error.message,
      code: error.code,
    });

    await sendReply({
      sock,
      remoteJid,
      messageInfo,
      expirationMessage,
      text: formatErrorMessage(error),
    });
  }
}

export async function maybeCaptureIncomingSticker({ messageInfo, senderJid, isMessageFromBot }) {
  if (isMessageFromBot) return null;

  try {
    return await captureIncomingStickerAsset({
      messageInfo,
      ownerJid: senderJid,
    });
  } catch (error) {
    logger.warn('Falha ao capturar figurinha recebida para storage.', {
      action: 'pack_capture_warning',
      owner_jid: senderJid,
      error: error.message,
    });
    return null;
  }
}
