import natural from 'natural';
import winkBm25TextSearch from 'wink-bm25-text-search';
import logger from '../../utils/logger/loggerModule.js';
import { getAllToolRecords, getToolRegistryStats } from './moduleToolRegistryService.js';

const DEFAULT_TOOL_SELECTION_MAX_CANDIDATES = 8;
const DEFAULT_TOOL_SELECTION_MIN_SCORE = 0.2;
const DEFAULT_TOOL_SELECTION_FALLBACK_POPULAR_LIMIT = 5;
const DEFAULT_TOOL_SELECTION_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TOOL_SELECTION_CACHE_MAX_ENTRIES = 800;
const MIN_BM25_DOCS = 3;

const BM25_WEIGHT = 0.55;
const OVERLAP_WEIGHT = 0.25;
const FUZZY_WEIGHT = 0.2;

const BM25_FIELD_WEIGHTS = {
  descricao: 3,
  capability_keywords: 2,
  faq_patterns: 2,
  user_phrasings: 3,
};

const tokenizer = new natural.WordTokenizer();
const queryCache = new Map();
const STOPWORDS = new Set([
  'a',
  'as',
  'o',
  'os',
  'ao',
  'aos',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'para',
  'por',
  'com',
  'sem',
  'e',
  'ou',
  'um',
  'uma',
  'uns',
  'umas',
  'que',
  'como',
  'me',
  'te',
  'se',
  'eu',
  'voce',
  'vc',
  'bot',
  'ajuda',
  'help',
]);

let cachedIndexSnapshot = null;
let cachedIndexSignature = '';

const parseEnvInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const parseEnvFloat = (value, fallback, min, max) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const TOOL_SELECTION_MAX_CANDIDATES = parseEnvInt(
  process.env.TOOL_SELECTION_MAX_CANDIDATES,
  DEFAULT_TOOL_SELECTION_MAX_CANDIDATES,
  1,
  32,
);
const TOOL_SELECTION_MIN_SCORE = parseEnvFloat(
  process.env.TOOL_SELECTION_MIN_SCORE,
  DEFAULT_TOOL_SELECTION_MIN_SCORE,
  0,
  1,
);
const TOOL_SELECTION_FALLBACK_POPULAR_LIMIT = parseEnvInt(
  process.env.TOOL_SELECTION_FALLBACK_POPULAR_LIMIT,
  DEFAULT_TOOL_SELECTION_FALLBACK_POPULAR_LIMIT,
  1,
  20,
);
const TOOL_SELECTION_CACHE_TTL_MS = parseEnvInt(
  process.env.TOOL_SELECTION_CACHE_TTL_MS,
  DEFAULT_TOOL_SELECTION_CACHE_TTL_MS,
  5_000,
  24 * 60 * 60 * 1000,
);
const TOOL_SELECTION_CACHE_MAX_ENTRIES = parseEnvInt(
  process.env.TOOL_SELECTION_CACHE_MAX_ENTRIES,
  DEFAULT_TOOL_SELECTION_CACHE_MAX_ENTRIES,
  50,
  10_000,
);

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s/_.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const unique = (items = []) =>
  Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));

const tokenizeText = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  try {
    const tokens = tokenizer.tokenize(normalized);
    if (Array.isArray(tokens) && tokens.length > 0) {
      return tokens
        .map((token) => normalizeText(token))
        .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
    }
  } catch {
    // Fallback simples quando tokenizacao da lib falha.
  }

  return normalized.split(/\s+/).filter((token) => token.length >= 2 && !STOPWORDS.has(token));
};

const roundScore = (value) => Number((Number(value) || 0).toFixed(4));

const computeTokenOverlapScore = (queryTokens = [], docTokenSet = new Set()) => {
  const normalizedTokens = unique(queryTokens);
  if (!normalizedTokens.length || !docTokenSet.size) return 0;

  let hits = 0;
  for (const token of normalizedTokens) {
    if (docTokenSet.has(token)) hits += 1;
  }

  return clamp01(hits / normalizedTokens.length);
};

