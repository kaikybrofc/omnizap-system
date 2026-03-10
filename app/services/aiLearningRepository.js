import logger from '#logger';
import { executeQuery, TABLES } from '../../database/index.js';

const MAX_QUESTION_LENGTH = 512;
const MAX_TOOL_LENGTH = 64;
const MAX_PATTERN_LENGTH = 512;
const MAX_KEYWORD_LENGTH = 128;
const DEFAULT_PENDING_LIMIT = 50;
const MAX_PENDING_LIMIT = 200;
const DEFAULT_LEARNED_ROWS_LIMIT = 10_000;
const MAX_LEARNED_ROWS_LIMIT = 50_000;

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
  const safe = String(value || '')
    .trim()
    .slice(0, maxLength);
  return safe || null;
};

const normalizeToolName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_TOOL_LENGTH);

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const normalizePendingLimit = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PENDING_LIMIT;
  return Math.max(1, Math.min(MAX_PENDING_LIMIT, parsed));
};

const normalizeLearnedRowsLimit = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LEARNED_ROWS_LIMIT;
  return Math.max(50, Math.min(MAX_LEARNED_ROWS_LIMIT, parsed));
};

const handleTableError = (error, action, context = {}) => {
  const errorCode = error?.code || error?.errorCode || error?.originalError?.code || null;
  if (errorCode !== 'ER_NO_SUCH_TABLE') return false;

  const shouldLog = !tableAvailabilityState.unavailableLogged;
  tableAvailabilityState = {
    available: false,
    unavailableLogged: true,
  };

  if (shouldLog) {
    logger.warn('Tabelas de aprendizado de IA indisponiveis.', {
      action,
      context,
      errorCode,
    });
  }

  return true;
};

const normalizeLearningEventRow = (row = {}) => ({
  id: Number(row?.id || 0),
  user_question: sanitizeShortText(row?.user_question, MAX_QUESTION_LENGTH) || '',
  normalized_question: sanitizeShortText(row?.normalized_question, MAX_QUESTION_LENGTH) || '',
  tool_suggested: normalizeToolName(row?.tool_suggested),
  tool_executed: normalizeToolName(row?.tool_executed),
  success: row?.success === 1 || row?.success === true,
  confidence: Number(row?.confidence ?? 0) || 0,
  processed: row?.processed === 1 || row?.processed === true,
  created_at: row?.created_at || null,
});

export const isAiLearningTableAvailable = () => tableAvailabilityState.available;

