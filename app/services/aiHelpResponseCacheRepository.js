import { createHash } from 'node:crypto';

import logger from '../../utils/logger/loggerModule.js';
import { executeQuery, TABLES } from '../../database/index.js';

const MAX_MODULE_KEY_LENGTH = 64;
const MAX_SCOPE_LENGTH = 32;
const MAX_QUESTION_LENGTH = 512;
const MAX_COMMAND_NAME_LENGTH = 64;
const MAX_SOURCE_LENGTH = 32;
const MAX_MODEL_NAME_LENGTH = 80;
const DEFAULT_LIST_LIMIT = 120;
const MAX_LIST_LIMIT = 400;

let tableAvailabilityState = {
  available: true,
  unavailableLogged: false,
};

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s/_.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeShortText = (value, maxLength) => {
  const normalized = String(value || '')
    .trim()
    .slice(0, maxLength);
  return normalized || null;
};

const sanitizeMetadata = (value) => {
  if (!value || typeof value !== 'object') return null;
  try {
    const json = JSON.stringify(value);
    if (!json || json === '{}') return null;
    return json;
  } catch {
    return null;
  }
};

const parseMetadata = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const normalizeModuleKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_MODULE_KEY_LENGTH);

const normalizeScope = (value) =>
  String(value || 'question')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_SCOPE_LENGTH) || 'question';

const normalizeQuestion = (value) => normalizeText(value).slice(0, MAX_QUESTION_LENGTH).trim();
const normalizeListLimit = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, parsed));
};

const buildQuestionHash = ({ moduleKey, scope, normalizedQuestion }) =>
  createHash('sha256').update(`${moduleKey}:${scope}:${normalizedQuestion}`).digest('hex');

const handleTableError = (error, action, context = {}) => {
  if (error?.code === 'ER_NO_SUCH_TABLE') {
    const shouldLog = !tableAvailabilityState.unavailableLogged;
    tableAvailabilityState = {
      available: false,
      unavailableLogged: true,
    };
    if (shouldLog) {
      logger.warn('Tabela de cache de respostas de IA indisponível.', {
        action,
        context,
        errorCode: error?.code,
      });
    }
    return true;
  }
  return false;
};

const isTableAvailable = () => tableAvailabilityState.available;

const normalizeRow = (row) => ({
  question_hash: sanitizeShortText(row?.question_hash, 64),
  module_key: sanitizeShortText(row?.module_key, MAX_MODULE_KEY_LENGTH),
  scope: sanitizeShortText(row?.scope, MAX_SCOPE_LENGTH) || 'question',
  command_name: sanitizeShortText(row?.command_name, MAX_COMMAND_NAME_LENGTH),
  source: sanitizeShortText(row?.source, MAX_SOURCE_LENGTH),
  answer_text: String(row?.answer_text || '').trim(),
  model_name: sanitizeShortText(row?.model_name, MAX_MODEL_NAME_LENGTH),
  metadata: parseMetadata(row?.metadata),
  normalized_question: sanitizeShortText(row?.normalized_question, MAX_QUESTION_LENGTH),
  original_question: sanitizeShortText(row?.original_question, MAX_QUESTION_LENGTH),
  hit_count: Number(row?.hit_count || 0),
  last_used_at: row?.last_used_at || null,
  updated_at: row?.updated_at || null,
  created_at: row?.created_at || null,
});

export async function getAiHelpCachedResponse({
  moduleKey,
  scope = 'question',
  question,
  normalizedQuestion,
  updateUsage = true,
} = {}) {
  if (!isTableAvailable()) return null;

  const safeModuleKey = normalizeModuleKey(moduleKey);
  const safeScope = normalizeScope(scope);
  const safeQuestion = normalizeQuestion(normalizedQuestion || question);

  if (!safeModuleKey || !safeScope || !safeQuestion) return null;

  const questionHash = buildQuestionHash({
    moduleKey: safeModuleKey,
    scope: safeScope,
    normalizedQuestion: safeQuestion,
  });

  try {
    const rows = await executeQuery(
      `SELECT question_hash, module_key, scope, command_name, source, answer_text, model_name, metadata,
              normalized_question, original_question, hit_count, last_used_at, updated_at, created_at
       FROM ${TABLES.AI_HELP_RESPONSE_CACHE}
       WHERE module_key = ? AND scope = ? AND question_hash = ?
       LIMIT 1`,
      [safeModuleKey, safeScope, questionHash],
    );

    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;

    if (updateUsage) {
      await executeQuery(
        `UPDATE ${TABLES.AI_HELP_RESPONSE_CACHE}
         SET hit_count = hit_count + 1,
             last_used_at = CURRENT_TIMESTAMP()
         WHERE module_key = ? AND scope = ? AND question_hash = ?`,
        [safeModuleKey, safeScope, questionHash],
      );
    }

    return normalizeRow(row);
  } catch (error) {
    if (
      handleTableError(error, 'ai_help_cache_read', { moduleKey: safeModuleKey, scope: safeScope })
    ) {
      return null;
    }
    logger.warn('Falha ao ler cache de resposta IA no banco.', {
      action: 'ai_help_cache_read_failed',
      moduleKey: safeModuleKey,
      scope: safeScope,
      error: error?.message,
    });
    return null;
  }
}