const computeFuzzyScore = (queryText, phrases = []) => {
  const normalizedQuery = normalizeText(queryText);
  if (!normalizedQuery) return 0;

  let best = 0;
  for (const phrase of phrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) continue;
    const score = Number(natural.JaroWinklerDistance(normalizedQuery, normalizedPhrase)) || 0;
    if (score > best) best = score;
  }
  return clamp01(best);
};

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const resolveLearningSignals = (commandEntry = {}) => {
  const usageCount = Math.max(0, toSafeNumber(commandEntry.tool_usage_count, 0));
  const successRate = clamp01(toSafeNumber(commandEntry.tool_success_rate, 0.5));
  const suggestionPriority = clamp01(toSafeNumber(commandEntry.suggestion_priority, 0) / 100);
  return {
    usageCount,
    successRate,
    suggestionPriority,
  };
};

const computePopularityScore = (learningSignals = {}) => {
  const usageScore = clamp01(Math.log1p(Math.max(0, learningSignals.usageCount || 0)) / 8);
  const successScore = clamp01(learningSignals.successRate);
  const priorityScore = clamp01(learningSignals.suggestionPriority);
  return clamp01(usageScore * 0.5 + successScore * 0.35 + priorityScore * 0.15);
};

const buildDocumentFields = (record) => {
  const commandEntry = record?.commandEntry || {};
  const descricao = normalizeText(commandEntry?.descricao || '');
  const capabilityKeywords = unique(commandEntry?.capability_keywords || []).join(' ');
  const faqPatterns = unique(commandEntry?.faq_patterns || []).join(' ');
  const userPhrasings = unique(commandEntry?.user_phrasings || []).join(' ');

  const aliases = unique(record?.aliases || []);
  const commandTerms = unique([record?.commandName, ...aliases]).join(' ');
  const searchableText = normalizeText(
    [descricao, capabilityKeywords, faqPatterns, userPhrasings, commandTerms].join(' '),
  );
  const searchableTokens = new Set(tokenizeText(searchableText));
  const matchPhrases = unique([
    record?.commandName,
    ...aliases,
    commandEntry?.descricao,
    ...(Array.isArray(commandEntry?.user_phrasings) ? commandEntry.user_phrasings : []),
    ...(Array.isArray(commandEntry?.faq_patterns) ? commandEntry.faq_patterns : []),
  ]);

  return {
    descricao,
    capability_keywords: normalizeText(capabilityKeywords),
    faq_patterns: normalizeText(faqPatterns),
    user_phrasings: normalizeText(userPhrasings),
    searchableText,
    searchableTokens,
    matchPhrases,
  };
};

const ensureCacheSize = () => {
  if (queryCache.size <= TOOL_SELECTION_CACHE_MAX_ENTRIES) return;
  const overflow = queryCache.size - TOOL_SELECTION_CACHE_MAX_ENTRIES;
  const iterator = queryCache.keys();
  for (let i = 0; i < overflow; i += 1) {
    const next = iterator.next();
    if (next.done) break;
    queryCache.delete(next.value);
  }
};

const pruneCache = (nowMs = Date.now()) => {
  for (const [cacheKey, cacheEntry] of queryCache.entries()) {
    if (!cacheEntry || cacheEntry.expiresAt <= nowMs) {
      queryCache.delete(cacheKey);
    }
  }
};

const buildCacheKey = ({ message, limit, minScore, signature }) =>
  `${signature}|${limit}|${roundScore(minScore)}|${normalizeText(message)}`;

const extractBm25Scores = (bm25Engine, queryText) => {
  const rawResults = bm25Engine?.search?.(queryText);
  const results = Array.isArray(rawResults) ? rawResults : [];
  if (!results.length) return new Map();

  let maxScore = 0;
  for (const [, score] of results) {
    const numeric = Math.max(0, toSafeNumber(score, 0));
    if (numeric > maxScore) maxScore = numeric;
  }
  if (!maxScore) return new Map();

  const normalizedScores = new Map();
  for (const [toolName, score] of results) {
    const normalized = clamp01(toSafeNumber(score, 0) / maxScore);
    normalizedScores.set(
      String(toolName || '')
        .trim()
        .toLowerCase(),
      normalized,
    );
  }
  return normalizedScores;
};

