import { createHash } from 'node:crypto';

import logger from '#logger';
import { executeQuery, TABLES } from '../../database/index.js';

const MAX_MODULE_KEY_LENGTH = 64;
const MAX_COMMAND_NAME_LENGTH = 64;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_MODEL_NAME_LENGTH = 80;
const MAX_SOURCE_LENGTH = 32;
const MAX_STATUS_LENGTH = 16;
const MAX_QUESTION_LENGTH = 512;
const MAX_KEYWORD_LENGTH = 80;
const MAX_PATTERN_LENGTH = 220;
const MAX_DESCRIPTION_LENGTH = 420;
const MAX_METHOD_LENGTH = 220;
const MAX_REVIEW_NOTES_LENGTH = 255;
const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 300;
const DEFAULT_STATE_LIMIT = 10_000;
const MAX_STATE_LIMIT = 50_000;

const ALLOWED_SUGGESTION_STATUS = new Set(['pending', 'applied', 'rejected']);

const SUGGESTION_FIELDS = ['capability_keywords', 'faq_patterns', 'user_phrasings', 'metodos_de_uso_sugeridos', 'descricao_sugerida'];

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

const normalizeDisplayText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeModuleKey = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_MODULE_KEY_LENGTH);

const normalizeCommandName = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_COMMAND_NAME_LENGTH);

const normalizeToolName = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_TOOL_NAME_LENGTH);

const normalizeSource = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_SOURCE_LENGTH) || 'llm';

const sanitizeShortText = (value, maxLength) => {
  const safe = normalizeDisplayText(value).slice(0, maxLength);
  return safe || null;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const normalizeListLimit = (value, fallback, maxLimit) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(maxLimit, parsed));
};

const normalizeStatus = (value) => {
  const normalized = normalizeText(value)
    .replace(/[^a-z]/g, '')
    .slice(0, MAX_STATUS_LENGTH);
  if (ALLOWED_SUGGESTION_STATUS.has(normalized)) return normalized;
  return 'pending';
};

const parseJsonSafe = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

