import bcrypt from 'bcrypt';

const clampInt = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const parseEnvBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const DEFAULT_BCRYPT_ROUNDS = 12;
const MIN_BCRYPT_ROUNDS = 8;
const MAX_BCRYPT_ROUNDS = 15;

const DEFAULT_MIN_LENGTH = 12;
const DEFAULT_MAX_LENGTH = 72;
const MIN_ALLOWED_LENGTH = 10;
const MAX_ALLOWED_LENGTH = 72;

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

const DEFAULT_POLICY_INPUT = {
  bcryptRounds: clampInt(
    process.env.WEB_USER_PASSWORD_BCRYPT_ROUNDS,
    DEFAULT_BCRYPT_ROUNDS,
    MIN_BCRYPT_ROUNDS,
    MAX_BCRYPT_ROUNDS,
  ),
  minLength: clampInt(
    process.env.WEB_USER_PASSWORD_MIN_LENGTH,
    DEFAULT_MIN_LENGTH,
    MIN_ALLOWED_LENGTH,
    MAX_ALLOWED_LENGTH,
  ),
  maxLength: clampInt(
    process.env.WEB_USER_PASSWORD_MAX_LENGTH,
    DEFAULT_MAX_LENGTH,
    MIN_ALLOWED_LENGTH,
    MAX_ALLOWED_LENGTH,
  ),
  requireLetter: parseEnvBool(process.env.WEB_USER_PASSWORD_REQUIRE_LETTER, true),
  requireNumber: parseEnvBool(process.env.WEB_USER_PASSWORD_REQUIRE_NUMBER, true),
};

const normalizePolicyLength = (minLength, maxLength) => {
  const safeMin = clampInt(minLength, DEFAULT_MIN_LENGTH, MIN_ALLOWED_LENGTH, MAX_ALLOWED_LENGTH);
  const safeMax = clampInt(maxLength, DEFAULT_MAX_LENGTH, MIN_ALLOWED_LENGTH, MAX_ALLOWED_LENGTH);

  if (safeMin <= safeMax) {
    return {
      minLength: safeMin,
      maxLength: safeMax,
    };
  }

  return {
    minLength: safeMax,
    maxLength: safeMax,
  };
};

export const resolveUserPasswordPolicy = (overrides = {}) => {
  const merged = {
    ...DEFAULT_POLICY_INPUT,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  };

  const lengthPolicy = normalizePolicyLength(merged.minLength, merged.maxLength);

  return {
    bcryptRounds: clampInt(
      merged.bcryptRounds,
      DEFAULT_POLICY_INPUT.bcryptRounds,
      MIN_BCRYPT_ROUNDS,
      MAX_BCRYPT_ROUNDS,
    ),
    minLength: lengthPolicy.minLength,
    maxLength: lengthPolicy.maxLength,
    requireLetter: Boolean(merged.requireLetter),
    requireNumber: Boolean(merged.requireNumber),
  };
};

export const DEFAULT_USER_PASSWORD_POLICY = resolveUserPasswordPolicy();

const buildValidationError = (errors) => {
  const firstMessage = errors[0]?.message || 'Senha invalida.';
  const error = new Error(firstMessage);
  error.statusCode = 400;
  error.code = 'INVALID_PASSWORD';
  error.details = errors;
  return error;
};

export const validateUserPassword = (password, policyOverrides = {}) => {
  const policy = resolveUserPasswordPolicy(policyOverrides);
  const rawPassword = typeof password === 'string' ? password : '';
  const errors = [];

  if (!rawPassword) {
    errors.push({ code: 'PASSWORD_REQUIRED', message: 'Senha obrigatoria.' });
  }

  if (rawPassword && rawPassword.trim().length === 0) {
    errors.push({
      code: 'PASSWORD_WHITESPACE_ONLY',
      message: 'Senha nao pode conter apenas espacos.',
    });
  }

  if (rawPassword.length > 0 && rawPassword.length < policy.minLength) {
    errors.push({
      code: 'PASSWORD_TOO_SHORT',
      message: `Senha deve ter no minimo ${policy.minLength} caracteres.`,
    });
  }

  if (rawPassword.length > policy.maxLength) {
    errors.push({
      code: 'PASSWORD_TOO_LONG',
      message: `Senha deve ter no maximo ${policy.maxLength} caracteres.`,
    });
  }

  if (policy.requireLetter && rawPassword && !/[a-z]/i.test(rawPassword)) {
    errors.push({
      code: 'PASSWORD_LETTER_REQUIRED',
      message: 'Senha deve conter pelo menos uma letra.',
    });
  }

  if (policy.requireNumber && rawPassword && !/\d/.test(rawPassword)) {
    errors.push({
      code: 'PASSWORD_NUMBER_REQUIRED',
      message: 'Senha deve conter pelo menos um numero.',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    policy,
  };
};

export const hashUserPassword = async (password, policyOverrides = {}) => {
  const validation = validateUserPassword(password, policyOverrides);
  if (!validation.valid) {
    throw buildValidationError(validation.errors);
  }

  const hash = await bcrypt.hash(String(password), validation.policy.bcryptRounds);

  return {
    hash,
    algorithm: 'bcrypt',
    cost: validation.policy.bcryptRounds,
    policy: validation.policy,
  };
};

export const verifyUserPasswordHash = async (password, passwordHash) => {
  const rawHash = String(passwordHash || '').trim();
  if (!rawHash) return false;
  if (!BCRYPT_PREFIXES.some((prefix) => rawHash.startsWith(prefix))) return false;

  try {
    return await bcrypt.compare(String(password || ''), rawHash);
  } catch {
    return false;
  }
};
