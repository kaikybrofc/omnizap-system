import argon2 from 'argon2';

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

const DEFAULT_ARGON2_TIME_COST = 3;
const MIN_ARGON2_TIME_COST = 2;
const MAX_ARGON2_TIME_COST = 10;

const DEFAULT_ARGON2_MEMORY_KB = 19_456;
const MIN_ARGON2_MEMORY_KB = 4_096;
const MAX_ARGON2_MEMORY_KB = 262_144;

const DEFAULT_ARGON2_PARALLELISM = 1;
const MIN_ARGON2_PARALLELISM = 1;
const MAX_ARGON2_PARALLELISM = 8;

const DEFAULT_ARGON2_HASH_LENGTH = 32;
const MIN_ARGON2_HASH_LENGTH = 16;
const MAX_ARGON2_HASH_LENGTH = 64;

const DEFAULT_MIN_LENGTH = 12;
const DEFAULT_MAX_LENGTH = 72;
const MIN_ALLOWED_LENGTH = 10;
const MAX_ALLOWED_LENGTH = 72;

const ARGON2_PREFIX = '$argon2id$';
const MIN_PEPPER_SECRET_LENGTH = 16;

const DEFAULT_POLICY_INPUT = {
  argon2TimeCost: clampInt(process.env.WEB_USER_PASSWORD_ARGON2_TIME_COST, DEFAULT_ARGON2_TIME_COST, MIN_ARGON2_TIME_COST, MAX_ARGON2_TIME_COST),
  argon2MemoryKb: clampInt(process.env.WEB_USER_PASSWORD_ARGON2_MEMORY_KB, DEFAULT_ARGON2_MEMORY_KB, MIN_ARGON2_MEMORY_KB, MAX_ARGON2_MEMORY_KB),
  argon2Parallelism: clampInt(process.env.WEB_USER_PASSWORD_ARGON2_PARALLELISM, DEFAULT_ARGON2_PARALLELISM, MIN_ARGON2_PARALLELISM, MAX_ARGON2_PARALLELISM),
  argon2HashLength: clampInt(process.env.WEB_USER_PASSWORD_ARGON2_HASH_LENGTH, DEFAULT_ARGON2_HASH_LENGTH, MIN_ARGON2_HASH_LENGTH, MAX_ARGON2_HASH_LENGTH),
  minLength: clampInt(process.env.WEB_USER_PASSWORD_MIN_LENGTH, DEFAULT_MIN_LENGTH, MIN_ALLOWED_LENGTH, MAX_ALLOWED_LENGTH),
  maxLength: clampInt(process.env.WEB_USER_PASSWORD_MAX_LENGTH, DEFAULT_MAX_LENGTH, MIN_ALLOWED_LENGTH, MAX_ALLOWED_LENGTH),
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
    argon2TimeCost: clampInt(merged.argon2TimeCost ?? merged.bcryptRounds, DEFAULT_POLICY_INPUT.argon2TimeCost, MIN_ARGON2_TIME_COST, MAX_ARGON2_TIME_COST),
    argon2MemoryKb: clampInt(merged.argon2MemoryKb, DEFAULT_POLICY_INPUT.argon2MemoryKb, MIN_ARGON2_MEMORY_KB, MAX_ARGON2_MEMORY_KB),
    argon2Parallelism: clampInt(merged.argon2Parallelism, DEFAULT_POLICY_INPUT.argon2Parallelism, MIN_ARGON2_PARALLELISM, MAX_ARGON2_PARALLELISM),
    argon2HashLength: clampInt(merged.argon2HashLength, DEFAULT_POLICY_INPUT.argon2HashLength, MIN_ARGON2_HASH_LENGTH, MAX_ARGON2_HASH_LENGTH),
    // Compatibilidade temporaria para consumidores legados.
    bcryptRounds: clampInt(merged.argon2TimeCost ?? merged.bcryptRounds, DEFAULT_POLICY_INPUT.argon2TimeCost, MIN_ARGON2_TIME_COST, MAX_ARGON2_TIME_COST),
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

const resolvePepperSecret = (overrideValue = '') => {
  const secret = String(overrideValue || process.env.WEB_USER_PASSWORD_PEPPER_SECRET || '').trim();
  if (secret.length >= MIN_PEPPER_SECRET_LENGTH) return secret;

  const error = new Error(`WEB_USER_PASSWORD_PEPPER_SECRET deve ter no minimo ${MIN_PEPPER_SECRET_LENGTH} caracteres.`);
  error.statusCode = 500;
  error.code = 'PASSWORD_PEPPER_NOT_CONFIGURED';
  throw error;
};

const buildPepperedPassword = (password, pepperSecret) => `${String(password || '')}${pepperSecret}`;

export const hashUserPassword = async (password, policyOverrides = {}, options = {}) => {
  const validation = validateUserPassword(password, policyOverrides);
  if (!validation.valid) {
    throw buildValidationError(validation.errors);
  }

  const pepperSecret = resolvePepperSecret(options?.pepperSecret);
  const hash = await argon2.hash(buildPepperedPassword(password, pepperSecret), {
    type: argon2.argon2id,
    timeCost: validation.policy.argon2TimeCost,
    memoryCost: validation.policy.argon2MemoryKb,
    parallelism: validation.policy.argon2Parallelism,
    hashLength: validation.policy.argon2HashLength,
  });

  return {
    hash,
    algorithm: 'argon2id',
    cost: validation.policy.argon2TimeCost,
    policy: validation.policy,
  };
};

export const verifyUserPasswordHash = async (password, passwordHash, options = {}) => {
  const rawHash = String(passwordHash || '').trim();
  if (!rawHash) return false;
  if (!rawHash.startsWith(ARGON2_PREFIX)) return false;

  try {
    const pepperSecret = resolvePepperSecret(options?.pepperSecret);
    return await argon2.verify(rawHash, buildPepperedPassword(password, pepperSecret));
  } catch {
    return false;
  }
};
