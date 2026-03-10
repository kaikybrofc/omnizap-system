import axios from 'axios';

import logger from '@kaikybrofc/logger-module';
import groupConfigStore from '../../store/groupConfigStore.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { getWaifuPicsUsageText as getWaifuPicsRuntimeUsageText } from './waifuPicsConfigRuntime.js';

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
 * Timeout das requisições para a Waifu.pics (em ms).
 * @type {number}
 */
const WAIFU_PICS_TIMEOUT_MS = Number.parseInt(process.env.WAIFU_PICS_TIMEOUT_MS || '15000', 10);

/**
 * Define se conteúdo NSFW é permitido globalmente.
 * @type {boolean}
 */
const WAIFU_PICS_ALLOW_NSFW = process.env.WAIFU_PICS_ALLOW_NSFW === 'true';

/**
 * Categorias SFW disponíveis na Waifu.pics.
 * @type {string[]}
 */
const SFW_CATEGORIES = ['waifu', 'neko', 'shinobu', 'megumin', 'bully', 'cuddle', 'cry', 'hug', 'awoo', 'kiss', 'lick', 'pat', 'smug', 'bonk', 'yeet', 'blush', 'smile', 'wave', 'highfive', 'handhold', 'nom', 'bite', 'glomp', 'slap', 'kill', 'kick', 'happy', 'wink', 'poke', 'dance', 'cringe'];

/**
 * Categorias NSFW disponíveis na Waifu.pics.
 * @type {string[]}
 */
const NSFW_CATEGORIES = ['waifu', 'neko', 'trap', 'blowjob'];

/**
 * Quebra categorias em linhas menores para leitura no WhatsApp.
 *
 * @param {string[]} categories
 * @param {number} [chunkSize=6]
 * @returns {string[][]}
 */
const chunkCategories = (categories, chunkSize = 6) => {
  const chunks = [];
  for (let index = 0; index < categories.length; index += chunkSize) {
    chunks.push(categories.slice(index, index + chunkSize));
  }
  return chunks;
};

/**
 * Formata categorias em múltiplas linhas com bullets.
 *
 * @param {string[]} categories
 * @returns {string}
 */
const formatCategoriesList = (categories) =>
  chunkCategories(categories)
    .map((chunk) => `• ${chunk.join(' • ')}`)
    .join('\n');

/**
 * Envia mensagem de uso/categorias disponíveis para o usuário.
 *
 * @param {object} sock - Instância do socket Baileys.
 * @param {string} remoteJid - JID do chat.
 * @param {object} messageInfo - Mensagem original para reply.
 * @param {number|undefined} expirationMessage - Tempo de expiração da mensagem.
 * @param {'sfw'|'nsfw'} type - Tipo de conteúdo.
 * @param {string} [commandPrefix] - Prefixo do comando.
 * @returns {Promise<void>}
 */