const serializeJsonSafe = (value) => {
  if (!value || typeof value !== 'object') return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const uniqueNormalizedList = (items = [], { maxItems = 12, maxLength = 120, kind = 'text' } = {}) => {
  const source = Array.isArray(items) ? items : [];
  const output = [];
  const seen = new Set();

  for (const rawItem of source) {
    const display = normalizeDisplayText(rawItem);
    if (!display) continue;

    const normalized = kind === 'keyword' ? normalizeText(display).slice(0, maxLength) : display.slice(0, maxLength);
    if (!normalized) continue;

    const dedupKey = normalizeText(normalized);
    if (!dedupKey || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }

  return output;
};

const normalizeSuggestionPayload = (payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  const capabilityKeywords = uniqueNormalizedList(safePayload.capability_keywords, {
    maxItems: 24,
    maxLength: MAX_KEYWORD_LENGTH,
    kind: 'keyword',
  });
  const faqPatterns = uniqueNormalizedList(safePayload.faq_patterns, {
    maxItems: 24,
    maxLength: MAX_PATTERN_LENGTH,
  });
  const userPhrasings = uniqueNormalizedList(safePayload.user_phrasings, {
    maxItems: 28,
    maxLength: MAX_PATTERN_LENGTH,
  });
  const methodHints = uniqueNormalizedList(safePayload.metodos_de_uso_sugeridos, {
    maxItems: 16,
    maxLength: MAX_METHOD_LENGTH,
  });
  const descricaoSugerida = sanitizeShortText(safePayload.descricao_sugerida, MAX_DESCRIPTION_LENGTH);

  return {
    capability_keywords: capabilityKeywords,
    faq_patterns: faqPatterns,
    user_phrasings: userPhrasings,
    metodos_de_uso_sugeridos: methodHints,
    descricao_sugerida: descricaoSugerida,
  };
};

const hasMeaningfulSuggestion = (payload) => {
  if (!payload || typeof payload !== 'object') return false;
  if (sanitizeShortText(payload.descricao_sugerida, MAX_DESCRIPTION_LENGTH)) return true;
  for (const field of SUGGESTION_FIELDS) {
    if (!Array.isArray(payload[field])) continue;
    if (payload[field].length > 0) return true;
  }
  return false;
};

const buildSuggestionHash = ({ moduleKey, commandName, payload }) => {
  const canonicalJson = JSON.stringify(normalizeSuggestionPayload(payload));
  return createHash('sha256')
    .update(`${normalizeModuleKey(moduleKey)}:${normalizeCommandName(commandName)}:${canonicalJson}`)
    .digest('hex');
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
    logger.warn('Tabelas de enriquecimento de commandConfig indisponiveis.', {
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
  confidence: clamp01(row?.confidence),
  created_at: row?.created_at || null,
});

const normalizeSuggestionRow = (row = {}) => {
  const parsedSuggestion = normalizeSuggestionPayload(parseJsonSafe(row?.suggestion_json));
  return {
    id: Number(row?.id || 0),
    module_key: normalizeModuleKey(row?.module_key),
    command_name: normalizeCommandName(row?.command_name),
    source_tool: normalizeToolName(row?.source_tool),
    source_event_id: Number(row?.source_event_id || 0),
    user_question: sanitizeShortText(row?.user_question, MAX_QUESTION_LENGTH),
    normalized_question: sanitizeShortText(row?.normalized_question, MAX_QUESTION_LENGTH),
    suggestion: parsedSuggestion,
    confidence: clamp01(row?.confidence),
    model_name: sanitizeShortText(row?.model_name, MAX_MODEL_NAME_LENGTH),
    source: normalizeSource(row?.source),
    status: normalizeStatus(row?.status),
    suggestion_hash: sanitizeShortText(row?.suggestion_hash, 64),
    review_notes: sanitizeShortText(row?.review_notes, MAX_REVIEW_NOTES_LENGTH),
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    applied_at: row?.applied_at || null,
  };
};

const normalizeStateRow = (row = {}) => ({
  id: Number(row?.id || 0),
  module_key: normalizeModuleKey(row?.module_key),
  command_name: normalizeCommandName(row?.command_name),
  overlay: normalizeSuggestionPayload(parseJsonSafe(row?.overlay_json)),
  version: Math.max(0, Number(row?.version || 0)),
  confidence: clamp01(row?.confidence),
  last_suggestion_id: Number(row?.last_suggestion_id || 0),
  updated_at: row?.updated_at || null,
  created_at: row?.created_at || null,
});

const normalizeCursorValue = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
};

const suggestionsPayloadEquals = (left, right) => JSON.stringify(normalizeSuggestionPayload(left)) === JSON.stringify(normalizeSuggestionPayload(right));

export const isCommandConfigEnrichmentTableAvailable = () => tableAvailabilityState.available;

export async function getCommandConfigEnrichmentCursor() {
  if (!isCommandConfigEnrichmentTableAvailable()) return 0;

  try {
    const rows = await executeQuery(
      `SELECT last_learning_event_id
       FROM ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_CURSOR}
       WHERE id = 1
       LIMIT 1`,
      [],
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return normalizeCursorValue(row?.last_learning_event_id);
  } catch (error) {
    if (handleTableError(error, 'command_config_enrichment_cursor_get')) return 0;

    logger.warn('Falha ao ler cursor de enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_cursor_get_failed',
      error: error?.message,
    });
    return 0;
  }
}

export async function updateCommandConfigEnrichmentCursor(lastLearningEventId) {
  if (!isCommandConfigEnrichmentTableAvailable()) return 0;

  const safeCursor = normalizeCursorValue(lastLearningEventId);
  try {
    await executeQuery(
      `INSERT INTO ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_CURSOR}
        (id, last_learning_event_id)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE
         last_learning_event_id = GREATEST(last_learning_event_id, VALUES(last_learning_event_id)),
         updated_at = CURRENT_TIMESTAMP()`,
      [safeCursor],
    );
    return safeCursor;
  } catch (error) {
    if (
      handleTableError(error, 'command_config_enrichment_cursor_update', {
        cursor: safeCursor,
      })
    ) {
      return 0;
    }

    logger.warn('Falha ao atualizar cursor de enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_cursor_update_failed',
      cursor: safeCursor,
      error: error?.message,
    });
    return 0;
  }
}

export async function listLearningEventsForCommandConfigEnrichment({ afterId = 0, limit = DEFAULT_EVENT_LIMIT } = {}) {
  if (!isCommandConfigEnrichmentTableAvailable()) return [];

  const safeAfterId = normalizeCursorValue(afterId);
  const safeLimit = normalizeListLimit(limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
  try {
    const rows = await executeQuery(
      `SELECT id, user_question, normalized_question, tool_suggested, tool_executed,
              success, confidence, created_at
       FROM ${TABLES.AI_LEARNING_EVENTS}
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [safeAfterId, safeLimit],
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.map((row) => normalizeLearningEventRow(row)).filter((row) => row.id > 0);
  } catch (error) {
    if (
      handleTableError(error, 'command_config_enrichment_learning_events_list', {
        afterId: safeAfterId,
        limit: safeLimit,
      })
    ) {
      return [];
    }

    logger.warn('Falha ao listar eventos de aprendizado para enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_learning_events_list_failed',
      afterId: safeAfterId,
      limit: safeLimit,
      error: error?.message,
    });
    return [];
  }
}

export async function saveCommandConfigEnrichmentSuggestion({ moduleKey, commandName, sourceTool = null, sourceEventId = null, question = null, normalizedQuestion = null, suggestion = {}, confidence = 0.5, modelName = null, source = 'llm', status = 'pending' } = {}) {
  if (!isCommandConfigEnrichmentTableAvailable()) return null;

  const safeModuleKey = normalizeModuleKey(moduleKey);
  const safeCommandName = normalizeCommandName(commandName);
  const safeSourceTool = normalizeToolName(sourceTool);
  const safeSourceEventId = Number.parseInt(String(sourceEventId ?? ''), 10);
  const safeQuestion = sanitizeShortText(question, MAX_QUESTION_LENGTH);
  const safeNormalizedQuestion = sanitizeShortText(normalizedQuestion, MAX_QUESTION_LENGTH);
  const safeSuggestion = normalizeSuggestionPayload(suggestion);
  const safeConfidence = clamp01(confidence);
  const safeModelName = sanitizeShortText(modelName, MAX_MODEL_NAME_LENGTH);
  const safeSource = normalizeSource(source);
  const safeStatus = normalizeStatus(status);

  if (!safeModuleKey || !safeCommandName || !hasMeaningfulSuggestion(safeSuggestion)) {
    return null;
  }

  const suggestionJson = serializeJsonSafe(safeSuggestion);
  if (!suggestionJson) return null;

  const suggestionHash = buildSuggestionHash({
    moduleKey: safeModuleKey,
    commandName: safeCommandName,
    payload: safeSuggestion,
  });

  try {
    await executeQuery(
      `INSERT INTO ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_SUGGESTION}
        (module_key, command_name, source_tool, source_event_id, user_question, normalized_question,
         suggestion_json, confidence, model_name, source, status, suggestion_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         confidence = GREATEST(confidence, VALUES(confidence)),
         status = CASE
           WHEN status = 'applied' THEN 'applied'
           WHEN status = 'rejected' AND VALUES(status) = 'pending' THEN 'rejected'
           ELSE VALUES(status)
         END,
         updated_at = CURRENT_TIMESTAMP(),
         id = LAST_INSERT_ID(id)`,
      [safeModuleKey, safeCommandName, safeSourceTool || null, Number.isFinite(safeSourceEventId) && safeSourceEventId > 0 ? safeSourceEventId : null, safeQuestion, safeNormalizedQuestion, suggestionJson, Number(safeConfidence.toFixed(4)), safeModelName, safeSource, safeStatus, suggestionHash],
    );

    const rows = await executeQuery(
      `SELECT id, module_key, command_name, source_tool, source_event_id, user_question, normalized_question,
              suggestion_json, confidence, model_name, source, status, suggestion_hash, review_notes,
              created_at, updated_at, applied_at
       FROM ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_SUGGESTION}
       WHERE suggestion_hash = ?
       LIMIT 1`,
      [suggestionHash],
    );

    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? normalizeSuggestionRow(row) : null;
  } catch (error) {
    if (
      handleTableError(error, 'command_config_enrichment_suggestion_upsert', {
        moduleKey: safeModuleKey,
        commandName: safeCommandName,
      })
    ) {
      return null;
    }

    logger.warn('Falha ao salvar sugestao de enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_suggestion_upsert_failed',
      moduleKey: safeModuleKey,
      commandName: safeCommandName,
      error: error?.message,
    });
    return null;
  }
}

export const mergeCommandConfigEnrichmentPayload = (basePayload = {}, patchPayload = {}) => {
  const base = normalizeSuggestionPayload(basePayload);
  const patch = normalizeSuggestionPayload(patchPayload);

  const merged = {
    capability_keywords: uniqueNormalizedList([...base.capability_keywords, ...patch.capability_keywords], { maxItems: 28, maxLength: MAX_KEYWORD_LENGTH, kind: 'keyword' }),
    faq_patterns: uniqueNormalizedList([...base.faq_patterns, ...patch.faq_patterns], {
      maxItems: 30,
      maxLength: MAX_PATTERN_LENGTH,
    }),
    user_phrasings: uniqueNormalizedList([...base.user_phrasings, ...patch.user_phrasings], {
      maxItems: 36,
      maxLength: MAX_PATTERN_LENGTH,
    }),
    metodos_de_uso_sugeridos: uniqueNormalizedList([...base.metodos_de_uso_sugeridos, ...patch.metodos_de_uso_sugeridos], { maxItems: 18, maxLength: MAX_METHOD_LENGTH }),
    descricao_sugerida: sanitizeShortText(base.descricao_sugerida, MAX_DESCRIPTION_LENGTH) || sanitizeShortText(patch.descricao_sugerida, MAX_DESCRIPTION_LENGTH) || null,
  };

  return normalizeSuggestionPayload(merged);
};

const getSuggestionById = async (suggestionId) => {
  const safeId = Number.parseInt(String(suggestionId ?? ''), 10);
  if (!Number.isFinite(safeId) || safeId <= 0) return null;

  const rows = await executeQuery(
    `SELECT id, module_key, command_name, source_tool, source_event_id, user_question, normalized_question,
            suggestion_json, confidence, model_name, source, status, suggestion_hash, review_notes,
            created_at, updated_at, applied_at
     FROM ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_SUGGESTION}
     WHERE id = ?
     LIMIT 1`,
    [safeId],
  );

  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? normalizeSuggestionRow(row) : null;
};

const upsertCommandConfigEnrichmentState = async ({ moduleKey, commandName, overlayPatch = {}, confidence = 0.5, lastSuggestionId = null } = {}) => {
  const safeModuleKey = normalizeModuleKey(moduleKey);
  const safeCommandName = normalizeCommandName(commandName);
  const safeConfidence = clamp01(confidence);
  const safeSuggestionId = Number.parseInt(String(lastSuggestionId ?? ''), 10);
  const patch = normalizeSuggestionPayload(overlayPatch);
  if (!safeModuleKey || !safeCommandName || !hasMeaningfulSuggestion(patch)) {
    return {
      changed: false,
      version: 0,
      state: null,
    };
  }

  const existingRows = await executeQuery(
    `SELECT id, module_key, command_name, overlay_json, version, confidence, last_suggestion_id,
            updated_at, created_at
     FROM ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_STATE}
     WHERE module_key = ? AND command_name = ?
     LIMIT 1`,
    [safeModuleKey, safeCommandName],
  );
  const existingRow = Array.isArray(existingRows) ? existingRows[0] : null;
  const existing = existingRow ? normalizeStateRow(existingRow) : null;

  const mergedOverlay = mergeCommandConfigEnrichmentPayload(existing?.overlay || {}, patch);
  const changed = !suggestionsPayloadEquals(existing?.overlay || {}, mergedOverlay);
  const mergedJson = serializeJsonSafe(mergedOverlay);
  if (!mergedJson) {
    return {
      changed: false,
      version: existing?.version || 0,
      state: existing,
    };
  }

  if (!existing) {
    await executeQuery(
      `INSERT INTO ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_STATE}
        (module_key, command_name, overlay_json, version, confidence, last_suggestion_id)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [safeModuleKey, safeCommandName, mergedJson, Number(safeConfidence.toFixed(4)), Number.isFinite(safeSuggestionId) && safeSuggestionId > 0 ? safeSuggestionId : null],
    );
  } else if (changed) {
    await executeQuery(
      `UPDATE ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_STATE}
       SET overlay_json = ?,
           version = version + 1,
           confidence = GREATEST(confidence, ?),
           last_suggestion_id = ?,
           updated_at = CURRENT_TIMESTAMP()
       WHERE id = ?`,
      [mergedJson, Number(safeConfidence.toFixed(4)), Number.isFinite(safeSuggestionId) && safeSuggestionId > 0 ? safeSuggestionId : null, existing.id],
    );
  } else {
    await executeQuery(
      `UPDATE ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_STATE}
       SET confidence = GREATEST(confidence, ?),
           last_suggestion_id = ?,
           updated_at = CURRENT_TIMESTAMP()
       WHERE id = ?`,
      [Number(safeConfidence.toFixed(4)), Number.isFinite(safeSuggestionId) && safeSuggestionId > 0 ? safeSuggestionId : null, existing.id],
    );
  }

  const rows = await executeQuery(
    `SELECT id, module_key, command_name, overlay_json, version, confidence, last_suggestion_id,
            updated_at, created_at
     FROM ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_STATE}
     WHERE module_key = ? AND command_name = ?
     LIMIT 1`,
    [safeModuleKey, safeCommandName],
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  const state = row ? normalizeStateRow(row) : null;

  return {
    changed,
    version: state?.version || 0,
    state,
  };
};

