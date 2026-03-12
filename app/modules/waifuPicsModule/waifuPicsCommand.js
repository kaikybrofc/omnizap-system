import axios from 'axios';

import logger from '#logger';
import { isGroupJid } from '../../config/index.js';
import groupConfigStore from '../../store/groupConfigStore.js';
import { sendAndStore } from '../../services/messaging/messagePersistenceService.js';
import { getWaifuPicsCommandEntry, getWaifuPicsTextConfig, getWaifuPicsUsageText as getWaifuPicsRuntimeUsageText, resolveWaifuPicsCommandName } from './waifuPicsConfigRuntime.js';

/**
 * Prefixo padrão de comandos do bot.
 * @type {string}
 */
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

/**
 * URL base da API Waifu.pics.
 * @type {string}
 */
const WAIFU_PICS_BASE = (process.env.WAIFU_PICS_BASE || 'https://api.waifu.pics').replace(/\/$/, '');

/**
 * Timeout das requisições para a Waifu.pics (em milissegundos).
 * @type {number}
 */
const WAIFU_PICS_TIMEOUT_MS = Number.parseInt(process.env.WAIFU_PICS_TIMEOUT_MS || '15000', 10);

/**
 * Define se conteúdo NSFW é permitido globalmente nas configurações do sistema.
 * @type {boolean}
 */
const WAIFU_PICS_ALLOW_NSFW = process.env.WAIFU_PICS_ALLOW_NSFW === 'true';

/**
 * Categorias SFW (Safe For Work) disponíveis na Waifu.pics.
 * @type {string[]}
 */
const SFW_CATEGORIES = ['waifu', 'neko', 'shinobu', 'megumin', 'bully', 'cuddle', 'cry', 'hug', 'awoo', 'kiss', 'lick', 'pat', 'smug', 'bonk', 'yeet', 'blush', 'smile', 'wave', 'highfive', 'handhold', 'nom', 'bite', 'glomp', 'slap', 'kill', 'kick', 'happy', 'wink', 'poke', 'dance', 'cringe'];

/**
 * Categorias NSFW (Not Safe For Work) disponíveis na Waifu.pics.
 * @type {string[]}
 */
const NSFW_CATEGORIES = ['waifu', 'neko', 'trap', 'blowjob'];

const COMMAND_DEFINITION_BY_TYPE = Object.freeze({
  sfw: {
    preferredName: 'waifu',
    fallbackAlias: 'wp',
    modeLabel: '📗 SFW (seguro)',
  },
  nsfw: {
    preferredName: 'waifunsfw',
    fallbackAlias: 'wpnsfw',
    modeLabel: '🔞 NSFW (adulto)',
  },
});

const FALLBACK_CATEGORIES_BY_TYPE = Object.freeze({
  sfw: SFW_CATEGORIES,
  nsfw: NSFW_CATEGORIES,
});

const DEFAULT_FALLBACK_CATEGORY = 'waifu';

const normalizeType = (value) =>
  String(value || '')
    .trim()
    .toLowerCase() === 'nsfw'
    ? 'nsfw'
    : 'sfw';

const applyCommandPrefix = (value, commandPrefix = DEFAULT_COMMAND_PREFIX) => String(value || '').replaceAll('<prefix>', String(commandPrefix || DEFAULT_COMMAND_PREFIX));

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeTokenList = (values) => {
  const dedupe = new Set();
  for (const value of values || []) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized) continue;
    dedupe.add(normalized);
  }
  return [...dedupe];
};

const resolveCommandDefinition = (type = 'sfw') => {
  const normalizedType = normalizeType(type);
  const fallback = COMMAND_DEFINITION_BY_TYPE[normalizedType] || COMMAND_DEFINITION_BY_TYPE.sfw;
  const canonicalName = resolveWaifuPicsCommandName(fallback.preferredName) || resolveWaifuPicsCommandName(fallback.fallbackAlias) || fallback.preferredName;
  const entry = getWaifuPicsCommandEntry(canonicalName) || getWaifuPicsCommandEntry(fallback.fallbackAlias) || null;

  return {
    type: normalizedType,
    canonicalName,
    entry,
    modeLabel: fallback.modeLabel,
    fallbackAlias: fallback.fallbackAlias,
    fallbackCategories: FALLBACK_CATEGORIES_BY_TYPE[normalizedType] || FALLBACK_CATEGORIES_BY_TYPE.sfw,
  };
};