export async function saveLearningEvent({ question, normalizedQuestion, toolSuggested, toolExecuted, success = true, confidence = null } = {}) {
  if (!isAiLearningTableAvailable()) return false;

  const safeQuestion = sanitizeShortText(question, MAX_QUESTION_LENGTH);
  const safeNormalizedQuestion = sanitizeShortText(normalizedQuestion || normalizeText(question), MAX_QUESTION_LENGTH);
  const safeToolSuggested = normalizeToolName(toolSuggested);
  const safeToolExecuted = normalizeToolName(toolExecuted || toolSuggested);
  const safeSuccess = success ? 1 : 0;
  const safeConfidence = confidence === null || confidence === undefined ? null : clamp01(confidence);

  if (!safeQuestion || !safeNormalizedQuestion || !safeToolSuggested || !safeToolExecuted) {
    return false;
  }

  try {
    await executeQuery(
      `INSERT INTO ${TABLES.AI_LEARNING_EVENTS}
        (user_question, normalized_question, tool_suggested, tool_executed, success, confidence, processed)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [safeQuestion, safeNormalizedQuestion, safeToolSuggested, safeToolExecuted, safeSuccess, safeConfidence],
    );
    return true;
  } catch (error) {
    if (
      handleTableError(error, 'ai_learning_event_insert', {
        toolSuggested: safeToolSuggested,
        toolExecuted: safeToolExecuted,
      })
    ) {
      return false;
    }

    logger.warn('Falha ao salvar evento de aprendizado de IA.', {
      action: 'ai_learning_event_insert_failed',
      toolSuggested: safeToolSuggested,
      toolExecuted: safeToolExecuted,
      error: error?.message,
    });
    return false;
  }
}

export async function listPendingLearningEvents({ limit = DEFAULT_PENDING_LIMIT } = {}) {
  if (!isAiLearningTableAvailable()) return [];

  const safeLimit = normalizePendingLimit(limit);
  try {
    const rows = await executeQuery(
      `SELECT id, user_question, normalized_question, tool_suggested, tool_executed,
              success, confidence, processed, created_at
       FROM ${TABLES.AI_LEARNING_EVENTS}
       WHERE processed = 0
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
      [safeLimit],
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.map((row) => normalizeLearningEventRow(row));
  } catch (error) {
    if (handleTableError(error, 'ai_learning_event_list_pending', { limit: safeLimit })) {
      return [];
    }

    logger.warn('Falha ao listar eventos pendentes de aprendizado.', {
      action: 'ai_learning_event_list_pending_failed',
      limit: safeLimit,
      error: error?.message,
    });
    return [];
  }
}

export async function markLearningEventsProcessed(eventIds = []) {
  if (!isAiLearningTableAvailable()) return 0;

  const ids = (Array.isArray(eventIds) ? eventIds : []).map((value) => Number.parseInt(String(value), 10)).filter((value) => Number.isFinite(value) && value > 0);

  if (!ids.length) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  try {
    const result = await executeQuery(
      `UPDATE ${TABLES.AI_LEARNING_EVENTS}
       SET processed = 1,
           processed_at = CURRENT_TIMESTAMP()
       WHERE id IN (${placeholders})`,
      ids,
    );
    return Number(result?.affectedRows || 0);
  } catch (error) {
    if (handleTableError(error, 'ai_learning_event_mark_processed', { count: ids.length })) {
      return 0;
    }

    logger.warn('Falha ao marcar eventos de aprendizado como processados.', {
      action: 'ai_learning_event_mark_processed_failed',
      count: ids.length,
      error: error?.message,
    });
    return 0;
  }
}

export async function insertLearnedPatterns(rows = []) {
  if (!isAiLearningTableAvailable()) return 0;

  const sanitizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      pattern: sanitizeShortText(row?.pattern, MAX_PATTERN_LENGTH),
      tool: normalizeToolName(row?.tool),
      confidence: clamp01(row?.confidence),
      sourceEventId: Number.parseInt(String(row?.sourceEventId), 10),
    }))
    .filter((row) => row.pattern && row.tool && Number.isFinite(row.sourceEventId) && row.sourceEventId > 0);

  if (!sanitizedRows.length) return 0;

  const placeholders = sanitizedRows.map(() => '(?, ?, ?, ?)').join(', ');
  const params = sanitizedRows.flatMap((row) => [row.pattern, row.tool, Number(row.confidence.toFixed(4)), row.sourceEventId]);

  try {
    const result = await executeQuery(
      `INSERT IGNORE INTO ${TABLES.AI_LEARNED_PATTERNS}
        (pattern, tool, confidence, source_event_id)
       VALUES ${placeholders}`,
      params,
    );
    return Number(result?.affectedRows || 0);
  } catch (error) {
    if (handleTableError(error, 'ai_learning_insert_patterns', { count: sanitizedRows.length })) {
      return 0;
    }

    logger.warn('Falha ao inserir padroes aprendidos de IA.', {
      action: 'ai_learning_insert_patterns_failed',
      count: sanitizedRows.length,
      error: error?.message,
    });
    return 0;
  }
}

export async function insertLearnedKeywords(rows = []) {
  if (!isAiLearningTableAvailable()) return 0;

  const sanitizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      keyword: sanitizeShortText(normalizeText(row?.keyword), MAX_KEYWORD_LENGTH),
      tool: normalizeToolName(row?.tool),
      weight: clamp01(row?.weight) || 0.5,
      sourceEventId: Number.parseInt(String(row?.sourceEventId), 10),
    }))
    .filter((row) => row.keyword && row.tool && Number.isFinite(row.sourceEventId) && row.sourceEventId > 0);

  if (!sanitizedRows.length) return 0;

  const placeholders = sanitizedRows.map(() => '(?, ?, ?, ?)').join(', ');
  const params = sanitizedRows.flatMap((row) => [row.keyword, row.tool, Number(row.weight.toFixed(4)), row.sourceEventId]);

  try {
    const result = await executeQuery(
      `INSERT IGNORE INTO ${TABLES.AI_LEARNED_KEYWORDS}
        (keyword, tool, weight, source_event_id)
       VALUES ${placeholders}`,
      params,
    );
    return Number(result?.affectedRows || 0);
  } catch (error) {
    if (handleTableError(error, 'ai_learning_insert_keywords', { count: sanitizedRows.length })) {
      return 0;
    }

    logger.warn('Falha ao inserir keywords aprendidas de IA.', {
      action: 'ai_learning_insert_keywords_failed',
      count: sanitizedRows.length,
      error: error?.message,
    });
    return 0;
  }
}

