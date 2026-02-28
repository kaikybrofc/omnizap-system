import logger from '../../utils/logger/loggerModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { isUserJid } from '../../config/baileysConfig.js';
import stickerPackService from './stickerPackServiceRuntime.js';
import { STICKER_PACK_ERROR_CODES, StickerPackError } from './stickerPackErrors.js';
import {
  captureIncomingStickerAsset,
  resolveStickerAssetForCommand,
} from './stickerStorageService.js';
import { buildStickerPackMessage, sendStickerPackWithFallback } from './stickerPackMessageService.js';
import { sanitizeText } from './stickerPackUtils.js';

/**
 * Handlers de comando textual para gerenciamento de packs de figurinha.
 */
const RATE_WINDOW_MS = Math.max(10_000, Number(process.env.STICKER_PACK_RATE_WINDOW_MS) || 60_000);
const RATE_MAX_ACTIONS = Math.max(1, Number(process.env.STICKER_PACK_RATE_MAX_ACTIONS) || 20);
const MAX_PACK_ITEMS = Math.max(1, Number(process.env.STICKER_PACK_MAX_ITEMS) || 30);
const MAX_PACK_NAME_LENGTH = 120;

const rateMap = new Map();

/**
 * Separa texto em subcomando e argumentos restantes.
 *
 * @param {string} text Texto bruto após `pack`.
 * @returns {{ command: string, rest: string }} Partes do comando.
 */
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

/**
 * Remove aspas simples/duplas de borda e trim.
 *
 * @param {unknown} value Valor textual.
 * @returns {string} Texto sem aspas externas.
 */
const unquote = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }

  return raw;
};

/**
 * Lê o primeiro token (com suporte a aspas) e retorna o restante.
 *
 * @param {string} input Texto de entrada.
 * @returns {{ token: string|null, rest: string }} Token e restante.
 */
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

/**
 * Divide argumentos por `|`, removendo segmentos vazios.
 *
 * @param {unknown} value Texto com opções pipe.
 * @returns {string[]} Segmentos limpos.
 */
const splitPipeSegments = (value) =>
  String(value || '')
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);

/**
 * Converte segmentos `chave=valor` em objeto de opções.
 *
 * @param {string[]} segments Segmentos já divididos por pipe.
 * @returns {Record<string, string>} Mapa de opções.
 */
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

/**
 * Envia resposta textual no chat preservando contexto/ephemeral.
 *
 * @param {{ sock: object, remoteJid: string, messageInfo: object, expirationMessage: number|undefined, text: string }} params Contexto de envio.
 * @returns {Promise<object>} Resultado de envio.
 */
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
const PACK_VISUAL_HEADER = '📦 *PACKS DE FIGURINHAS — CENTRAL DE GERENCIAMENTO*';

/**
 * Normaliza blocos de texto para linhas não vazias.
 *
 * @param {unknown} value Texto, lista de textos ou aninhamento.
 * @returns {string[]} Linhas prontas para renderização.
 */
const normalizeMessageLines = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeMessageLines(item));
  }

  const line = String(value).trim();
  return line ? [line] : [];
};

/**
 * Formata rótulo visual de visibilidade do pack.
 *
 * @param {string} visibility Visibilidade interna.
 * @returns {string} Rótulo amigável com ícone.
 */
const formatVisibilityLabel = (visibility) => {
  const normalized = String(visibility || '').toLowerCase();
  if (normalized === 'public') return '🌍 Público';
  if (normalized === 'unlisted') return '🔗 Não listado';
  return '🔒 Privado';
};

/**
 * Detecta packs automáticos para ocultar em listagens do usuário.
 *
 * @param {object|null|undefined} pack Pack retornado pelo serviço.
 * @returns {boolean} Verdadeiro quando o pack é automático.
 */