const resolveCommandToken = (entry, fallbackAlias = 'wp') => {
  const tokens = normalizeTokenList([entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]);
  if (!tokens.length) return fallbackAlias;
  return tokens.reduce((best, current) => (current.length < best.length ? current : best), tokens[0]);
};

const resolveResponseText = (entry, key, fallback = '') => {
  const responses = entry?.responses && typeof entry.responses === 'object' ? entry.responses : {};
  const legacyResponses = entry?.respostas_padrao && typeof entry.respostas_padrao === 'object' ? entry.respostas_padrao : {};

  if (key === 'success') {
    return firstString(responses.success, legacyResponses.sucesso, fallback);
  }
  if (key === 'usage_error') {
    return firstString(responses.usage_error, legacyResponses.erro_uso, fallback);
  }
  if (key === 'permission_error') {
    return firstString(responses.permission_error, legacyResponses.erro_permissao, fallback);
  }
  return firstString(fallback);
};

const resolveCommandCategories = (definition) => {
  const entry = definition?.entry;
  const argument = Array.isArray(entry?.arguments) ? entry.arguments[0] : null;
  const legacyArgument = Array.isArray(entry?.argumentos) ? entry.argumentos[0] : null;

  const configured = normalizeTokenList([...(Array.isArray(argument?.enum) ? argument.enum : []), ...(Array.isArray(argument?.values) ? argument.values : []), ...(Array.isArray(argument?.categories) ? argument.categories : []), ...(Array.isArray(legacyArgument?.enum) ? legacyArgument.enum : []), ...(Array.isArray(legacyArgument?.valores) ? legacyArgument.valores : []), ...(Array.isArray(legacyArgument?.categorias) ? legacyArgument.categorias : [])]);

  return configured.length ? configured : [...(definition?.fallbackCategories || FALLBACK_CATEGORIES_BY_TYPE.sfw)];
};

const resolveDefaultCategory = (definition, categories = []) => {
  const entry = definition?.entry;
  const argument = Array.isArray(entry?.arguments) ? entry.arguments[0] : null;
  const legacyArgument = Array.isArray(entry?.argumentos) ? entry.argumentos[0] : null;

  const configuredDefault = firstString(argument?.default, legacyArgument?.default).trim().toLowerCase();
  if (configuredDefault) return configuredDefault;

  const safeCategories = Array.isArray(categories) ? categories : [];
  if (safeCategories.includes(DEFAULT_FALLBACK_CATEGORY)) return DEFAULT_FALLBACK_CATEGORY;
  return safeCategories[0] || DEFAULT_FALLBACK_CATEGORY;
};

