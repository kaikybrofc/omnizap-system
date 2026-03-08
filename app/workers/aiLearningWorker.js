import OpenAI from 'openai';
import logger from '../../utils/logger/loggerModule.js';
import {
  insertLearnedKeywords,
  insertLearnedPatterns,
  listPendingLearningEvents,
  markLearningEventsProcessed,
} from '../services/aiLearningRepository.js';
import { markToolCandidateLearningCacheDirty } from '../services/toolCandidateSelectorService.js';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_PATTERNS_PER_EVENT = 5;
const DEFAULT_MAX_KEYWORDS_PER_EVENT = 12;

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseEnvInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const AI_LEARNING_WORKER_ENABLED = parseEnvBool(process.env.AI_LEARNING_WORKER_ENABLED, true);
const AI_LEARNING_WORKER_INTERVAL_MS = parseEnvInt(
  process.env.AI_LEARNING_WORKER_INTERVAL_MS,
  DEFAULT_INTERVAL_MS,
  60_000,
  24 * 60 * 60 * 1000,
);
const AI_LEARNING_WORKER_BATCH_SIZE = parseEnvInt(
  process.env.AI_LEARNING_WORKER_BATCH_SIZE,
  DEFAULT_BATCH_SIZE,
  1,
  200,
);
const AI_LEARNING_WORKER_TIMEOUT_MS = parseEnvInt(
  process.env.AI_LEARNING_WORKER_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  5_000,
  60_000,
);
const AI_LEARNING_WORKER_MODEL =
  String(process.env.AI_LEARNING_WORKER_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
const AI_LEARNING_WORKER_MAX_PATTERNS = parseEnvInt(
  process.env.AI_LEARNING_WORKER_MAX_PATTERNS,
  DEFAULT_MAX_PATTERNS_PER_EVENT,
  1,
  12,
);
const AI_LEARNING_WORKER_MAX_KEYWORDS = parseEnvInt(
  process.env.AI_LEARNING_WORKER_MAX_KEYWORDS,
  DEFAULT_MAX_KEYWORDS_PER_EVENT,
  3,
  30,
);

let schedulerHandle = null;
let schedulerStarted = false;
let cycleInProgress = false;
let cachedClient = null;

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s/_.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const uniqueList = (items = []) =>
  Array.from(new Set((Array.isArray(items) ? items : []).map((item) => normalizeText(item))))
    .filter(Boolean)
    .map((item) => item.trim());

const sanitizePattern = (value) => {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 512);
  return normalized || null;
};

const sanitizeKeyword = (value) => {
  const normalized = normalizeText(value).slice(0, 128);
  return normalized || null;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const extractTextFromAssistantMessage = (message = {}) => {
  if (typeof message?.content === 'string') return message.content.trim();
  if (!Array.isArray(message?.content)) return '';

  const parts = [];
  for (const chunk of message.content) {
    if (!chunk || typeof chunk !== 'object') continue;
    if (typeof chunk.text === 'string') {
      parts.push(chunk.text.trim());
      continue;
    }
    if (chunk.type === 'text' && typeof chunk?.text?.value === 'string') {
      parts.push(chunk.text.value.trim());
    }
  }

  return parts.filter(Boolean).join('\n').trim();
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

const getOpenAIClient = () => {
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: AI_LEARNING_WORKER_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return cachedClient;
};

const isWorkerReady = () => {
  if (!AI_LEARNING_WORKER_ENABLED) return false;
  if (!process.env.OPENAI_API_KEY) return false;
  return true;
};

const buildWorkerSystemPrompt = () =>
  [
    'Voce recebe um comando existente e a pergunta real do usuario.',
    'Sua tarefa e minerar variacoes semanticas para aprendizado.',
    'Nunca invente novos comandos, nomes de tools ou parametros de execucao.',
    'Retorne SOMENTE JSON valido no formato:',
    '{"alternative_phrases":[],"semantic_keywords":[],"intent_description":"","possible_intents":[],"confidence":0.0}',
    'alternative_phrases: frases curtas no idioma do usuario.',
    'semantic_keywords: termos importantes (sem comandos).',
    'possible_intents: intencoes curtas e genericas.',
    'confidence: numero de 0.0 a 1.0 para qualidade do aprendizado.',
  ].join(' ');

const generateLearningArtifacts = async (event) => {
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: AI_LEARNING_WORKER_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: buildWorkerSystemPrompt(),
      },
      {
        role: 'user',
        content: [
          `Command: ${event.tool_executed}`,
          `User question: "${event.user_question}"`,
          `Normalized question: "${event.normalized_question}"`,
          '',
          `Generate up to ${AI_LEARNING_WORKER_MAX_PATTERNS} alternative user phrases,`,
          `up to ${AI_LEARNING_WORKER_MAX_KEYWORDS} semantic keywords,`,
          'and a short intent description.',
        ].join('\n'),
      },
    ],
  });

  const message = completion?.choices?.[0]?.message || {};
  const rawJson = extractTextFromAssistantMessage(message);
  const parsed = parseJsonSafe(rawJson) || {};

  const rawPatterns = uniqueList(parsed?.alternative_phrases || []).slice(
    0,
    AI_LEARNING_WORKER_MAX_PATTERNS,
  );
  const rawKeywords = uniqueList(parsed?.semantic_keywords || []).slice(
    0,
    AI_LEARNING_WORKER_MAX_KEYWORDS,
  );

  const patterns = rawPatterns.map((value) => sanitizePattern(value)).filter(Boolean);
  const keywords = rawKeywords.map((value) => sanitizeKeyword(value)).filter(Boolean);
  const possibleIntents = uniqueList(parsed?.possible_intents || []).slice(0, 6);
  const intentDescription = sanitizePattern(parsed?.intent_description || '');
  const confidence = clamp01(parsed?.confidence);

  return {
    patterns,
    keywords,
    possibleIntents,
    intentDescription,
    confidence,
    rawJson: rawJson.slice(0, 2000),
  };
};

