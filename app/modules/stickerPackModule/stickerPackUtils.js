import { createHash } from 'node:crypto';
import { normalizeJid } from '../../config/baileysConfig.js';

const removeControlChars = (value) =>
  Array.from(String(value ?? ''))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return !(code <= 31 || code === 127);
    })
    .join('');

export const sanitizeText = (value, maxLength, { allowEmpty = false } = {}) => {
  const normalized = removeControlChars(value).replace(/\s+/g, ' ').trim();

  const sliced = maxLength ? normalized.slice(0, maxLength) : normalized;
  if (!sliced && !allowEmpty) return null;
  return sliced;
};

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

export const shortHash = (value, size = 8) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, size);

export const normalizeOwnerJid = (jid) => normalizeJid(jid || '') || jid || '';

export const toVisibility = (value, fallback = 'private') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'public' || normalized === 'unlisted' || normalized === 'private') {
    return normalized;
  }
  return fallback;
};

export const parseEmojiList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).slice(0, 8);

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
};
