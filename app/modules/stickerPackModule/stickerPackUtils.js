import { createHash } from 'node:crypto';
import { normalizeJid } from '../../config/baileysConfig.js';

/**
 * Utilitários compartilhados para normalização e sanitização de dados de packs.
 */
const removeControlChars = (value) =>
  Array.from(String(value ?? ''))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return !(code <= 31 || code === 127);
    })
    .join('');

/**
 * Sanitiza texto removendo caracteres de controle, espaços duplicados e limite de tamanho.
 *
 * @param {unknown} value Valor recebido na entrada.
 * @param {number} maxLength Limite máximo de caracteres.
 * @param {{ allowEmpty?: boolean }} [options] Configurações de sanitização.
 * @returns {string|null} Texto sanitizado ou `null` quando vazio e não permitido.
 */
export const sanitizeText = (value, maxLength, { allowEmpty = false } = {}) => {
  const normalized = removeControlChars(value).replace(/\s+/g, ' ').trim();

  const sliced = maxLength ? normalized.slice(0, maxLength) : normalized;
  if (!sliced && !allowEmpty) return null;
  return sliced;
};

/**
 * Converte texto para formato slug compatível com IDs legíveis.
 *
 * @param {unknown} value Texto de origem.
 * @param {{ fallback?: string, maxLength?: number }} [options] Fallback e tamanho máximo.
 * @returns {string} Slug normalizado.
 */
export const slugify = (value, { fallback = 'pack', maxLength = 32 } = {}) => {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);

  return normalized || fallback;
};

/**
 * Gera hash SHA-256 curto para identificação estável.
 *
 * @param {unknown} value Valor base para o hash.
 * @param {number} [size=8] Quantidade de caracteres retornados.
 * @returns {string} Hash hexadecimal truncado.
 */
export const shortHash = (value, size = 8) =>
  createHash('sha256')
    .update(String(value ?? ''))
    .digest('hex')
    .slice(0, size);

/**
 * Normaliza o JID do dono mantendo fallback para o valor original.
 *
 * @param {string} jid JID do usuário.
 * @returns {string} JID normalizado.
 */
export const normalizeOwnerJid = (jid) => normalizeJid(jid || '') || jid || '';

/**
 * Normaliza visibilidade para os valores aceitos pelo módulo.
 *
 * @param {unknown} value Valor recebido.
 * @param {'private'|'public'|'unlisted'|null} [fallback='private'] Valor de fallback.
 * @returns {'private'|'public'|'unlisted'|null} Valor de visibilidade válido.
 */
export const toVisibility = (value, fallback = 'private') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'public' || normalized === 'unlisted' || normalized === 'private') {
    return normalized;
  }
  return fallback;
};

/**
 * Converte string ou lista em array de emojis limitado a 8 itens.
 *
 * @param {string|string[]|unknown} value Emojis em string CSV ou array.
 * @returns {string[]} Lista normalizada de emojis.
 */
export const parseEmojiList = (value) => {
  if (!value) return [];
  if (Array.isArray(value))
    return value
      .map((item) => String(item))
      .filter(Boolean)
      .slice(0, 8);

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
};
