const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

export const XP_CONFIG = {
  baseXp: Math.max(1, Math.round(parseNumber(process.env.XP_BASE_XP, 5))),
  cooldownMs: Math.max(0, Math.round(parseNumber(process.env.XP_COOLDOWN_MS, 15000))),
  bootstrapBatchSize: Math.max(500, Math.round(parseNumber(process.env.XP_BOOTSTRAP_BATCH_SIZE, 5000))),
  ignoreCommandMessages: parseBoolean(process.env.XP_IGNORE_COMMANDS, true),
  notifyLevelUp: parseBoolean(process.env.XP_NOTIFY_LEVEL_UP, true),
};

export const LEVEL_MULTIPLIER_RANGES = Object.freeze([
  { minLevel: 1, maxLevel: 4, multiplier: 1.0 },
  { minLevel: 5, maxLevel: 9, multiplier: 1.1 },
  { minLevel: 10, maxLevel: 14, multiplier: 1.2 },
  { minLevel: 15, maxLevel: 19, multiplier: 1.3 },
  { minLevel: 20, maxLevel: Number.POSITIVE_INFINITY, multiplier: 1.5 },
]);

export const EMPTY_MESSAGE_CONTENT_MARKER = 'Mensagem vazia';
export const UNSUPPORTED_MESSAGE_CONTENT_MARKER = 'Tipo de mensagem não suportado ou sem conteúdo.';
export const NON_XP_CONTENT_MARKERS = new Set([
  EMPTY_MESSAGE_CONTENT_MARKER,
  UNSUPPORTED_MESSAGE_CONTENT_MARKER,
  '[Histórico de mensagens]',
  '[Aviso de histórico de mensagens]',
  '[Chamada]',
]);

const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

export const getBootstrapCommandPrefixes = () => {
  const prefixes = new Set([DEFAULT_COMMAND_PREFIX, '#']);
  return Array.from(prefixes).filter((value) => typeof value === 'string' && value.trim() !== '');
};

export const getLevelMultiplier = (level) => {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const range = LEVEL_MULTIPLIER_RANGES.find((item) => safeLevel >= item.minLevel && safeLevel <= item.maxLevel);
  return range?.multiplier || 1;
};

export const xpNeededForLevel = (level) => {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return Math.floor(100 * safeLevel ** 1.5);
};

export const calculateLevelFromXp = (totalXp) => {
  const safeXp = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  let level = 1;
  let remainingXp = safeXp;

  while (remainingXp >= xpNeededForLevel(level)) {
    remainingXp -= xpNeededForLevel(level);
    level += 1;
  }

  return {
    level,
    remainingXp,
    nextLevelXp: xpNeededForLevel(level),
  };
};

export const isEligibleContentForXp = (content) => {
  if (typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (NON_XP_CONTENT_MARKERS.has(trimmed)) return false;
  return true;
};

export const resolveXpGainForLevel = (level) => Math.round(XP_CONFIG.baseXp * getLevelMultiplier(level));