const processLearningBatch = async ({ reason = 'scheduler' } = {}) => {
  if (cycleInProgress) return;
  if (!isWorkerReady()) return;

  cycleInProgress = true;
  try {
    const startedAt = Date.now();
    logger.info('Worker de aprendizado IA iniciado.', {
      action: 'ai_learning_worker_started',
      reason,
      model: AI_LEARNING_WORKER_MODEL,
      batch_size: AI_LEARNING_WORKER_BATCH_SIZE,
    });

    let events = [];
    try {
      events = await listPendingLearningEvents({ limit: AI_LEARNING_WORKER_BATCH_SIZE });
    } catch (error) {
      logger.warn('Falha ao buscar eventos pendentes de aprendizado.', {
        action: 'ai_learning_batch_fetch_failed',
        error: error?.message,
      });
      return;
    }

    if (!events.length) {
      logger.info('Nenhum evento pendente para aprendizado IA.', {
        action: 'ai_learning_batch_processed',
        reason,
        fetched_events: 0,
        processed_events: 0,
        generated_patterns: 0,
        generated_keywords: 0,
        duration_ms: Date.now() - startedAt,
      });
      return;
    }

    const processedEventIds = [];
    let generatedPatterns = 0;
    let generatedKeywords = 0;
    let successfulEvents = 0;

    for (const event of events) {
      try {
        const artifacts = await generateLearningArtifacts(event);

        const patternRows = artifacts.patterns.map((pattern) => ({
          pattern,
          tool: event.tool_executed,
          confidence: artifacts.confidence || event.confidence || 0.5,
          sourceEventId: event.id,
        }));
        const keywordRows = artifacts.keywords.map((keyword) => ({
          keyword,
          tool: event.tool_executed,
          weight: artifacts.confidence || event.confidence || 0.7,
          sourceEventId: event.id,
        }));

        const insertedPatterns = await insertLearnedPatterns(patternRows);
        const insertedKeywords = await insertLearnedKeywords(keywordRows);

        generatedPatterns += insertedPatterns;
        generatedKeywords += insertedKeywords;
        successfulEvents += 1;
        processedEventIds.push(event.id);

        logger.info('Padroes de aprendizado IA gerados.', {
          action: 'ai_learning_patterns_generated',
          source_event_id: event.id,
          tool: event.tool_executed,
          generated_count: insertedPatterns,
          intent_description: artifacts.intentDescription || null,
          possible_intents: artifacts.possibleIntents,
        });
        logger.info('Keywords de aprendizado IA geradas.', {
          action: 'ai_learning_keywords_generated',
          source_event_id: event.id,
          tool: event.tool_executed,
          generated_count: insertedKeywords,
        });
      } catch (error) {
        logger.warn('Falha ao gerar aprendizado IA para evento.', {
          action: 'ai_learning_event_process_failed',
          source_event_id: event?.id || null,
          tool: event?.tool_executed || null,
          error: error?.message,
        });
      }
    }

    if (processedEventIds.length > 0) {
      await markLearningEventsProcessed(processedEventIds);
      markToolCandidateLearningCacheDirty();
    }

    logger.info('Batch de aprendizado IA processado.', {
      action: 'ai_learning_batch_processed',
      reason,
      fetched_events: events.length,
      processed_events: processedEventIds.length,
      successful_events: successfulEvents,
      generated_patterns: generatedPatterns,
      generated_keywords: generatedKeywords,
      duration_ms: Date.now() - startedAt,
    });
  } finally {
    cycleInProgress = false;
  }
};

export const startAiLearningWorker = () => {
  if (schedulerStarted) return;

  if (!isWorkerReady()) {
    logger.info('Worker de aprendizado IA desativado ou sem API key.', {
      action: 'ai_learning_worker_disabled',
      enabled: AI_LEARNING_WORKER_ENABLED,
    });
    return;
  }

  schedulerStarted = true;
  void processLearningBatch({ reason: 'startup' });

  schedulerHandle = setInterval(() => {
    void processLearningBatch({ reason: 'scheduler' });
  }, AI_LEARNING_WORKER_INTERVAL_MS);
  if (typeof schedulerHandle?.unref === 'function') {
    schedulerHandle.unref();
  }

  logger.info('Scheduler do worker de aprendizado IA iniciado.', {
    action: 'ai_learning_worker_scheduler_started',
    interval_ms: AI_LEARNING_WORKER_INTERVAL_MS,
    batch_size: AI_LEARNING_WORKER_BATCH_SIZE,
    model: AI_LEARNING_WORKER_MODEL,
  });
};

export const stopAiLearningWorker = () => {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  schedulerStarted = false;
};

export const runAiLearningWorkerOnce = async (reason = 'manual') => {
  await processLearningBatch({ reason });
};

export const getAiLearningWorkerConfig = () => ({
  enabled: AI_LEARNING_WORKER_ENABLED,
  intervalMs: AI_LEARNING_WORKER_INTERVAL_MS,
  batchSize: AI_LEARNING_WORKER_BATCH_SIZE,
  model: AI_LEARNING_WORKER_MODEL,
  timeoutMs: AI_LEARNING_WORKER_TIMEOUT_MS,
  maxPatternsPerEvent: AI_LEARNING_WORKER_MAX_PATTERNS,
  maxKeywordsPerEvent: AI_LEARNING_WORKER_MAX_KEYWORDS,
  hasApiKey: Boolean(process.env.OPENAI_API_KEY),
});