const isAutomaticPack = (pack) => {
  if (!pack || typeof pack !== 'object') return false;
  if (pack.is_auto_pack === true || Number(pack.is_auto_pack || 0) === 1) return true;

  const name = String(pack.name || '').trim();
  if (/^\[auto\]/i.test(name)) return true;

  const description = String(pack.description || '').toLowerCase();
  return description.includes('[auto-theme:') || description.includes('[auto-tag:');
};

/**
 * Monta mensagem visual padronizada para comandos de pack.
 *
 * @param {{ intro?: unknown[], sections?: Array<{title?: string, lines?: unknown[]}>, footer?: unknown[] }} params Blocos da mensagem.
 * @returns {string} Texto final formatado.
 */
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

/**
 * Monta template visual para ações de sucesso/instrução.
 *
 * @param {{ title: string, explanation?: unknown[], details?: unknown[], nextSteps?: unknown[], footer?: unknown[] }} params Dados da mensagem.
 * @returns {string} Texto final.
 */
const buildActionMessage = ({ title, explanation = [], details = [], nextSteps = [], footer = [] }) =>
  buildPackVisualMessage({
    intro: [title, ...normalizeMessageLines(explanation)],
    sections: [
      normalizeMessageLines(details).length ? { title: '📌 *DETALHES*', lines: details } : null,
      normalizeMessageLines(nextSteps).length ? { title: '➡️ *PRÓXIMAS AÇÕES*', lines: nextSteps } : null,
    ],
    footer,
  });

/**
 * Renderiza listagem de packs em formato amigável para chat.
 *
 * @param {object[]} packs Lista de packs do usuário.
 * @param {string} prefix Prefixo de comando.
 * @returns {string} Mensagem formatada.
 */
const formatPackList = (packs, prefix) => {
  if (!packs.length) {
    return buildPackVisualMessage({
      intro: [
        '📭 *Nenhum pack extra encontrado.*',
        'As figurinhas que você cria continuam sendo salvas automaticamente no seu *Pack Principal*.',
      ],
      sections: [
        {
          title: '🆕 *COMECE EM 3 PASSOS*',
          lines: [
            `1) Crie um pack: \`${prefix}pack create meupack\``,
            `2) Responda uma figurinha e adicione: \`${prefix}pack add <pack>\``,
            `3) Veja o resumo: \`${prefix}pack info <pack>\``,
          ],
        },
      ],
      footer: ['💡 Dica: crie packs por tema (memes, animes, reactions) para achar tudo mais rápido.'],
    });
  }

  const lines = packs.map((pack, index) => {
    const count = Number(pack.sticker_count || 0);
    return [
      `${index + 1}. *${pack.name}*`,
      `   🆔 ID: \`${pack.pack_key}\``,
      `   🧩 Itens: ${count}/${MAX_PACK_ITEMS}`,
      `   👁️ Visibilidade: ${formatVisibilityLabel(pack.visibility)}`,
    ].join('\n');
  });

  return buildPackVisualMessage({
    intro: [
      `📋 *Packs encontrados: ${packs.length}*`,
      'Você pode usar o *nome* ou o *ID* do pack para ver detalhes, editar ou enviar.',
    ],
    sections: [
      { title: '📦 *SEUS PACKS*', lines },
      {
        title: '🛠 *ATALHOS*',
        lines: [
          `ℹ️ Detalhes: \`${prefix}pack info <pack>\``,
          `📤 Enviar: \`${prefix}pack send <pack>\``,
          `🆕 Criar novo: \`${prefix}pack create meupack\``,
        ],
      },
    ],
    footer: ['✅ Tudo pronto — escolha um pack e continue gerenciando.'],
  });
};

/**
 * Renderiza detalhes completos de um pack com preview de itens.
 *
 * @param {{ items: object[], cover_sticker_id?: string, name: string, pack_key: string, publisher: string, visibility: string, description?: string }} pack Pack completo.
 * @param {string} prefix Prefixo de comando.
 * @returns {string} Mensagem formatada.
 */
