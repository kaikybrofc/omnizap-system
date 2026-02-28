import logger from '../../utils/logger/loggerModule.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, Number(value)));

const RECLASSIFICATION_ENABLED = parseEnvBool(process.env.STICKER_SEMANTIC_RECLASSIFICATION_ENABLED, true);
const RECLASSIFICATION_BATCH_SIZE = Math.max(50, Math.min(2000, Number(process.env.STICKER_SEMANTIC_RECLASSIFICATION_BATCH_SIZE) || 400));
const RECLASSIFICATION_MAX_PER_CYCLE = Math.max(100, Math.min(20_000, Number(process.env.STICKER_SEMANTIC_RECLASSIFICATION_MAX_PER_CYCLE) || 2000));
const RECLASSIFICATION_ENTROPY_THRESHOLD = Number.isFinite(Number(process.env.STICKER_SEMANTIC_RECLASSIFICATION_ENTROPY_THRESHOLD)) ? Number(process.env.STICKER_SEMANTIC_RECLASSIFICATION_ENTROPY_THRESHOLD) : 0.8;
const RECLASSIFICATION_AFFINITY_THRESHOLD = Number.isFinite(Number(process.env.STICKER_SEMANTIC_RECLASSIFICATION_AFFINITY_THRESHOLD)) ? Number(process.env.STICKER_SEMANTIC_RECLASSIFICATION_AFFINITY_THRESHOLD) : 0.3;

const STOPWORDS = ['image', 'sticker', 'wallpaper', 'social_media', 'internet', 'picture'];
const GENERIC_TERMS = ['cool', 'nice', 'funny', 'random', 'art'];
const SEMANTIC_GROUPS = ['anime', 'meme', 'kawaii', 'horror', 'reaction'];
const OPPOSITE_THEME_PAIRS = [['kawaii', 'horror']];

const DICTIONARY_MAP = {
  'cute anime girl': 'kawaii_anime_girl',
  'funny reaction': 'exaggerated_reaction',
  'meme image': 'meme_reaction',
  'anime emotion': 'anime_expression',
  'chat expression': 'chat_reaction',
};

const toSnakeCase = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

const STOPWORD_PHRASES = new Set(STOPWORDS.map((value) => toSnakeCase(value)).filter(Boolean));
const STOPWORD_WORDS = new Set(
  STOPWORDS.map((value) => toSnakeCase(value))
    .flatMap((value) => value.split('_'))
    .filter((value) => value.length >= 3),
);
const GENERIC_TERM_SET = new Set(GENERIC_TERMS.map((value) => toSnakeCase(value)).filter(Boolean));
const GENERIC_TERM_WORDS = new Set(
  GENERIC_TERMS.map((value) => toSnakeCase(value))
    .flatMap((value) => value.split('_'))
    .filter((value) => value.length >= 3),
);

const normalizeTokenValue = (value) => {
  const slug = toSnakeCase(value);
  if (!slug || slug.length < 3) return '';
  if (STOPWORD_PHRASES.has(slug) || GENERIC_TERM_SET.has(slug)) return '';

  const words = slug
    .split('_')
    .filter(Boolean)
    .filter((word) => word.length >= 3)
    .filter((word) => !STOPWORD_WORDS.has(word))
    .filter((word) => !GENERIC_TERM_WORDS.has(word));
  if (!words.length) return '';

  const token = words.join('_');
  if (!token || token.length < 3) return '';
  if (STOPWORD_PHRASES.has(token) || GENERIC_TERM_SET.has(token)) return '';
  return token;
};

const DICTIONARY_ENTRIES = Object.entries(DICTIONARY_MAP)
  .map(([rawSource, rawTarget]) => ({
    source: normalizeTokenValue(rawSource),
    target: normalizeTokenValue(rawTarget),
  }))
  .filter((entry) => entry.source && entry.target)
  .sort((left, right) => right.source.length - left.source.length);