const buildOrGetIndexSnapshot = () => {
  const registryStats = getToolRegistryStats();
  const signature = String(registryStats?.signature || '');

  if (cachedIndexSnapshot && cachedIndexSignature === signature) {
    return cachedIndexSnapshot;
  }

  const records = getAllToolRecords();
  const bm25Engine = winkBm25TextSearch();
  bm25Engine.defineConfig({
    fldWeights: BM25_FIELD_WEIGHTS,
    bm25Params: { k1: 1.2, b: 0.75 },
    ovFldNames: ['descricao', 'capability_keywords', 'faq_patterns', 'user_phrasings'],
  });
  bm25Engine.definePrepTasks([tokenizeText]);

  const entries = [];
  for (const record of records) {
    const fields = buildDocumentFields(record);
    const learningSignals = resolveLearningSignals(record.commandEntry || {});
    const popularityScore = computePopularityScore(learningSignals);
    entries.push({
      ...record,
      ...fields,
      learningSignals,
      popularityScore,
    });
    bm25Engine.addDoc(
      {
        descricao: fields.descricao,
        capability_keywords: fields.capability_keywords,
        faq_patterns: fields.faq_patterns,
        user_phrasings: fields.user_phrasings,
      },
      record.toolName,
    );
  }

  let bm25Ready = false;
  if (entries.length >= MIN_BM25_DOCS) {
    try {
      bm25Engine.consolidate();
      bm25Ready = true;
    } catch (error) {
      logger.warn('Falha ao consolidar indice BM25 de tools. Fallback lexical sera usado.', {
        action: 'tool_candidate_index_bm25_consolidate_failed',
        error: error?.message,
        tool_count: entries.length,
      });
    }
  }

  const popularEntries = [...entries].sort((left, right) => {
    if (right.popularityScore !== left.popularityScore) {
      return right.popularityScore - left.popularityScore;
    }
    return left.toolName.localeCompare(right.toolName);
  });

  cachedIndexSnapshot = {
    signature,
    builtAt: new Date().toISOString(),
    bm25Ready,
    bm25Engine,
    entries,
    popularEntries,
  };
  cachedIndexSignature = signature;
  pruneCache();

  logger.info('Indice de selecao dinamica de tools atualizado.', {
    action: 'tool_candidate_index_ready',
    tool_count: entries.length,
    bm25_ready: bm25Ready,
    registry_signature: signature || null,
  });

  return cachedIndexSnapshot;
};

const buildSelectionFromEntries = ({
  rankedEntries = [],
  fallbackUsed = false,
  selectionTimeMs = 0,
  cacheHit = false,
  limit = TOOL_SELECTION_MAX_CANDIDATES,
}) => {
  const limited = rankedEntries.slice(0, Math.max(1, limit));
  return {
    tools: limited.map((entry) => entry.tool),
    fallbackUsed,
    cacheHit,
    selectionTimeMs,
    selectedCount: limited.length,
    candidateTools: limited.map((entry) => ({
      toolName: entry.toolName,
      commandName: entry.commandName,
      moduleKey: entry.moduleKey,
      score: roundScore(entry.finalScore),
      bm25Score: roundScore(entry.bm25Score),
      overlapScore: roundScore(entry.overlapScore),
      fuzzyScore: roundScore(entry.fuzzyScore),
      popularityScore: roundScore(entry.popularityScore),
      usageCount: Number(entry.learningSignals?.usageCount || 0),
      successRate: roundScore(entry.learningSignals?.successRate),
    })),
  };
};

