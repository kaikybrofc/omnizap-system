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
const MAX_PACK_ITEMS = Math.max(1, Number(process.env.STICKER_PACK_MAX_ITEMS) || 30);

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

const PACK_VISUAL_DIVIDER = '━━━━━━━━━━━━━━━━━━━';
const PACK_VISUAL_HEADER = '📦 *GERENCIADOR DE PACKS DE FIGURINHAS*';

const normalizeMessageLines = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeMessageLines(item));
  }

  const line = String(value).trim();
  return line ? [line] : [];
};

const formatVisibilityLabel = (visibility) => {
  const normalized = String(visibility || '').toLowerCase();
  if (normalized === 'public') return '🌍 Público';
  if (normalized === 'unlisted') return '🔗 Não listado';
  return '🔒 Privado';
};

const buildPackVisualMessage = ({ intro = [], sections = [], footer = [] }) => {
  const lines = [PACK_VISUAL_HEADER];
  const introLines = normalizeMessageLines(intro);
  if (introLines.length) {
    lines.push('', ...introLines);
  }

  for (const section of sections) {
    if (!section) continue;
    const title = section.title ? String(section.title).trim() : '';
    const sectionLines = normalizeMessageLines(section.lines);
    if (!title && !sectionLines.length) continue;

    lines.push('', PACK_VISUAL_DIVIDER);
    if (title) lines.push(title);
    if (sectionLines.length) {
      lines.push('', ...sectionLines);
    }
  }

  const footerLines = normalizeMessageLines(footer);
  if (footerLines.length) {
    lines.push('', PACK_VISUAL_DIVIDER, ...footerLines);
  }

  return lines.join('\n');
};

const buildActionMessage = ({ title, explanation = [], details = [], nextSteps = [], footer = [] }) =>
  buildPackVisualMessage({
    intro: [title, ...normalizeMessageLines(explanation)],
    sections: [
      normalizeMessageLines(details).length ? { title: '📌 *DETALHES*', lines: details } : null,
      normalizeMessageLines(nextSteps).length ? { title: '➡️ *PRÓXIMOS PASSOS*', lines: nextSteps } : null,
    ],
    footer,
  });

const formatPackList = (packs, prefix) => {
  if (!packs.length) {
    return buildPackVisualMessage({
      intro: [
        '📭 *Você ainda não tem packs extras criados.*',
        'Toda figurinha que você gera continua sendo salva automaticamente no seu *Pack Principal*.',
      ],
      sections: [
        {
          title: '🆕 *COMO COMEÇAR AGORA*',
          lines: [
            `1) Crie um pack com \`${prefix}pack create "Nome do Pack"\`.`,
            `2) Responda uma figurinha e use \`${prefix}pack add <pack>\` para adicionar.`,
            `3) Confira o resultado com \`${prefix}pack info <pack>\`.`,
          ],
        },
      ],
      footer: ['✨ Organize seus packs por tema e deixe o envio de figurinhas muito mais rápido.'],
    });
  }

  const lines = packs.map((pack, index) => {
    const count = Number(pack.sticker_count || 0);
    return [
      `${index + 1}. *${pack.name}*`,
      `   🆔 ID: \`${pack.pack_key}\``,
      `   🧩 Figurinhas: ${count}/${MAX_PACK_ITEMS}`,
      `   👁️ Visibilidade: ${formatVisibilityLabel(pack.visibility)}`,
    ].join('\n');
  });

  return buildPackVisualMessage({
    intro: [
      `📋 *Você tem ${packs.length} pack(s) disponível(is).*`,
      'Use o nome ou o ID do pack para abrir detalhes, editar ou enviar direto no chat.',
    ],
    sections: [
      {
        title: '📦 *SEUS PACKS*',
        lines,
      },
      {
        title: '🛠 *ATALHOS ÚTEIS*',
        lines: [
          `ℹ️ Ver informações: \`${prefix}pack info <pack>\``,
          `📤 Enviar no chat: \`${prefix}pack send <pack>\``,
          `🆕 Criar outro pack: \`${prefix}pack create "Nome do Pack"\``,
        ],
      },
    ],
    footer: ['✨ Dica: mantenha os packs por assunto para encontrar cada figurinha em segundos.'],
  });
};