const formatPackInfo = (pack, prefix) => {
  const coverIndex = pack.items.findIndex((item) => item.sticker_id === pack.cover_sticker_id);
  const coverLabel = coverIndex >= 0 ? `figurinha #${coverIndex + 1}` : 'não definida';
  const itemLines = pack.items.slice(0, 12).map((item, index) => {
    const emojis = Array.isArray(item.emojis) && item.emojis.length ? ` ${item.emojis.join(' ')}` : '';
    const coverTag = item.sticker_id === pack.cover_sticker_id ? ' 🖼️ *Capa*' : '';
    return `${index + 1}. \`${item.sticker_id.slice(0, 10)}\`${emojis}${coverTag}`;
  });

  if (pack.items.length > 12) {
    itemLines.push(`… e mais ${pack.items.length - 12} figurinha(s).`);
  }

  return buildPackVisualMessage({
    intro: [
      `ℹ️ *Informações do pack: "${pack.name}"*`,
      'Aqui você vê identificação, visibilidade e uma prévia dos itens cadastrados.',
    ],
    sections: [
      {
        title: '📌 *DADOS DO PACK*',
        lines: [
          `📛 Nome: *${pack.name}*`,
          `🆔 ID: \`${pack.pack_key}\``,
          `👤 Publisher: *${pack.publisher}*`,
          `👁️ Visibilidade: ${formatVisibilityLabel(pack.visibility)}`,
          `🧩 Itens: *${pack.items.length}/${MAX_PACK_ITEMS}*`,
          `🖼️ Capa: *${coverLabel}*`,
          `📝 Descrição: ${pack.description ? `"${pack.description}"` : 'não definida'}`,
        ],
      },
      {
        title: '🖼️ *PRÉVIA (ATÉ 12 ITENS)*',
        lines: itemLines.length ? itemLines : ['Nenhuma figurinha cadastrada neste pack ainda.'],
      },
      {
        title: '⚙️ *AÇÕES DISPONÍVEIS*',
        lines: [
          `➕ Adicionar: \`${prefix}pack add ${pack.pack_key}\``,
          `🖼 Definir capa: \`${prefix}pack setcover ${pack.pack_key}\``,
          `🔀 Reordenar: \`${prefix}pack reorder ${pack.pack_key} 1 2 3 ...\``,
          `📤 Enviar: \`${prefix}pack send ${pack.pack_key}\``,
        ],
      },
    ],
    footer: ['💡 Se precisar, use o guia completo com `pack` para ver exemplos e comandos extras.'],
  });
};

/**
 * Retorna texto de ajuda principal dos comandos de pack.
 *
 * @param {string} prefix Prefixo de comando.
 * @returns {string} Guia textual.
 */
const buildPackHelp = (prefix) =>
  [
    '📦 *PACKS DE FIGURINHAS — GUIA RÁPIDO*',
    '',
    'Toda figurinha que você criar é salva automaticamente no seu *Pack Principal*.',
    'Além disso, você pode criar packs extras para organizar por tema e enviar mais rápido.',
    '',
    PACK_VISUAL_DIVIDER,
    '🧭 *COMANDOS PRINCIPAIS*',
    '',
    '🆕 Criar um pack',
    `\`${prefix}pack create "Meus memes 😂" | publisher="Seu Nome" | desc="Descrição"\``,
    '_Nome livre: espaços e emojis são permitidos._',
    '',
    '📋 Listar packs',
    `\`${prefix}pack list\``,
    '',
    'ℹ️ Ver detalhes do pack',
    `\`${prefix}pack info <pack>\``,
    '',
    '➕ Adicionar figurinha',
    `\`${prefix}pack add <pack>\``,
    '_Dica: responda uma figurinha (ou use a última enviada)._',
    '',
    '🖼 Definir capa',
    `\`${prefix}pack setcover <pack>\``,
    '',
    '📤 Enviar pack no chat',
    `\`${prefix}pack send "<nome do pack>"\``,
    `_Ou use o ID: \`${prefix}pack send <pack_id>\`_`,
    '',
    PACK_VISUAL_DIVIDER,
    '🧰 *COMANDOS EXTRAS*',
    '',
    '`rename` • `setpub` • `setdesc` • `remove` • `reorder` • `clone` • `publish` • `delete`',
    '',
    PACK_VISUAL_DIVIDER,
    '✅ *Pronto!* Se quiser, diga o que você quer fazer (criar, organizar, enviar) que eu te guio.',
  ].join('\n');