const resolvePrimaryUsageLine = (definition, commandPrefix = DEFAULT_COMMAND_PREFIX) => {
  const entry = definition?.entry;
  const methods = [...(Array.isArray(entry?.metodos_de_uso) ? entry.metodos_de_uso : []), ...(Array.isArray(entry?.usage) ? entry.usage : [])];
  const method = methods.find((value) => typeof value === 'string' && value.trim());
  if (method) return applyCommandPrefix(method, commandPrefix);

  const runtimeUsage = getWaifuPicsRuntimeUsageText(definition?.canonicalName || definition?.fallbackAlias || 'waifu', {
    commandPrefix,
    header: '',
  });
  const firstLine = String(runtimeUsage || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine;

  const token = resolveCommandToken(entry, definition?.fallbackAlias || 'wp');
  return `${commandPrefix}${token} <categoria>`;
};

/**
 * Quebra uma lista de categorias em sub-listas (chunks) para melhor formatação visual no WhatsApp.
 *
 * @param {string[]} categories - Lista de nomes das categorias.
 * @param {number} [chunkSize=6] - Tamanho de cada sub-lista.
 * @returns {string[][]} Array de chunks.
 */
const chunkCategories = (categories, chunkSize = 6) => {
  const chunks = [];
  for (let index = 0; index < categories.length; index += chunkSize) {
    chunks.push(categories.slice(index, index + chunkSize));
  }
  return chunks;
};

/**
 * Formata uma lista de categorias em múltiplas linhas usando separadores visuais (bullets).
 *
 * @param {string[]} categories - Lista de nomes das categorias.
 * @returns {string} String formatada para exibição.
 */
const formatCategoriesList = (categories) =>
  chunkCategories(categories)
    .map((chunk) => `• ${chunk.join(' • ')}`)
    .join('\n');

const toUsageCommandLine = (value, fallback) => {
  const line = String(value || '')
    .trim()
    .replace(/^\*\s*|\s*\*$/g, '');
  return line || fallback;
};

/**
 * Envia uma mensagem detalhada com as instruções de uso e as categorias disponíveis para o usuário.
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instância do socket Baileys ativa.
 * @param {string} remoteJid - JID (identificador) do chat de destino.
 * @param {import('@whiskeysockets/baileys').proto.IWebMessageInfo} messageInfo - Objeto da mensagem original para fins de resposta (reply).
 * @param {number|undefined} expirationMessage - Tempo de expiração (efêmero) da mensagem em segundos.
 * @param {'sfw'|'nsfw'} type - Tipo de conteúdo desejado (seguro ou adulto).
 * @param {string} [commandPrefix] - Prefixo customizado para os comandos.
 * @returns {Promise<void>}
 */
const sendUsage = async (sock, remoteJid, messageInfo, expirationMessage, type, commandPrefix = DEFAULT_COMMAND_PREFIX) => {
  const definition = resolveCommandDefinition(type);
  const list = resolveCommandCategories(definition);
  const usageErrorText = applyCommandPrefix(resolveResponseText(definition.entry, 'usage_error', ''), commandPrefix);
  const usageLine = toUsageCommandLine(resolvePrimaryUsageLine(definition, commandPrefix), `${commandPrefix}${definition.fallbackAlias} <categoria>`);

  await sendAndStore(
    sock,
    remoteJid,
    {
      text: ['🖼️ *Waifu pics*', '', usageErrorText, usageErrorText ? '' : null, `Modo: *${definition.modeLabel}*`, `Use: *${usageLine}*`, '', formatCategoriesList(list), '', `ℹ️ Dica: use *${commandPrefix}menu anime* para ver SFW e NSFW juntos.`].filter((line) => line !== null && line !== undefined).join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

/**
 * Realiza uma requisição HTTP à API Waifu.pics para obter a URL de uma imagem aleatória.
 *
 * @param {'sfw'|'nsfw'} type - Tipo de conteúdo (sfw ou nsfw).
 * @param {string} category - Nome da categoria desejada.
 * @returns {Promise<string|null>} Retorna a URL da imagem em caso de sucesso ou null em caso de falha na resposta.
 * @throws {Error} Pode lançar erro se a requisição falhar (ex: timeout ou erro de rede).
 */
const fetchWaifuPics = async (type, category) => {
  const url = `${WAIFU_PICS_BASE}/${type}/${category}`;
  const { data } = await axios.get(url, { timeout: WAIFU_PICS_TIMEOUT_MS });
  return data?.url || null;
};

/**
 * Handler principal para o processamento de comandos do módulo Waifu.pics.
 *
 * Este handler coordena o fluxo completo:
 * 1. Validação de permissões globais e locais (especialmente para conteúdo NSFW).
 * 2. Validação da categoria solicitada contra as listas permitidas.
 * 3. Busca da imagem através da integração com a API externa.
 * 4. Envio do resultado (imagem com legenda) ou de mensagens de erro/ajuda ao usuário.
 *
 * @param {Object} params - Parâmetros do handler.
 * @param {import('@whiskeysockets/baileys').WASocket} params.sock - Instância do socket Baileys ativa.
 * @param {string} params.remoteJid - JID do chat de destino.
 * @param {import('@whiskeysockets/baileys').proto.IWebMessageInfo} params.messageInfo - Objeto da mensagem original recebida.
 * @param {number|undefined} params.expirationMessage - Tempo de expiração configurado para mensagens no chat.
 * @param {string} params.text - Texto bruto enviado pelo usuário após o comando.
 * @param {'sfw'|'nsfw'} [params.type='sfw'] - Tipo de busca (padrão é 'sfw').
 * @param {string} [params.commandPrefix] - Prefixo utilizado para disparar o comando.
 * @returns {Promise<void>}
 */
export async function handleWaifuPicsCommand({ sock, remoteJid, messageInfo, expirationMessage, text, type = 'sfw', commandPrefix = DEFAULT_COMMAND_PREFIX }) {
  const definition = resolveCommandDefinition(type);
  const categoryList = resolveCommandCategories(definition);
  const fallbackCategory = resolveDefaultCategory(definition, categoryList);
  const category = (text || '').trim().toLowerCase() || fallbackCategory;
  const isGroupMessage = isGroupJid(remoteJid);

  // Verifica se o recurso NSFW está habilitado globalmente via variáveis de ambiente.
  if (definition.type === 'nsfw' && !WAIFU_PICS_ALLOW_NSFW) {
    const permissionText = applyCommandPrefix(resolveResponseText(definition.entry, 'permission_error', ''), commandPrefix);
    await sendAndStore(
      sock,
      remoteJid,
      {
        text: permissionText ? `⚠️ Conteúdo NSFW desativado. Habilite WAIFU_PICS_ALLOW_NSFW=true no .env.\n${permissionText}` : '⚠️ Conteúdo NSFW desativado. Habilite WAIFU_PICS_ALLOW_NSFW=true no .env.',
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  // Em grupo, exige NSFW ativo na configuração local; no privado, essa trava não se aplica.
  if (definition.type === 'nsfw' && isGroupMessage) {
    const config = await groupConfigStore.getGroupConfig(remoteJid);
    if (!config?.nsfwEnabled) {
      const permissionText = applyCommandPrefix(resolveResponseText(definition.entry, 'permission_error', ''), commandPrefix);
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: permissionText || `🔞 NSFW está desativado neste grupo. Um admin pode ativar com ${commandPrefix}nsfw on.`,
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }
  }

  // Valida se a categoria informada é suportada pela API para o tipo escolhido.
  if (!categoryList.includes(category)) {
    await sendUsage(sock, remoteJid, messageInfo, expirationMessage, definition.type, commandPrefix);
    return;
  }

  try {
    const imageUrl = await fetchWaifuPics(definition.type, category);
    if (!imageUrl) {
      await sendAndStore(sock, remoteJid, { text: '❌ Não foi possível obter a imagem agora. Tente novamente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      return;
    }

    // Envia a imagem obtida com uma legenda identificando o tipo e a categoria.
    await sendAndStore(
      sock,
      remoteJid,
      {
        image: { url: imageUrl },
        caption: `🖼️ ${definition.type.toUpperCase()} • ${category}`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleWaifuPicsCommand: erro ao consultar a API Waifu.pics.', {
      error: error.message,
      type: definition.type,
      command: definition.canonicalName,
      category,
    });
    await sendAndStore(sock, remoteJid, { text: '❌ Erro ao consultar a Waifu.pics. Tente novamente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}

/**
 * Gera uma string formatada contendo o texto de ajuda e o catálogo de categorias do módulo Waifu.pics.
 *
 * @param {string} [commandPrefix] - Prefixo a ser exibido nos exemplos de comando.
 * @returns {string} Texto de ajuda formatado.
 */
export const getWaifuPicsUsageText = (commandPrefix = DEFAULT_COMMAND_PREFIX) => {
  const sfwDefinition = resolveCommandDefinition('sfw');
  const nsfwDefinition = resolveCommandDefinition('nsfw');

  const sfwCategories = resolveCommandCategories(sfwDefinition);
  const nsfwCategories = resolveCommandCategories(nsfwDefinition);

  const sfwUsageLine = toUsageCommandLine(resolvePrimaryUsageLine(sfwDefinition, commandPrefix), `${commandPrefix}${sfwDefinition.fallbackAlias} <categoria>`);
  const nsfwUsageLine = toUsageCommandLine(resolvePrimaryUsageLine(nsfwDefinition, commandPrefix), `${commandPrefix}${nsfwDefinition.fallbackAlias} <categoria>`);

  const usageHeader = firstString(getWaifuPicsTextConfig()?.usage_header, '🖼️ *Waifu pics — Categorias*');
  const sampleCategory = resolveDefaultCategory(sfwDefinition, sfwCategories);
  const sampleToken = resolveCommandToken(sfwDefinition.entry, sfwDefinition.fallbackAlias);
  const sampleCommand = `${commandPrefix}${sampleToken} ${sampleCategory}`;

  return [usageHeader, '', `📗 *${COMMAND_DEFINITION_BY_TYPE.sfw.modeLabel.replace(/^📗\s*/, '')}*`, `Comando: *${sfwUsageLine}*`, formatCategoriesList(sfwCategories), '', `🔞 *${COMMAND_DEFINITION_BY_TYPE.nsfw.modeLabel.replace(/^🔞\s*/, '')}*`, `Comando: *${nsfwUsageLine}*`, formatCategoriesList(nsfwCategories), '', `Ex.: *${sampleCommand}*`].join('\n');
};