export const selectCandidateTools = (userMessage, limit = TOOL_SELECTION_MAX_CANDIDATES) => {
  const startNs = process.hrtime.bigint();
  const safeLimit = Math.max(1, Math.min(32, Number(limit) || TOOL_SELECTION_MAX_CANDIDATES));
  const minScore = TOOL_SELECTION_MIN_SCORE;
  const snapshot = buildOrGetIndexSnapshot();

  if (!snapshot.entries.length) {
    return {
      tools: [],
      fallbackUsed: false,
      cacheHit: false,
      selectionTimeMs: 0,
      selectedCount: 0,
      candidateTools: [],
    };
  }

  const normalizedMessage = normalizeText(userMessage);
  const nowMs = Date.now();
  pruneCache(nowMs);
  const cacheKey = buildCacheKey({
    message: normalizedMessage,
    limit: safeLimit,
    minScore,
    signature: snapshot.signature,
  });

  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    const cacheResult = {
      ...cached.result,
      cacheHit: true,
    };
    logger.info('Selecao dinamica de tools em cache.', {
      action: 'tool_candidate_selection',
      selection_time_ms: cacheResult.selectionTimeMs,
      candidate_tools: cacheResult.candidateTools,
      fallback_used: cacheResult.fallbackUsed,
      cache_hit: true,
      limit: safeLimit,
      min_score: minScore,
    });
    return cacheResult;
  }

  const queryTokens = tokenizeText(normalizedMessage);
  const bm25Scores =
    snapshot.bm25Ready && normalizedMessage
      ? extractBm25Scores(snapshot.bm25Engine, normalizedMessage)
      : new Map();

  const ranked = snapshot.entries
    .map((entry) => {
      const bm25Score = bm25Scores.get(entry.toolName) || 0;
      const overlapScore = computeTokenOverlapScore(queryTokens, entry.searchableTokens);
      const fuzzyScore = computeFuzzyScore(normalizedMessage, entry.matchPhrases);
      const finalScore = clamp01(
        bm25Score * BM25_WEIGHT + overlapScore * OVERLAP_WEIGHT + fuzzyScore * FUZZY_WEIGHT,
      );
      return {
        ...entry,
        bm25Score,
        overlapScore,
        fuzzyScore,
        finalScore,
      };
    })
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) return right.finalScore - left.finalScore;
      if (right.popularityScore !== left.popularityScore) {
        return right.popularityScore - left.popularityScore;
      }
      return left.toolName.localeCompare(right.toolName);
    });

  const aboveThreshold = ranked.filter((entry) => entry.finalScore >= minScore);
  const fallbackUsed = aboveThreshold.length === 0;
  const selectedEntries = fallbackUsed
    ? snapshot.popularEntries
        .slice(0, Math.min(safeLimit, TOOL_SELECTION_FALLBACK_POPULAR_LIMIT))
        .map((entry) => ({
          ...entry,
          bm25Score: 0,
          overlapScore: 0,
          fuzzyScore: 0,
          finalScore: entry.popularityScore,
        }))
    : aboveThreshold.slice(0, safeLimit);

  const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  const selection = buildSelectionFromEntries({
    rankedEntries: selectedEntries,
    fallbackUsed,
    selectionTimeMs: Number(elapsedMs.toFixed(3)),
    cacheHit: false,
    limit: safeLimit,
  });

  queryCache.set(cacheKey, {
    expiresAt: nowMs + TOOL_SELECTION_CACHE_TTL_MS,
    result: selection,
  });
  ensureCacheSize();

  logger.info('Selecao dinamica de tools concluida.', {
    action: 'tool_candidate_selection',
    selection_time_ms: selection.selectionTimeMs,
    candidate_tools: selection.candidateTools,
    selected_count: selection.selectedCount,
    fallback_used: selection.fallbackUsed,
    cache_hit: false,
    limit: safeLimit,
    min_score: minScore,
  });

  return selection;
};

export const getCandidateTools = (userMessage, limit = TOOL_SELECTION_MAX_CANDIDATES) =>
  selectCandidateTools(userMessage, limit).tools;

export const getToolCandidateSelectorConfig = () => ({
  maxCandidates: TOOL_SELECTION_MAX_CANDIDATES,
  minScore: TOOL_SELECTION_MIN_SCORE,
  fallbackPopularLimit: TOOL_SELECTION_FALLBACK_POPULAR_LIMIT,
  cacheTtlMs: TOOL_SELECTION_CACHE_TTL_MS,
  cacheMaxEntries: TOOL_SELECTION_CACHE_MAX_ENTRIES,
  scoreWeights: {
    bm25: BM25_WEIGHT,
    overlap: OVERLAP_WEIGHT,
    fuzzy: FUZZY_WEIGHT,
  },
});

export const warmupToolCandidateSelector = () => {
  buildOrGetIndexSnapshot();
};

export const resetToolCandidateSelectorCacheForTests = () => {
  queryCache.clear();
  cachedIndexSnapshot = null;
  cachedIndexSignature = '';
};