const extractTopLabelTokens = (topLabels) => {
  if (!Array.isArray(topLabels)) return [];
  return topLabels
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry;
      if (typeof entry?.label === 'string') return entry.label;
      return '';
    })
    .filter(Boolean);
};

const registerToken = (tokenMap, token) => {
  if (!token) return;
  const current = tokenMap.get(token) || 0;
  tokenMap.set(token, current + 1);
};

const mapEntriesToSortedArray = (tokenMap) =>
  Array.from(tokenMap.entries())
    .map(([token, weight]) => ({
      token,
      weight: Number(weight || 0),
    }))
    .filter((entry) => entry.token && entry.weight > 0)
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return left.token.localeCompare(right.token);
    });

export const normalizeTokens = (classification = {}) => {
  const tokenMap = new Map();
  const pushToken = (rawValue) => {
    const normalized = normalizeTokenValue(rawValue);
    if (!normalized) return;
    registerToken(tokenMap, normalized);
  };

  for (const label of extractTopLabelTokens(classification?.top_labels)) {
    pushToken(label);
  }
  for (const value of Array.isArray(classification?.llm_subtags) ? classification.llm_subtags : []) {
    pushToken(value);
  }
  for (const value of Array.isArray(classification?.llm_style_traits) ? classification.llm_style_traits : []) {
    pushToken(value);
  }
  for (const value of Array.isArray(classification?.llm_emotions) ? classification.llm_emotions : []) {
    pushToken(value);
  }
  for (const value of Array.isArray(classification?.llm_pack_suggestions) ? classification.llm_pack_suggestions : []) {
    pushToken(value);
  }

  return mapEntriesToSortedArray(tokenMap);
};

const resolveDictionaryToken = (token) => {
  const normalizedToken = normalizeTokenValue(token);
  if (!normalizedToken) return '';

  for (const entry of DICTIONARY_ENTRIES) {
    if (normalizedToken === entry.source) return entry.target;
    if (normalizedToken.includes(entry.source)) return entry.target;
    if (entry.source.includes(normalizedToken)) return entry.target;
  }

  return normalizedToken;
};

export const applyDictionaryMapping = (tokens = []) => {
  const mapped = new Map();

  for (const entry of Array.isArray(tokens) ? tokens : []) {
    const mappedToken = resolveDictionaryToken(entry?.token || entry);
    if (!mappedToken) continue;
    const weight = Math.max(1, Number(entry?.weight || 1));
    const current = mapped.get(mappedToken) || 0;
    mapped.set(mappedToken, current + weight);
  }

  return mapEntriesToSortedArray(mapped);
};

const resolveSemanticGroup = (token) => {
  const normalized = normalizeTokenValue(token);
  if (!normalized) return 'other';

  for (const group of SEMANTIC_GROUPS) {
    if (normalized === group || normalized.startsWith(`${group}_`)) {
      return group;
    }
  }

  if (/_reaction$/.test(normalized) || /_expression$/.test(normalized)) return 'reaction';
  if (/_anime($|_)/.test(normalized)) return 'anime';
  if (/_meme($|_)/.test(normalized)) return 'meme';
  if (/_kawaii($|_)/.test(normalized)) return 'kawaii';
  if (/_horror($|_)/.test(normalized)) return 'horror';

  return 'other';
};

export const detectDominantTheme = (tokens = []) => {
  const themeWeights = new Map();
  let totalWeight = 0;

  for (const entry of Array.isArray(tokens) ? tokens : []) {
    const token = normalizeTokenValue(entry?.token || entry);
    if (!token) continue;
    const weight = Math.max(1, Number(entry?.weight || 1));
    const group = resolveSemanticGroup(token);
    themeWeights.set(group, (themeWeights.get(group) || 0) + weight);
    totalWeight += weight;
  }

  const sortedThemes = Array.from(themeWeights.entries())
    .map(([theme, weight]) => ({ theme, weight: Number(weight || 0) }))
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return left.theme.localeCompare(right.theme);
    });

  const dominantTheme = sortedThemes[0]?.theme || '';
  const dominantWeight = Number(sortedThemes[0]?.weight || 0);

  return {
    dominant_theme: dominantTheme,
    dominant_weight: dominantWeight,
    total_weight: Number(totalWeight || 0),
    ranked_themes: sortedThemes,
    theme_weights_map: themeWeights,
  };
};