export async function listAiHelpCachedResponses({
  moduleKey,
  scope = 'question',
  limit = DEFAULT_LIST_LIMIT,
} = {}) {
  if (!isTableAvailable()) return [];

  const safeModuleKey = normalizeModuleKey(moduleKey);
  const safeScope = normalizeScope(scope);
  const safeLimit = normalizeListLimit(limit);
  if (!safeModuleKey || !safeScope) return [];

  try {
    const rows = await executeQuery(
      `SELECT question_hash, module_key, scope, command_name, source, answer_text, model_name, metadata,
              normalized_question, original_question, hit_count, last_used_at, updated_at, created_at
       FROM ${TABLES.AI_HELP_RESPONSE_CACHE}
       WHERE module_key = ? AND scope = ?
       ORDER BY last_used_at DESC, updated_at DESC
       LIMIT ?`,
      [safeModuleKey, safeScope, safeLimit],
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.map((row) => normalizeRow(row));
  } catch (error) {
    if (
      handleTableError(error, 'ai_help_cache_list', {
        moduleKey: safeModuleKey,
        scope: safeScope,
      })
    ) {
      return [];
    }
    logger.warn('Falha ao listar cache de resposta IA no banco.', {
      action: 'ai_help_cache_list_failed',
      moduleKey: safeModuleKey,
      scope: safeScope,
      error: error?.message,
    });
    return [];
  }
}

export async function upsertAiHelpCachedResponse({
  moduleKey,
  scope = 'question',
  question,
  normalizedQuestion,
  answer,
  source = 'deterministic',
  commandName = null,
  modelName = null,
  metadata = null,
} = {}) {
  if (!isTableAvailable()) return false;

  const safeModuleKey = normalizeModuleKey(moduleKey);
  const safeScope = normalizeScope(scope);
  const safeNormalizedQuestion = normalizeQuestion(normalizedQuestion || question);
  const safeOriginalQuestion = sanitizeShortText(
    question || normalizedQuestion,
    MAX_QUESTION_LENGTH,
  );
  const safeAnswer = String(answer || '').trim();
  const safeSource = sanitizeShortText(source, MAX_SOURCE_LENGTH) || 'deterministic';
  const safeCommandName = sanitizeShortText(commandName, MAX_COMMAND_NAME_LENGTH);
  const safeModelName = sanitizeShortText(modelName, MAX_MODEL_NAME_LENGTH);
  const safeMetadata = sanitizeMetadata(metadata);

  if (!safeModuleKey || !safeScope || !safeNormalizedQuestion || !safeAnswer) {
    return false;
  }

  const questionHash = buildQuestionHash({
    moduleKey: safeModuleKey,
    scope: safeScope,
    normalizedQuestion: safeNormalizedQuestion,
  });

  try {
    await executeQuery(
      `INSERT INTO ${TABLES.AI_HELP_RESPONSE_CACHE}
        (module_key, scope, question_hash, normalized_question, original_question, command_name,
         answer_text, source, model_name, metadata, hit_count, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         normalized_question = VALUES(normalized_question),
         original_question = VALUES(original_question),
         command_name = VALUES(command_name),
         answer_text = VALUES(answer_text),
         source = VALUES(source),
         model_name = VALUES(model_name),
         metadata = VALUES(metadata),
         hit_count = hit_count + 1,
         last_used_at = CURRENT_TIMESTAMP()`,
      [
        safeModuleKey,
        safeScope,
        questionHash,
        safeNormalizedQuestion,
        safeOriginalQuestion,
        safeCommandName,
        safeAnswer,
        safeSource,
        safeModelName,
        safeMetadata,
      ],
    );
    return true;
  } catch (error) {
    if (
      handleTableError(error, 'ai_help_cache_upsert', {
        moduleKey: safeModuleKey,
        scope: safeScope,
      })
    ) {
      return false;
    }
    logger.warn('Falha ao salvar cache de resposta IA no banco.', {
      action: 'ai_help_cache_upsert_failed',
      moduleKey: safeModuleKey,
      scope: safeScope,
      error: error?.message,
    });
    return false;
  }
}

export function resetAiHelpResponseCacheTableStateForTests() {
  tableAvailabilityState = {
    available: true,
    unavailableLogged: false,
  };
}