const formatPackInfo = (pack, prefix) => {
  const coverIndex = pack.items.findIndex((item) => item.sticker_id === pack.cover_sticker_id);
  const coverLabel = coverIndex >= 0 ? `figurinha #${coverIndex + 1}` : 'não definida';
  const itemLines = pack.items.slice(0, 12).map((item, index) => {
    const emojis = Array.isArray(item.emojis) && item.emojis.length ? ` ${item.emojis.join(' ')}` : '';
    const coverTag = item.sticker_id === pack.cover_sticker_id ? ' 🖼️ *Capa atual*' : '';
    return `${index + 1}. \`${item.sticker_id.slice(0, 10)}\`${emojis}${coverTag}`;
  });

  if (pack.items.length > 12) {
    itemLines.push(`... e mais ${pack.items.length - 12} figurinha(s).`);
  }

  return buildPackVisualMessage({
    intro: [
      `ℹ️ *Detalhes completos do pack "${pack.name}".*`,
      'Aqui você confere identificação, visibilidade e prévia das figurinhas cadastradas.',
    ],
    sections: [
      {
        title: '📌 *INFORMAÇÕES DO PACK*',
        lines: [
          `📛 Nome: *${pack.name}*`,
          `🆔 ID: \`${pack.pack_key}\``,
          `👤 Publisher: *${pack.publisher}*`,
          `👁️ Visibilidade: ${formatVisibilityLabel(pack.visibility)}`,
          `🧩 Figurinhas: *${pack.items.length}/${MAX_PACK_ITEMS}*`,
          `🖼️ Capa: *${coverLabel}*`,
          `📝 Descrição: ${pack.description ? `"${pack.description}"` : 'não definida'}`,
        ],
      },
      {
        title: '🖼 *PRÉVIA DAS FIGURINHAS*',
        lines: itemLines.length ? itemLines : ['Nenhuma figurinha cadastrada ainda nesse pack.'],
      },
      {
        title: '⚙️ *GERENCIAR ESTE PACK*',
        lines: [
          `➕ Adicionar figurinha: \`${prefix}pack add ${pack.pack_key}\``,
          `🖼 Definir capa: \`${prefix}pack setcover ${pack.pack_key}\``,
          `🔀 Reordenar: \`${prefix}pack reorder ${pack.pack_key} 1 2 3 ...\``,
          `📤 Enviar no chat: \`${prefix}pack send ${pack.pack_key}\``,
        ],
      },
    ],
    footer: ['✨ Se quiser, eu também posso te guiar para renomear, clonar ou publicar este pack.'],
  });
};

const buildPackHelp = (prefix) =>
  [
    '📦 *GERENCIADOR DE PACKS DE FIGURINHAS*',
    '',
    'Toda figurinha que você criar é salva automaticamente no seu *Pack Principal*.',
    'Você pode criar, organizar e compartilhar seus próprios packs de forma simples e rápida.',
    '',
    PACK_VISUAL_DIVIDER,
    '🛠 *COMANDOS PRINCIPAIS*',
    '',
    '🆕 *Criar um pack*',
    `\`${prefix}pack create "Nome do Pack" | publisher="Seu Nome" | desc="Descrição"\``,
    '',
    '📋 *Listar seus packs*',
    `\`${prefix}pack list\``,
    '',
    'ℹ️ *Ver informações de um pack*',
    `\`${prefix}pack info <pack>\``,
    '',
    '➕ *Adicionar figurinha a um pack*',
    `\`${prefix}pack add <pack>\``,
    '*(responda uma figurinha ou use a última enviada)*',
    '',
    '🖼 *Definir capa do pack*',
    `\`${prefix}pack setcover <pack>\``,
    '',
    '📤 *Enviar um pack no chat*',
    `\`${prefix}pack send <pack>\``,
    '',
    PACK_VISUAL_DIVIDER,
    '⚙️ *FUNÇÕES EXTRAS*',
    '',
    'Você também pode usar os seguintes comandos para gerenciar seus packs:',
    '',
    '`rename` • `setpub` • `setdesc` • `remove` • `reorder` • `clone` • `publish` • `delete`',
    '',
    PACK_VISUAL_DIVIDER,
    '✨ *Organize seus packs e compartilhe suas figurinhas do seu jeito!*',
  ].join('\n');