export const calculateCohesion = ({ dominantWeight = 0, totalWeight = 0 } = {}) => {
  const dominant = Math.max(0, Number(dominantWeight || 0));
  const total = Math.max(0, Number(totalWeight || 0));
  if (!total || !dominant) return 0;
  return Number(((dominant / total) * 100).toFixed(6));
};

export const detectConflict = ({ themeWeights = new Map(), totalWeight = 0 } = {}) => {
  const total = Math.max(0, Number(totalWeight || 0));
  const ranked = Array.from(themeWeights.entries())
    .map(([theme, weight]) => ({ theme, weight: Number(weight || 0) }))
    .filter((entry) => entry.weight > 0)
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return left.theme.localeCompare(right.theme);
    });

  let ambiguous = 0;
  let penaltyPoints = 0;

  if (ranked.length > 1 && total > 0) {
    const firstPercent = (ranked[0].weight / total) * 100;
    const secondPercent = (ranked[1].weight / total) * 100;
    if (Math.abs(firstPercent - secondPercent) < 15) {
      ambiguous = 1;
    }
  }

  const weightByTheme = new Map(ranked.map((entry) => [entry.theme, entry.weight]));
  for (const [leftTheme, rightTheme] of OPPOSITE_THEME_PAIRS) {
    const leftWeight = Number(weightByTheme.get(leftTheme) || 0);
    const rightWeight = Number(weightByTheme.get(rightTheme) || 0);
    if (leftWeight > 0 && rightWeight > 0) {
      penaltyPoints += 20;
      ambiguous = 1;
    }
  }

  return {
    ambiguous,
    penalty_points: penaltyPoints,
  };
};

const normalizeExistingSubtags = (values = []) => {
  const ordered = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const token = normalizeTokenValue(value);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    ordered.push(token);
  }
  return ordered;
};

const areListsEqual = (left = [], right = []) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const hasNumericDifference = (left, right, epsilon = 0.000001) => {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) > epsilon;
};

let cachedRepositoryModulePromise = null;
const resolveRepositoryModule = async () => {
  if (cachedRepositoryModulePromise) return cachedRepositoryModulePromise;
  cachedRepositoryModulePromise = import('./stickerAssetClassificationRepository.js');
  return cachedRepositoryModulePromise;
};

export const reclassify = (classification = {}) => {
  const normalizedTokens = normalizeTokens(classification);
  const mappedTokens = applyDictionaryMapping(normalizedTokens);
  const dominant = detectDominantTheme(mappedTokens);

  const rawCohesion = calculateCohesion({
    dominantWeight: dominant.dominant_weight,
    totalWeight: dominant.total_weight,
  });
  const conflict = detectConflict({
    themeWeights: dominant.theme_weights_map,
    totalWeight: dominant.total_weight,
  });
  const cohesionScore = Number(clampNumber(rawCohesion - Number(conflict.penalty_points || 0), 0, 100).toFixed(6));
  const dominantTheme = dominant.dominant_theme || 'other';

  let dominantTokens = mappedTokens.filter((entry) => resolveSemanticGroup(entry.token) === dominantTheme);
  if (!dominantTokens.length) {
    dominantTokens = mappedTokens.slice();
  }

  const normalizedSubtags = dominantTokens.map((entry) => normalizeTokenValue(entry.token)).filter(Boolean);

  const outputSubtags = Array.from(new Set(normalizedSubtags));
  const updatedAffinityWeight = Number(clampNumber(cohesionScore / 100, 0, 1).toFixed(6));

  return {
    normalized_subtags: outputSubtags,
    dominant_theme: dominantTheme,
    cohesion_score: cohesionScore,
    ambiguous: conflict.ambiguous ? 1 : 0,
    updated_affinity_weight: updatedAffinityWeight,
  };
};