/**
 * Template visual de erro orientado a resolução.
 *
 * @param {{ title: string, explanation?: unknown[], steps?: unknown[], commandPrefix: string }} params Conteúdo do erro.
 * @returns {string} Texto formatado.
 */
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
    footer: [`💡 Guia completo: \`${commandPrefix}pack\``],
  });

/**
 * Converte erro interno em mensagem amigável para usuário.
 *
 * @param {unknown} error Erro recebido durante o comando.
 * @param {string} commandPrefix Prefixo configurado.
 * @returns {string} Mensagem final de erro.
 */
const formatErrorMessage = (error, commandPrefix) => {
  if (!(error instanceof StickerPackError)) {
    return buildErrorMessage({
      title: '❌ *Não consegui concluir sua solicitação.*',
      explanation: ['Ocorreu um erro inesperado ao processar o comando.'],
      steps: ['Aguarde alguns segundos e tente novamente.'],
      commandPrefix,
    });
  }

  switch (error.code) {
    case STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND:
      return buildErrorMessage({
        title: '🔎 *Pack não encontrado.*',
        explanation: ['Não localizei um pack com esse nome ou ID.'],
        steps: [
          `Veja a lista com \`${commandPrefix}pack list\`.`,
          'Copie o ID exatamente como aparece.',
          `Depois tente novamente (ex.: \`${commandPrefix}pack info <pack>\`).`,
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.DUPLICATE_STICKER:
      return buildErrorMessage({
        title: '⚠️ *Essa figurinha já está no pack.*',
        explanation: ['Para manter o pack organizado, não adiciono itens duplicados.'],
        steps: [
          `Veja os itens com \`${commandPrefix}pack info <pack>\`.`,
          'Se quiser reorganizar, use `reorder`.',
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED:
      return buildErrorMessage({
        title: '⚠️ *Limite de figurinhas atingido.*',
        explanation: [error.message || 'Este pack já está no limite e não aceita novos itens no momento.'],
        steps: [
          `Crie outro pack: \`${commandPrefix}pack create novopack\`.`,
          'Depois continue adicionando as próximas figurinhas no novo pack.',
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND:
      return buildErrorMessage({
        title: '🧩 *Não encontrei uma figurinha válida para usar.*',
        explanation: ['Para esse comando, você precisa responder uma figurinha ou ter uma figurinha recente no contexto.'],
        steps: [
          'Responda diretamente a figurinha que você quer usar.',
          'Ou envie uma figurinha e execute o comando novamente.',
        ],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.INVALID_INPUT:
      return buildErrorMessage({
        title: '⚠️ *Formato do comando inválido.*',
        explanation: [error.message || 'Revise o formato do comando e tente novamente.'],
        steps: [`Abra os exemplos: \`${commandPrefix}pack\`.`],
        commandPrefix,
      });
    case STICKER_PACK_ERROR_CODES.STORAGE_ERROR:
      return buildErrorMessage({
        title: '💾 *Falha ao acessar os dados do pack.*',
        explanation: [error.message || 'Os arquivos não ficaram disponíveis agora.'],
        steps: ['Tente novamente em instantes. Se persistir, envie o comando usado para eu analisar.'],
        commandPrefix,
      });
    default:
      return buildErrorMessage({
        title: '❌ *Erro ao gerenciar packs.*',
        explanation: [error.message || 'Ocorreu um erro interno durante a operação.'],
        steps: ['Tente novamente e, se continuar, compartilhe o comando usado para análise.'],
        commandPrefix,
      });
  }
};

/**
 * Aplica rate limit por usuário para comandos de pack.
 *
 * @param {string} ownerJid JID do dono do comando.
 * @returns {{ limited: boolean, remainingMs: number }} Estado do limite.
 */
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

/**
 * Lê identificador inicial e restante textual do comando.
 *
 * @param {string} input Texto de entrada.
 * @returns {{ identifier: string|null, value: string }} Partes parseadas.
 */
const parseIdentifierAndValue = (input) => {
  const { token: identifier, rest } = readToken(input);
  return {
    identifier,
    value: unquote(rest),
  };
};

const readSingleArgument = (input) => {
  const value = unquote(input);
  return value ? value : null;
};

/**
 * Normaliza e valida nome de pack (permite espaços e emojis).
 *
 * @param {string} value Nome informado.
 * @param {{ label?: string }} [options] Label para mensagens de erro.
 * @returns {string} Nome normalizado.
 * @throws {StickerPackError} Quando o nome estiver vazio.
 */
const normalizePackName = (value, { label = 'Nome do pack' } = {}) => {
  const normalized = sanitizeText(unquote(value), MAX_PACK_NAME_LENGTH, { allowEmpty: false });

  if (!normalized) {
    throw new StickerPackError(STICKER_PACK_ERROR_CODES.INVALID_INPUT, `${label} é obrigatório.`);
  }

  return normalized;
};

/**
 * Converte entrada de reordenação em lista de sticker IDs.
 *
 * @param {{ ownerJid: string, identifier: string, rawOrder: string }} params Contexto de reordenação.
 * @returns {Promise<string[]>} IDs na ordem desejada.
 */
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

/**
 * Resolve sticker a partir do contexto atual (quoted/último sticker).
 *
 * @param {{ messageInfo: object, ownerJid: string, includeQuoted?: boolean }} params Contexto da mensagem.
 * @returns {Promise<object|null>} Asset resolvido.
 */
const resolveStickerFromCommandContext = async ({ messageInfo, ownerJid, includeQuoted = true }) => {
  return resolveStickerAssetForCommand({
    messageInfo,
    ownerJid,
    includeQuoted,
    fallbackToLast: true,
  });
};

/**
 * Handler principal do comando `pack` e seus subcomandos.
 *
 * @param {{
 *   sock: object,
 *   remoteJid: string,
 *   messageInfo: object,
 *   expirationMessage: number|undefined,
 *   senderJid: string,
 *   senderName: string,
 *   text: string,
 *   commandPrefix: string,
 * }} params Contexto da requisição.
 * @returns {Promise<void>}
 */
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
        title: '⏳ *Muitas ações em sequência.*',
        explanation: ['Para manter o sistema estável, ativei uma pausa rápida antes do próximo comando.'],
        details: [`⏱️ Você poderá tentar novamente em: *${waitSeconds}s*.`],
        nextSteps: ['Aguarde o tempo acima e repita o comando de pack que deseja executar.'],
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

        const name = normalizePackName(base);
        const publisher = options.publisher || options.pub || options.autor || senderName || 'OmniZap';
        const description = options.desc || options.description || '';
        const visibility = options.visibility || options.vis || 'public';

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
            title: '✅ *Pack criado!*',
            explanation: ['Seu pack já está disponível e pronto para receber figurinhas.'],
            details: [
              `📛 Nome: *${created.name}*`,
              `🆔 ID: \`${created.pack_key}\``,
              `👤 Publisher: *${created.publisher}*`,
              `👁️ Visibilidade: ${formatVisibilityLabel(created.visibility)}`,
            ],
            nextSteps: [
              `Responda uma figurinha e use: \`${commandPrefix}pack add ${created.pack_key}\`.`,
              `Para conferir: \`${commandPrefix}pack info ${created.pack_key}\`.`,
            ],
            footer: ['💡 Dica: use packs por tema para organizar e enviar mais rápido.'],
          }),
        });
        return;
      }

      case 'list': {
        const packs = await stickerPackService.listPacks({ ownerJid, limit: 100 });
        const manualPacks = packs.filter((pack) => !isAutomaticPack(pack));

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: formatPackList(manualPacks, commandPrefix),
        });
        return;
      }

      case 'info': {
        const identifier = readSingleArgument(rest);
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
        const normalizedName = normalizePackName(value, { label: 'Novo nome do pack' });
        const updated = await stickerPackService.renamePack({ ownerJid, identifier, name: normalizedName });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: buildActionMessage({
            title: '✏️ *Nome atualizado!*',
            explanation: ['Alteração salva com sucesso.'],
            details: [`📛 Novo nome: *${updated.name}*`, `🆔 ID: \`${updated.pack_key}\``],
            nextSteps: [`Ver detalhes: \`${commandPrefix}pack info ${updated.pack_key}\`.`],
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
            title: '👤 *Publisher atualizado!*',
            explanation: ['O publisher deste pack foi ajustado e já aparece nas informações.'],
            details: [`📦 Pack: *${updated.name}*`, `👤 Publisher: *${updated.publisher}*`, `🆔 ID: \`${updated.pack_key}\``],
            nextSteps: [
              `Se quiser, ajuste a descrição: \`${commandPrefix}pack setdesc ${updated.pack_key} "Nova descrição"\`.`,
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
            title: '📝 *Descrição atualizada!*',
            explanation: ['A descrição ajuda a identificar o tema do pack.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              description ? `📝 Descrição: "${updated.description}"` : '🧹 Descrição removida.',
            ],
            nextSteps: [`Ver como ficou: \`${commandPrefix}pack info ${updated.pack_key}\`.`],
          }),
        });
        return;
      }

      case 'setcover': {
        const identifier = readSingleArgument(rest);
        const asset = await resolveStickerFromCommandContext({ messageInfo, ownerJid });

        if (!asset) {
          throw new StickerPackError(
            STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND,
            'Não encontrei uma figurinha para definir como capa.',
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
            title: '🖼️ *Capa definida!*',
            explanation: ['A figurinha selecionada agora é a capa deste pack.'],
            details: [`📦 Pack: *${updated.name}*`, `🆔 ID: \`${updated.pack_key}\``],
            nextSteps: [`Para enviar: \`${commandPrefix}pack send ${updated.pack_key}\`.`],
          }),
        });
        return;
      }

      case 'add': {
        const segments = splitPipeSegments(rest);
        const identifier = readSingleArgument(segments.shift() || '');
        const options = parsePipeOptions(segments);

        const asset = await resolveStickerFromCommandContext({ messageInfo, ownerJid });
        if (!asset) {
          throw new StickerPackError(
            STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND,
            'Não encontrei uma figurinha para adicionar.',
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
            title: '➕ *Figurinha adicionada!*',
            explanation: ['Item adicionado com sucesso ao pack selecionado.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              `🧩 Itens: *${updated.items.length}/${MAX_PACK_ITEMS}*`,
              `🆔 ID: \`${updated.pack_key}\``,
            ],
            nextSteps: [
              `Definir como capa: responda a figurinha e use \`${commandPrefix}pack setcover ${updated.pack_key}\`.`,
              `Ver lista completa: \`${commandPrefix}pack info ${updated.pack_key}\`.`,
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
            title: '🗑️ *Figurinha removida!*',
            explanation: ['Remoção concluída e o pack foi reordenado automaticamente.'],
            details: [
              `📦 Pack: *${result.pack.name}*`,
              `🔢 Item removido: figurinha #${result.removed.position}`,
              `🧩 Itens: *${result.pack.items.length}/${MAX_PACK_ITEMS}*`,
            ],
            nextSteps: [`Conferir: \`${commandPrefix}pack info ${result.pack.pack_key}\`.`],
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
            title: '🔀 *Ordem atualizada!*',
            explanation: ['A nova sequência foi aplicada ao pack.'],
            details: [`📦 Pack: *${updated.name}*`, `🆔 ID: \`${updated.pack_key}\``],
            nextSteps: [`Verificar sequência: \`${commandPrefix}pack info ${updated.pack_key}\`.`],
          }),
        });
        return;
      }

      case 'clone': {
        const { token: identifier, rest: cloneNameRaw } = readToken(rest);
        const cloneName = normalizePackName(cloneNameRaw, { label: 'Novo nome do clone' });

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
            title: '🧬 *Clone criado!*',
            explanation: ['O pack foi duplicado com as mesmas figurinhas e configurações.'],
            details: [`📦 Novo pack: *${cloned.name}*`, `🆔 ID: \`${cloned.pack_key}\``],
            nextSteps: [
              `Renomear: \`${commandPrefix}pack rename ${cloned.pack_key} novonome\`.`,
              `Enviar: \`${commandPrefix}pack send ${cloned.pack_key}\`.`,
            ],
          }),
        });
        return;
      }

      case 'delete': {
        const identifier = readSingleArgument(rest);
        const deleted = await stickerPackService.deletePack({ ownerJid, identifier });

        await sendReply({
          sock,
          remoteJid,
          messageInfo,
          expirationMessage,
          text: buildActionMessage({
            title: '🗑️ *Pack removido!*',
            explanation: ['O pack foi excluído e não aparecerá mais na sua lista.'],
            details: [`📦 Pack removido: *${deleted.name}*`],
            nextSteps: [`Criar outro: \`${commandPrefix}pack create meupack\`.`],
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
            title: '🌐 *Visibilidade atualizada!*',
            explanation: ['A configuração de privacidade foi aplicada ao pack.'],
            details: [
              `📦 Pack: *${updated.name}*`,
              `👁️ Visibilidade: ${formatVisibilityLabel(updated.visibility)}`,
              `🆔 ID: \`${updated.pack_key}\``,
            ],
            nextSteps: [`Compartilhar/enviar: \`${commandPrefix}pack send ${updated.pack_key}\`.`],
          }),
        });
        return;
      }

      case 'send': {
        const identifier = readSingleArgument(rest);
        const packDetails = await stickerPackService.getPackInfoForSend({ ownerJid, identifier });
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
              title: '📤 *Pack enviado!*',
              explanation: ['Enviei no formato nativo (melhor experiência e compatibilidade).'],
              details: [
                `📦 Pack: *${packDetails.name}*`,
                `🆔 ID: \`${packDetails.pack_key}\``,
                `🧩 Enviadas: *${sendResult.sentCount} figurinha(s)*`,
              ],
              nextSteps: [
                `Ver detalhes: \`${commandPrefix}pack info ${packDetails.pack_key}\`.`,
                `Editar: \`${commandPrefix}pack add ${packDetails.pack_key}\` ou \`${commandPrefix}pack remove ${packDetails.pack_key} <item>\`.`,
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
              title: 'ℹ️ *Pack enviado em modo compatível.*',
              explanation: [
                `O cliente não aceitou o formato nativo para *${packDetails.name}*.`,
                'Enviei em modo compatível (prévia + figurinhas individuais).',
              ],
              details: [
                `📦 Pack: *${packDetails.name}*`,
                `🧩 Progresso: *${sendResult.sentCount}/${sendResult.total}*`,
                sendResult.nativeError ? `🛠 Detalhe técnico: ${sendResult.nativeError}` : null,
              ],
              nextSteps: [
                `Você pode continuar gerenciando: \`${commandPrefix}pack info ${packDetails.pack_key}\`.`,
                `Para tentar novamente no formato nativo: \`${commandPrefix}pack send ${packDetails.pack_key}\` mais tarde.`,
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

/**
 * Captura stickers recebidos para manter cache/storage atualizado.
 *
 * @param {{ messageInfo: object, senderJid: string, isMessageFromBot: boolean }} params Contexto da mensagem recebida.
 * @returns {Promise<object|null>} Asset capturado ou `null`.
 */
export async function maybeCaptureIncomingSticker({ messageInfo, senderJid, isMessageFromBot }) {
  if (isMessageFromBot) return null;
  if (!isUserJid(senderJid)) return null;

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