const buildErrorMessage = ({ title, explanation = [], steps = [], commandPrefix }) =>
  buildPackVisualMessage({
    intro: [title, ...normalizeMessageLines(explanation)],
    sections: [
      normalizeMessageLines(steps).length
        ? {
            title: '🧭 *COMO RESOLVER*',
            lines: steps,
          }
        : null,
    ],
    footer: [`💡 Se quiser revisar todos os exemplos, use \`${commandPrefix}pack\`.`],
  });

const formatErrorMessage = (error, commandPrefix) => {
  if (!(error instanceof StickerPackError)) {
    return buildErrorMessage({
      title: '❌ *Falha ao processar o comando de pack.*',
      explanation: ['Tive um erro inesperado ao montar sua resposta agora.'],
      steps: ['Aguarde alguns segundos e tente novamente.'],
      commandPrefix,
    });
  }

  switch (error.code) {
    case STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND:
      return buildErrorMessage({
        title: '❌ *Pack não encontrado.*',
        explanation: ['Não consegui localizar esse pack pelo nome ou ID informado.'],
        steps: [
          `Confira os packs disponíveis com \`${commandPrefix}pack list\`.`,
          'Copie exatamente o ID exibido na lista.',
          `Depois tente de novo com \`${commandPrefix}pack info <pack>\`.`,
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.DUPLICATE_STICKER:
      return buildErrorMessage({
        title: '⚠️ *Essa figurinha já está nesse pack.*',
        explanation: ['Para evitar duplicidade, não repito o mesmo sticker no mesmo pack.'],
        steps: [
          `Revise os itens com \`${commandPrefix}pack info <pack>\`.`,
          'Se quiser trocar a ordem, use o comando `reorder`.',
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED:
      return buildErrorMessage({
        title: '⚠️ *Seu pack atingiu o limite de figurinhas.*',
        explanation: [error.message || 'Não é possível adicionar novas figurinhas nesse pack agora.'],
        steps: [
          `Crie um novo pack com \`${commandPrefix}pack create "Novo Pack"\`.`,
          'Depois continue adicionando as próximas figurinhas no novo pack.',
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND:
      return buildErrorMessage({
        title: '❌ *Não encontrei uma figurinha válida para esse comando.*',
        explanation: ['Você precisa responder uma figurinha existente ou ter uma figurinha recente salva.'],
        steps: [
          'Responda diretamente a figurinha que deseja usar.',
          'Ou envie uma nova figurinha e execute o comando novamente.',
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.INVALID_INPUT:
      return buildErrorMessage({
        title: '⚠️ *Algum dado do comando está inválido.*',
        explanation: [error.message || 'Revise o formato do comando antes de tentar novamente.'],
        steps: [`Abra o guia completo com \`${commandPrefix}pack\`.`],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.STORAGE_ERROR:
      return buildErrorMessage({
        title: '❌ *Não consegui acessar os arquivos desse pack.*',
        explanation: [error.message || 'Os dados das figurinhas não ficaram disponíveis agora.'],
        steps: ['Tente novamente em instantes. Se persistir, me avise para investigar o storage.'],
        commandPrefix,
      });
    default:
      return buildErrorMessage({
        title: '❌ *Erro ao manipular packs.*',
        explanation: [error.message || 'Aconteceu um erro interno durante a operação.'],
        steps: ['Tente novamente e, se continuar, compartilhe o comando usado para análise.'],
        commandPrefix,
      });
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
      text: buildActionMessage({
        title: '⏳ *Limite temporário de ações atingido.*',
        explanation: [
          'Para manter o gerenciador de packs estável, apliquei uma pausa curta antes da próxima ação.',
        ],
        details: [`⏱️ Tempo restante para tentar de novo: *${waitSeconds}s*.`],
        nextSteps: ['Aguarde esse tempo e execute novamente o comando de pack que você quiser.'],
      }),
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
          text: buildActionMessage({
            title: '✅ *Pack criado com sucesso!*',
            explanation: [
              'Seu novo pack já está ativo e pronto para receber figurinhas.',
              'Você pode gerenciar tudo pelo nome ou pelo ID exibido abaixo.',
            ],
            details: [
              `📛 Nome do pack: *${created.name}*`,
              `🆔 ID do pack: \`${created.pack_key}\``,
              `👤 Publisher: *${created.publisher}*`,
              `👁️ Visibilidade inicial: ${formatVisibilityLabel(created.visibility)}`,
            ],
            nextSteps: [
              `Responda uma figurinha e execute \`${commandPrefix}pack add ${created.pack_key}\`.`,
              `Veja o resumo completo com \`${commandPrefix}pack info ${created.pack_key}\`.`,
            ],
            footer: ['✨ Agora ficou fácil montar coleções temáticas e compartilhar quando quiser.'],
          }),
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
          text: formatPackList(packs, commandPrefix),
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
          text: formatPackInfo(pack, commandPrefix),
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
          text: buildActionMessage({
            title: '✏️ *Nome do pack atualizado!*',
            explanation: ['A alteração foi salva com sucesso e já vale para os próximos envios.'],
            details: [
              `📛 Novo nome: *${updated.name}*`,
              `🆔 ID do pack: \`${updated.pack_key}\``,
            ],
            nextSteps: [`Confira todos os detalhes em \`${commandPrefix}pack info ${updated.pack_key}\`.`],
          }),
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
          text: buildActionMessage({
            title: '👤 *Publisher atualizado com sucesso!*',
            explanation: ['O nome do autor/editor desse pack foi alterado e já aparece nas próximas informações.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              `👤 Novo publisher: *${updated.publisher}*`,
              `🆔 ID: \`${updated.pack_key}\``,
            ],
            nextSteps: [
              `Se quiser, ajuste a descrição com \`${commandPrefix}pack setdesc ${updated.pack_key} "Nova descrição"\`.`,
            ],
          }),
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
          text: buildActionMessage({
            title: '📝 *Descrição do pack atualizada!*',
            explanation: ['A descrição foi salva com sucesso e ajuda a identificar o tema do pack.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              description
                ? `📝 Nova descrição: "${updated.description}"`
                : '🧹 Descrição removida com sucesso.',
            ],
            nextSteps: [`Confira como ficou com \`${commandPrefix}pack info ${updated.pack_key}\`.`],
          }),
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
          text: buildActionMessage({
            title: '🖼 *Capa do pack definida com sucesso!*',
            explanation: ['A figurinha selecionada agora representa esse pack como capa principal.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              `🆔 ID: \`${updated.pack_key}\``,
            ],
            nextSteps: [`Envie o pack com a nova capa usando \`${commandPrefix}pack send ${updated.pack_key}\`.`],
          }),
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
          text: buildActionMessage({
            title: '➕ *Figurinha adicionada com sucesso!*',
            explanation: ['A figurinha escolhida já entrou no pack e está pronta para uso.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              `🧩 Total atual: *${updated.items.length}/${MAX_PACK_ITEMS}*`,
              `🆔 ID: \`${updated.pack_key}\``,
            ],
            nextSteps: [
              `Se quiser, transforme essa figurinha em capa com \`${commandPrefix}pack setcover ${updated.pack_key}\` respondendo ela.`,
              `Veja a ordem completa em \`${commandPrefix}pack info ${updated.pack_key}\`.`,
            ],
          }),
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
          text: buildActionMessage({
            title: '🗑️ *Figurinha removida do pack!*',
            explanation: ['A exclusão foi concluída e a ordem interna do pack foi ajustada automaticamente.'],
            details: [
              `📦 Pack: *${result.pack.name}*`,
              `🔢 Item removido: figurinha #${result.removed.position}`,
              `🧩 Total atual: *${result.pack.items.length}/${MAX_PACK_ITEMS}*`,
            ],
            nextSteps: [`Revise o resultado com \`${commandPrefix}pack info ${result.pack.pack_key}\`.`],
          }),
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
          text: buildActionMessage({
            title: '🔀 *Ordem das figurinhas atualizada!*',
            explanation: ['A nova sequência foi aplicada com sucesso no pack selecionado.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              `🆔 ID: \`${updated.pack_key}\``,
            ],
            nextSteps: [`Confira a sequência final em \`${commandPrefix}pack info ${updated.pack_key}\`.`],
          }),
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
          text: buildActionMessage({
            title: '🧬 *Clone de pack criado com sucesso!*',
            explanation: [
              'Copiei as configurações e figurinhas do pack original para um novo pack independente.',
            ],
            details: [
              `📦 Novo pack: *${cloned.name}*`,
              `🆔 ID do clone: \`${cloned.pack_key}\``,
            ],
            nextSteps: [
              `Renomeie com \`${commandPrefix}pack rename ${cloned.pack_key} "Novo nome"\`.`,
              `Envie no chat com \`${commandPrefix}pack send ${cloned.pack_key}\`.`,
            ],
          }),
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
          text: buildActionMessage({
            title: '🗑️ *Pack removido com sucesso!*',
            explanation: ['O pack foi excluído da sua lista e não aparecerá mais nos comandos de gerenciamento.'],
            details: [`📦 Pack removido: *${deleted.name}*`],
            nextSteps: [`Se quiser criar outro, use \`${commandPrefix}pack create "Nome do Pack"\`.`],
          }),
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
          text: buildActionMessage({
            title: '🌐 *Visibilidade do pack atualizada!*',
            explanation: ['A configuração de privacidade foi aplicada e já está ativa para este pack.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              `👁️ Nova visibilidade: ${formatVisibilityLabel(updated.visibility)}`,
              `🆔 ID: \`${updated.pack_key}\``,
            ],
            nextSteps: [`Para compartilhar agora, use \`${commandPrefix}pack send ${updated.pack_key}\`.`],
          }),
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
            text: buildActionMessage({
              title: '📤 *Pack enviado com sucesso!*',
              explanation: ['O envio foi feito no formato nativo de pack, com melhor compatibilidade de coleção.'],
              details: [
                `📦 Pack enviado: *${packDetails.name}*`,
                `🆔 ID: \`${packDetails.pack_key}\``,
                `🧩 Total enviado: *${sendResult.sentCount} figurinha(s)*`,
              ],
              nextSteps: [
                `Para revisar esse pack, use \`${commandPrefix}pack info ${packDetails.pack_key}\`.`,
                `Para editar, continue com \`${commandPrefix}pack add ${packDetails.pack_key}\` ou \`${commandPrefix}pack remove ${packDetails.pack_key} <item>\`.`,
              ],
            }),
          });
        } else {
          await sendReply({
            sock,
            remoteJid,
            messageInfo,
            expirationMessage,
            text: buildActionMessage({
              title: 'ℹ️ *Envio concluído em modo de compatibilidade.*',
              explanation: [
                `Seu cliente não aceitou o formato nativo para *${packDetails.name}*, então enviei por fallback.`,
                'Nesse modo, eu envio um preview e depois as figurinhas individualmente.',
              ],
              details: [
                `📦 Pack: *${packDetails.name}*`,
                `🧩 Progresso de envio: *${sendResult.sentCount}/${sendResult.total}*`,
                sendResult.nativeError ? `🛠 Motivo técnico: ${sendResult.nativeError}` : null,
              ],
              nextSteps: [
                `Você ainda pode gerenciar normalmente com \`${commandPrefix}pack info ${packDetails.pack_key}\`.`,
                `Se quiser tentar de novo, rode \`${commandPrefix}pack send ${packDetails.pack_key}\` mais tarde.`,
              ],
            }),
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
      text: formatErrorMessage(error, commandPrefix),
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