export async function getLearnedKnowledgeVersion() {
  if (!isAiLearningTableAvailable()) {
    return {
      patternsMaxId: 0,
      keywordsMaxId: 0,
      version: '0:0',
    };
  }

  try {
    const rows = await executeQuery(
      `SELECT
          (SELECT COALESCE(MAX(id), 0) FROM ${TABLES.AI_LEARNED_PATTERNS}) AS patterns_max_id,
          (SELECT COALESCE(MAX(id), 0) FROM ${TABLES.AI_LEARNED_KEYWORDS}) AS keywords_max_id`,
      [],
    );

    const row = Array.isArray(rows) ? rows[0] : {};
    const patternsMaxId = Number(row?.patterns_max_id || 0);
    const keywordsMaxId = Number(row?.keywords_max_id || 0);
    return {
      patternsMaxId,
      keywordsMaxId,
      version: `${patternsMaxId}:${keywordsMaxId}`,
    };
  } catch (error) {
    if (handleTableError(error, 'ai_learning_version_read')) {
      return {
        patternsMaxId: 0,
        keywordsMaxId: 0,
        version: '0:0',
      };
    }

    logger.warn('Falha ao ler versao de conhecimento aprendido.', {
      action: 'ai_learning_version_read_failed',
      error: error?.message,
    });
    return {
      patternsMaxId: 0,
      keywordsMaxId: 0,
      version: '0:0',
    };
  }
}

export async function listLearnedPatterns({ limit = DEFAULT_LEARNED_ROWS_LIMIT } = {}) {
  if (!isAiLearningTableAvailable()) return [];

  const safeLimit = normalizeLearnedRowsLimit(limit);
  try {
    const rows = await executeQuery(
      `SELECT id, pattern, tool, confidence, source_event_id, created_at
       FROM ${TABLES.AI_LEARNED_PATTERNS}
       ORDER BY id DESC
       LIMIT ?`,
      [safeLimit],
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows
      .map((row) => ({
        id: Number(row?.id || 0),
        pattern: sanitizeShortText(row?.pattern, MAX_PATTERN_LENGTH),
        tool: normalizeToolName(row?.tool),
        confidence: clamp01(row?.confidence),
        sourceEventId: Number(row?.source_event_id || 0),
        createdAt: row?.created_at || null,
      }))
      .filter((row) => row.id > 0 && row.pattern && row.tool);
  } catch (error) {
    if (handleTableError(error, 'ai_learning_list_patterns', { limit: safeLimit })) {
      return [];
    }

    logger.warn('Falha ao listar padroes aprendidos.', {
      action: 'ai_learning_list_patterns_failed',
      limit: safeLimit,
      error: error?.message,
    });
    return [];
  }
}

export async function listLearnedKeywords({ limit = DEFAULT_LEARNED_ROWS_LIMIT } = {}) {
  if (!isAiLearningTableAvailable()) return [];

  const safeLimit = normalizeLearnedRowsLimit(limit);
  try {
    const rows = await executeQuery(
      `SELECT id, keyword, tool, weight, source_event_id, created_at
       FROM ${TABLES.AI_LEARNED_KEYWORDS}
       ORDER BY id DESC
       LIMIT ?`,
      [safeLimit],
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows
      .map((row) => ({
        id: Number(row?.id || 0),
        keyword: sanitizeShortText(normalizeText(row?.keyword), MAX_KEYWORD_LENGTH),
        tool: normalizeToolName(row?.tool),
        weight: clamp01(row?.weight) || 0.5,
        sourceEventId: Number(row?.source_event_id || 0),
        createdAt: row?.created_at || null,
      }))
      .filter((row) => row.id > 0 && row.keyword && row.tool);
  } catch (error) {
    if (handleTableError(error, 'ai_learning_list_keywords', { limit: safeLimit })) {
      return [];
    }

    logger.warn('Falha ao listar keywords aprendidas.', {
      action: 'ai_learning_list_keywords_failed',
      limit: safeLimit,
      error: error?.message,
    });
    return [];
  }
}

export function resetAiLearningTableStateForTests() {
  tableAvailabilityState = {
    available: true,
    unavailableLogged: false,
  };
}