export async function markCommandConfigEnrichmentSuggestionStatus({ suggestionId, status, reviewNotes = null } = {}) {
  if (!isCommandConfigEnrichmentTableAvailable()) return false;

  const safeId = Number.parseInt(String(suggestionId ?? ''), 10);
  const safeStatus = normalizeStatus(status);
  const safeReviewNotes = sanitizeShortText(reviewNotes, MAX_REVIEW_NOTES_LENGTH);
  if (!Number.isFinite(safeId) || safeId <= 0) return false;

  try {
    const setAppliedAt = safeStatus === 'applied' ? 'applied_at = CURRENT_TIMESTAMP(),' : '';
    const result = await executeQuery(
      `UPDATE ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_SUGGESTION}
       SET status = ?,
           ${setAppliedAt}
           review_notes = ?,
           updated_at = CURRENT_TIMESTAMP()
       WHERE id = ?`,
      [safeStatus, safeReviewNotes, safeId],
    );
    return Number(result?.affectedRows || 0) > 0;
  } catch (error) {
    if (
      handleTableError(error, 'command_config_enrichment_suggestion_mark_status', {
        suggestionId: safeId,
        status: safeStatus,
      })
    ) {
      return false;
    }

    logger.warn('Falha ao atualizar status da sugestao de enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_suggestion_mark_status_failed',
      suggestionId: safeId,
      status: safeStatus,
      error: error?.message,
    });
    return false;
  }
}