export const batchReprocess = async ({ maxItems = RECLASSIFICATION_MAX_PER_CYCLE, batchSize = RECLASSIFICATION_BATCH_SIZE, entropyThreshold = RECLASSIFICATION_ENTROPY_THRESHOLD, affinityThreshold = RECLASSIFICATION_AFFINITY_THRESHOLD } = {}) => {
  const safeMaxItems = Math.max(0, Math.min(50_000, Number(maxItems) || RECLASSIFICATION_MAX_PER_CYCLE));
  const safeBatchSize = Math.max(1, Math.min(2000, Number(batchSize) || RECLASSIFICATION_BATCH_SIZE));

  const stats = {
    enabled: RECLASSIFICATION_ENABLED,
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    batches: 0,
    last_cursor: null,
    entropy_threshold: Number(entropyThreshold),
    affinity_threshold: Number(affinityThreshold),
  };

  if (!RECLASSIFICATION_ENABLED || safeMaxItems <= 0) {
    return stats;
  }

  const repositoryModule = await resolveRepositoryModule();
  const listForReprocess = repositoryModule.listStickerClassificationsForDeterministicReprocess;
  const updateSignals = repositoryModule.updateStickerClassificationDeterministicSignals;

  let cursorAssetId = '';
  while (stats.processed < safeMaxItems) {
    const remaining = safeMaxItems - stats.processed;
    const pageLimit = Math.max(1, Math.min(safeBatchSize, remaining));
    const rows = await listForReprocess({
      limit: pageLimit,
      cursorAssetId,
      entropyThreshold,
      affinityThreshold,
    });

    if (!rows.length) break;
    stats.batches += 1;

    for (const row of rows) {
      const assetId = String(row?.asset_id || '').trim();
      if (!assetId) continue;
      cursorAssetId = assetId;
      stats.last_cursor = assetId;
      stats.processed += 1;

      try {
        const output = reclassify(row);
        const currentSubtags = normalizeExistingSubtags(row?.llm_subtags || []);
        const nextSubtags = normalizeExistingSubtags(output.normalized_subtags || []);
        const currentAffinity = row?.affinity_weight;
        const nextAffinity = output.updated_affinity_weight;
        const currentAmbiguous = row?.ambiguous ? 1 : 0;
        const nextAmbiguous = output.ambiguous ? 1 : 0;

        const shouldUpdate = currentAmbiguous !== nextAmbiguous || hasNumericDifference(currentAffinity, nextAffinity) || !areListsEqual(currentSubtags, nextSubtags);

        if (!shouldUpdate) {
          stats.skipped += 1;
          continue;
        }

        await updateSignals(assetId, {
          llmSubtags: nextSubtags,
          affinityWeight: nextAffinity,
          ambiguous: nextAmbiguous,
        });
        stats.updated += 1;
      } catch (error) {
        stats.failed += 1;
        logger.warn('Falha na reclassificação semântica determinística.', {
          action: 'sticker_semantic_reclassification_failed',
          asset_id: assetId,
          error: error?.message,
        });
      }

      if (stats.processed >= safeMaxItems) break;
    }

    if (rows.length < pageLimit) break;
  }

  return stats;
};

export const deterministicReclassificationConfig = {
  enabled: RECLASSIFICATION_ENABLED,
  batch_size: RECLASSIFICATION_BATCH_SIZE,
  max_per_cycle: RECLASSIFICATION_MAX_PER_CYCLE,
  entropy_threshold: RECLASSIFICATION_ENTROPY_THRESHOLD,
  affinity_threshold: RECLASSIFICATION_AFFINITY_THRESHOLD,
};

export const __testablesSemanticReclassificationEngine = {
  toSnakeCase,
  normalizeTokenValue,
  resolveSemanticGroup,
};