const sendUsage = async (sock, remoteJid, messageInfo, expirationMessage, type, commandPrefix = DEFAULT_COMMAND_PREFIX) => {
  const list = type === 'nsfw' ? NSFW_CATEGORIES : SFW_CATEGORIES;
  const modeLabel = type === 'nsfw' ? '🔞 NSFW (adulto)' : '📗 SFW (seguro)';
  const commandName = type === 'nsfw' ? 'wpnsfw' : 'wp';
  const runtimeUsage = getWaifuPicsRuntimeUsageText(commandName, { commandPrefix });
  const command = `${commandPrefix}wp${type === 'nsfw' ? 'nsfw' : ''} <categoria>`;
  const commandLine = runtimeUsage ? `Use: *${runtimeUsage.split('\n')[0].replace(/^\*\s*|\s*\*$/g, '')}*` : `Use: *${command}*`;

  await sendAndStore(
    sock,
    remoteJid,
    {
      text: ['🖼️ *Waifu pics*', '', `Modo: *${modeLabel}*`, commandLine, '', formatCategoriesList(list), '', `ℹ️ Dica: use *${commandPrefix}menu anime* para ver SFW e NSFW juntos.`].join('\n'),
    },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

/**
 * Busca uma imagem na API Waifu.pics.
 *
 * @param {'sfw'|'nsfw'} type - Tipo de conteúdo.
 * @param {string} category - Categoria desejada.
 * @returns {Promise<string|null>} URL da imagem ou null em caso de falha.
 */
const fetchWaifuPics = async (type, category) => {
  const url = `${WAIFU_PICS_BASE}/${type}/${category}`;
  const { data } = await axios.get(url, { timeout: WAIFU_PICS_TIMEOUT_MS });
  return data?.url || null;
};

/**
 * Handler principal do comando Waifu.pics.
 *
 * Responsável por:
 * - Validar NSFW global e por grupo
 * - Validar categoria
 * - Buscar imagem na API
 * - Enviar resposta ao usuário
 *
 * @param {object} params
 * @param {object} params.sock - Instância do socket Baileys.
 * @param {string} params.remoteJid - JID do chat.
 * @param {object} params.messageInfo - Mensagem original.
 * @param {number|undefined} params.expirationMessage - Tempo de expiração da mensagem.
 * @param {string} params.text - Texto enviado pelo usuário.
 * @param {'sfw'|'nsfw'} [params.type='sfw'] - Tipo de conteúdo.
 * @param {string} [params.commandPrefix] - Prefixo do comando.
 * @returns {Promise<void>}
 */
export async function handleWaifuPicsCommand({ sock, remoteJid, messageInfo, expirationMessage, text, type = 'sfw', commandPrefix = DEFAULT_COMMAND_PREFIX }) {
  const category = (text || '').trim().toLowerCase() || 'waifu';

  if (type === 'nsfw' && !WAIFU_PICS_ALLOW_NSFW) {
    await sendAndStore(sock, remoteJid, { text: '⚠️ Conteúdo NSFW desativado. Habilite WAIFU_PICS_ALLOW_NSFW=true no .env.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
    return;
  }

  if (type === 'nsfw') {
    const config = await groupConfigStore.getGroupConfig(remoteJid);
    if (!config?.nsfwEnabled) {
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: `🔞 NSFW está desativado neste grupo. Um admin pode ativar com ${commandPrefix}nsfw on.`,
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }
  }

  const allowed = type === 'nsfw' ? NSFW_CATEGORIES : SFW_CATEGORIES;
  if (!allowed.includes(category)) {
    await sendUsage(sock, remoteJid, messageInfo, expirationMessage, type, commandPrefix);
    return;
  }

  try {
    const imageUrl = await fetchWaifuPics(type, category);
    if (!imageUrl) {
      await sendAndStore(sock, remoteJid, { text: '❌ Não foi possível obter a imagem agora. Tente novamente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      return;
    }

    await sendAndStore(
      sock,
      remoteJid,
      {
        image: { url: imageUrl },
        caption: `🖼️ ${type.toUpperCase()} • ${category}`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
  } catch (error) {
    logger.error('handleWaifuPicsCommand: erro na Waifu.pics.', error);
    await sendAndStore(sock, remoteJid, { text: '❌ Erro ao consultar a Waifu.pics. Tente novamente.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
  }
}

/**
 * Retorna o texto de ajuda/uso do comando Waifu.pics.
 *
 * @param {string} [commandPrefix] - Prefixo do comando.
 * @returns {string}
 */
export const getWaifuPicsUsageText = (commandPrefix = DEFAULT_COMMAND_PREFIX) => ['🖼️ *Waifu pics — Categorias*', '', '📗 *SFW (seguro)*', `Comando: *${commandPrefix}wp* <categoria>`, formatCategoriesList(SFW_CATEGORIES), '', '🔞 *NSFW (adulto)*', `Comando: *${commandPrefix}wpnsfw* <categoria>`, formatCategoriesList(NSFW_CATEGORIES), '', `Ex.: *${commandPrefix}wp neko*`].join('\n');