export async function applyCommandConfigEnrichmentSuggestion({ suggestionId, reviewNotes = null } = {}) {
  if (!isCommandConfigEnrichmentTableAvailable()) {
    return {
      applied: false,
      changed: false,
      version: 0,
      state: null,
      suggestion: null,
    };
  }

  const safeSuggestionId = Number.parseInt(String(suggestionId ?? ''), 10);
  if (!Number.isFinite(safeSuggestionId) || safeSuggestionId <= 0) {
    return {
      applied: false,
      changed: false,
      version: 0,
      state: null,
      suggestion: null,
    };
  }

  try {
    const suggestion = await getSuggestionById(safeSuggestionId);
    if (!suggestion || !hasMeaningfulSuggestion(suggestion.suggestion)) {
      return {
        applied: false,
        changed: false,
        version: 0,
        state: null,
        suggestion: suggestion || null,
      };
    }
    if (suggestion.status === 'rejected') {
      return {
        applied: false,
        changed: false,
        version: 0,
        state: null,
        suggestion,
      };
    }

    const upsertResult = await upsertCommandConfigEnrichmentState({
      moduleKey: suggestion.module_key,
      commandName: suggestion.command_name,
      overlayPatch: suggestion.suggestion,
      confidence: suggestion.confidence,
      lastSuggestionId: suggestion.id,
    });

    await markCommandConfigEnrichmentSuggestionStatus({
      suggestionId: suggestion.id,
      status: 'applied',
      reviewNotes,
    });

    return {
      applied: true,
      changed: Boolean(upsertResult.changed),
      version: Number(upsertResult.version || 0),
      state: upsertResult.state || null,
      suggestion,
    };
  } catch (error) {
    if (
      handleTableError(error, 'command_config_enrichment_suggestion_apply', {
        suggestionId: safeSuggestionId,
      })
    ) {
      return {
        applied: false,
        changed: false,
        version: 0,
        state: null,
        suggestion: null,
      };
    }

    logger.warn('Falha ao aplicar sugestao de enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_suggestion_apply_failed',
      suggestionId: safeSuggestionId,
      error: error?.message,
    });
    return {
      applied: false,
      changed: false,
      version: 0,
      state: null,
      suggestion: null,
    };
  }
}

export async function listAppliedCommandConfigEnrichmentStates({ limit = DEFAULT_STATE_LIMIT } = {}) {
  if (!isCommandConfigEnrichmentTableAvailable()) return [];

  const safeLimit = normalizeListLimit(limit, DEFAULT_STATE_LIMIT, MAX_STATE_LIMIT);
  try {
    const rows = await executeQuery(
      `SELECT id, module_key, command_name, overlay_json, version, confidence, last_suggestion_id,
              updated_at, created_at
       FROM ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_STATE}
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
      [safeLimit],
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.map((row) => normalizeStateRow(row)).filter((row) => row.id > 0 && row.module_key && row.command_name);
  } catch (error) {
    if (handleTableError(error, 'command_config_enrichment_state_list', { limit: safeLimit })) {
      return [];
    }

    logger.warn('Falha ao listar estado aplicado de enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_state_list_failed',
      limit: safeLimit,
      error: error?.message,
    });
    return [];
  }
}

export async function getCommandConfigEnrichmentVersion() {
  if (!isCommandConfigEnrichmentTableAvailable()) {
    return {
      maxStateId: 0,
      maxVersion: 0,
      totalRows: 0,
      version: '0:0:0',
    };
  }

  try {
    const rows = await executeQuery(
      `SELECT
          COALESCE(MAX(id), 0) AS max_state_id,
          COALESCE(MAX(version), 0) AS max_version,
          COALESCE(COUNT(*), 0) AS total_rows
       FROM ${TABLES.AI_COMMAND_CONFIG_ENRICHMENT_STATE}`,
      [],
    );
    const row = Array.isArray(rows) ? rows[0] : {};
    const maxStateId = Number(row?.max_state_id || 0);
    const maxVersion = Number(row?.max_version || 0);
    const totalRows = Number(row?.total_rows || 0);
    return {
      maxStateId,
      maxVersion,
      totalRows,
      version: `${maxStateId}:${maxVersion}:${totalRows}`,
    };
  } catch (error) {
    if (handleTableError(error, 'command_config_enrichment_version_get')) {
      return {
        maxStateId: 0,
        maxVersion: 0,
        totalRows: 0,
        version: '0:0:0',
      };
    }

    logger.warn('Falha ao ler versao do estado de enriquecimento de commandConfig.', {
      action: 'command_config_enrichment_version_get_failed',
      error: error?.message,
    });
    return {
      maxStateId: 0,
      maxVersion: 0,
      totalRows: 0,
      version: '0:0:0',
    };
  }
}

export function resetCommandConfigEnrichmentTableStateForTests() {
  tableAvailabilityState = {
    available: true,
    unavailableLogged: false,
  };
}
