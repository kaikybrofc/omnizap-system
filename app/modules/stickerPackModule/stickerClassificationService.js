import logger from '../../utils/logger/loggerModule.js';
import {
  findStickerClassificationByAssetId,
  listStickerClassificationsByAssetIds,
  upsertStickerAssetClassification,
} from './stickerAssetClassificationRepository.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const CLIP_CLASSIFIER_ENABLED = parseEnvBool(process.env.CLIP_CLASSIFIER_ENABLED, true);
const CLIP_CLASSIFIER_API_URL =
  String(process.env.CLIP_CLASSIFIER_API_URL || 'http://127.0.0.1:8008/classify').trim() ||
  'http://127.0.0.1:8008/classify';
const CLIP_CLASSIFIER_TIMEOUT_MS = Math.max(500, Number(process.env.CLIP_CLASSIFIER_TIMEOUT_MS) || 3000);
const CLIP_CLASSIFIER_PROVIDER = String(process.env.CLIP_CLASSIFIER_PROVIDER || 'clip').trim() || 'clip';
const CLIP_CLASSIFIER_CLASSIFICATION_VERSION =
  String(process.env.CLIP_CLASSIFIER_CLASSIFICATION_VERSION || process.env.CLIP_CLASSIFIER_MODEL_VERSION || 'v1').trim() || 'v1';
const CLIP_CLASSIFIER_NSFW_THRESHOLD = Number.isFinite(Number(process.env.CLIP_CLASSIFIER_NSFW_THRESHOLD))
  ? Number(process.env.CLIP_CLASSIFIER_NSFW_THRESHOLD)
  : null;
const STICKER_TAG_MIN_SCORE = Number.isFinite(Number(process.env.STICKER_CLASSIFICATION_TAG_MIN_SCORE))
  ? Number(process.env.STICKER_CLASSIFICATION_TAG_MIN_SCORE)
  : 0.2;
const PACK_TAG_MIN_SCORE = Number.isFinite(Number(process.env.PACK_CLASSIFICATION_TAG_MIN_SCORE))
  ? Number(process.env.PACK_CLASSIFICATION_TAG_MIN_SCORE)
  : 0.18;
const MAX_TAGS_PER_ENTITY = Math.max(1, Math.min(10, Number(process.env.CLASSIFICATION_MAX_TAGS) || 6));

const LABEL_TO_TAG = {
  'anime illustration': 'anime',
  'video game screenshot': 'game',
  'real life photo': 'foto-real',
  'nsfw content': 'nsfw',
  cartoon: 'cartoon',
};

const normalizeTag = (value) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
};

const mapLabelToTag = (label) => {
  const key = String(label || '').trim().toLowerCase();
  return LABEL_TO_TAG[key] || normalizeTag(key);
};

const normalizeScores = (scores) => {
  const entries = Object.entries(scores || {}).filter(([, value]) => Number.isFinite(Number(value)));
  entries.sort((left, right) => Number(right[1]) - Number(left[1]));

  const normalized = {};
  for (const [label, value] of entries) {
    normalized[String(label)] = Number(Number(value).toFixed(6));
  }
  return normalized;
};

const normalizeClassificationResult = (payload) => {
  const allScores = normalizeScores(payload?.all_scores || {});
  const explicitCategory = String(payload?.category || '').trim();
  const scoreEntries = Object.entries(allScores);
  const topFromScores = scoreEntries[0] || null;
  const category = explicitCategory || topFromScores?.[0] || null;
  const confidence = Number.isFinite(Number(payload?.confidence))
    ? Number(Number(payload.confidence).toFixed(6))
    : topFromScores
      ? Number(Number(topFromScores[1]).toFixed(6))
      : null;
  const nsfwScore = Number.isFinite(Number(payload?.nsfw_score)) ? Number(Number(payload.nsfw_score).toFixed(6)) : null;

  return {
    category,
    confidence,
    all_scores: allScores,
    nsfw_score: nsfwScore,
    is_nsfw: payload?.is_nsfw === true || payload?.is_nsfw === 1,
    model_name: payload?.model || payload?.model_name || null,
  };
};

export const buildStickerTags = (classification) => {
  if (!classification || typeof classification !== 'object') return [];

  const tags = [];
  const pushTag = (tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    if (!tags.includes(normalized)) tags.push(normalized);
  };

  if (classification.is_nsfw) {
    pushTag('nsfw');
  }

  if (classification.category) {
    pushTag(mapLabelToTag(classification.category));
  }

  const orderedScores = Object.entries(classification.all_scores || {})
    .filter(([, value]) => Number(value) >= STICKER_TAG_MIN_SCORE)
    .sort((left, right) => Number(right[1]) - Number(left[1]));

  for (const [label] of orderedScores) {
    pushTag(mapLabelToTag(label));
    if (tags.length >= MAX_TAGS_PER_ENTITY) break;
  }

  return tags.slice(0, MAX_TAGS_PER_ENTITY);
};

export const decorateStickerClassification = (classification) => {
  if (!classification || typeof classification !== 'object') return classification || null;
  return {
    ...classification,
    tags: buildStickerTags(classification),
  };
};

const classifyBufferViaHttp = async (buffer, filename = 'sticker.webp') => {
  if (!CLIP_CLASSIFIER_ENABLED) return null;
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;

  if (typeof globalThis.fetch !== 'function' || typeof globalThis.FormData !== 'function') {
    throw new Error('fetch/FormData indisponivel neste runtime Node.');
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'image/webp' }), filename);
  if (CLIP_CLASSIFIER_NSFW_THRESHOLD !== null) {
    form.append('nsfw_threshold', String(CLIP_CLASSIFIER_NSFW_THRESHOLD));
  }

  const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), CLIP_CLASSIFIER_TIMEOUT_MS);

  try {
    const response = await globalThis.fetch(CLIP_CLASSIFIER_API_URL, {
      method: 'POST',
      body: form,
      signal: controller?.signal,
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(`Classifier HTTP ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ''}`);
    }

    const json = await response.json();
    return normalizeClassificationResult(json);
  } finally {
    clearTimeout(timeout);
  }
};

export async function classifyStickerAssetBuffer(buffer, filename = 'sticker.webp') {
  return classifyBufferViaHttp(buffer, filename);
}

export async function ensureStickerAssetClassified({ asset, buffer, force = false }) {
  if (!CLIP_CLASSIFIER_ENABLED) return null;
  if (!asset?.id || !Buffer.isBuffer(buffer) || !buffer.length) return null;

  if (!force) {
    const cached = await findStickerClassificationByAssetId(asset.id);
    if (cached) return cached;
  }

  const inference = await classifyBufferViaHttp(buffer, `${asset.id}.webp`);
  if (!inference) return null;

  return upsertStickerAssetClassification({
    asset_id: asset.id,
    provider: CLIP_CLASSIFIER_PROVIDER,
    model_name: inference.model_name,
    classification_version: CLIP_CLASSIFIER_CLASSIFICATION_VERSION,
    category: inference.category,
    confidence: inference.confidence,
    nsfw_score: inference.nsfw_score,
    is_nsfw: inference.is_nsfw,
    all_scores: inference.all_scores,
  });
}

const emptyAggregation = (totalItems = 0) => ({
  total_items: totalItems,
  classified_items: 0,
  category: null,
  confidence: null,
  majority_category: null,
  majority_ratio: null,
  average_scores: {},
  categories: [],
  nsfw: {
    avg_score: null,
    max_score: null,
    flagged_items: 0,
  },
});

const aggregateClassifications = (entries = [], totalItems = 0) => {
  if (!entries.length) return emptyAggregation(totalItems);

  const scoreSums = new Map();
  const categoryVotes = new Map();
  let nsfwSum = 0;
  let nsfwCount = 0;
  let nsfwMax = null;
  let nsfwFlagged = 0;

  for (const entry of entries) {
    const category = String(entry?.category || '').trim();
    if (category) {
      categoryVotes.set(category, (categoryVotes.get(category) || 0) + 1);
    }

    for (const [label, value] of Object.entries(entry?.all_scores || {})) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) continue;
      scoreSums.set(label, (scoreSums.get(label) || 0) + numericValue);
    }

    if (Number.isFinite(Number(entry?.nsfw_score))) {
      const score = Number(entry.nsfw_score);
      nsfwSum += score;
      nsfwCount += 1;
      nsfwMax = nsfwMax === null ? score : Math.max(nsfwMax, score);
    }

    if (entry?.is_nsfw) nsfwFlagged += 1;
  }

  const classifiedItems = entries.length;
  const averageScores = {};
  const scoreRank = [];

  for (const [label, total] of scoreSums.entries()) {
    const avg = total / classifiedItems;
    const rounded = Number(avg.toFixed(6));
    averageScores[label] = rounded;
    scoreRank.push([label, rounded]);
  }

  scoreRank.sort((left, right) => right[1] - left[1]);

  const categoryRank = Array.from(categoryVotes.entries())
    .map(([label, count]) => ({
      label,
      count,
      ratio: Number((count / classifiedItems).toFixed(6)),
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const majority = categoryRank[0] || null;
  const topAverage = scoreRank[0] || null;

  return {
    total_items: totalItems,
    classified_items: classifiedItems,
    category: topAverage?.[0] || majority?.label || null,
    confidence: topAverage ? Number(topAverage[1].toFixed(6)) : majority ? Number(majority.ratio.toFixed(6)) : null,
    majority_category: majority?.label || null,
    majority_ratio: majority ? Number(majority.ratio.toFixed(6)) : null,
    average_scores: averageScores,
    categories: categoryRank,
    nsfw: {
      avg_score: nsfwCount > 0 ? Number((nsfwSum / nsfwCount).toFixed(6)) : null,
      max_score: nsfwMax !== null ? Number(nsfwMax.toFixed(6)) : null,
      flagged_items: nsfwFlagged,
    },
  };
};

export const buildPackTags = (aggregation) => {
  if (!aggregation || typeof aggregation !== 'object') return [];

  const tags = [];
  const pushTag = (tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    if (!tags.includes(normalized)) tags.push(normalized);
  };

  if (Number(aggregation?.nsfw?.flagged_items || 0) > 0) {
    pushTag('nsfw');
  }

  if (aggregation.majority_category) {
    pushTag(mapLabelToTag(aggregation.majority_category));
  }

  const orderedAverageScores = Object.entries(aggregation.average_scores || {})
    .filter(([, value]) => Number(value) >= PACK_TAG_MIN_SCORE)
    .sort((left, right) => Number(right[1]) - Number(left[1]));

  for (const [label] of orderedAverageScores) {
    pushTag(mapLabelToTag(label));
    if (tags.length >= MAX_TAGS_PER_ENTITY) break;
  }

  return tags.slice(0, MAX_TAGS_PER_ENTITY);
};

export const decoratePackClassificationSummary = (aggregation) => {
  if (!aggregation || typeof aggregation !== 'object') return aggregation || null;
  return {
    ...aggregation,
    tags: buildPackTags(aggregation),
  };
};

export async function getPackClassificationSummaryByAssetIds(assetIds) {
  const normalizedIds = Array.from(new Set((Array.isArray(assetIds) ? assetIds : []).filter(Boolean)));
  if (!normalizedIds.length) return emptyAggregation(0);

  const classifications = await listStickerClassificationsByAssetIds(normalizedIds);
  return decoratePackClassificationSummary(aggregateClassifications(classifications, normalizedIds.length));
}

export const classifierConfig = {
  enabled: CLIP_CLASSIFIER_ENABLED,
  api_url: CLIP_CLASSIFIER_API_URL,
  timeout_ms: CLIP_CLASSIFIER_TIMEOUT_MS,
  nsfw_threshold: CLIP_CLASSIFIER_NSFW_THRESHOLD,
  classification_version: CLIP_CLASSIFIER_CLASSIFICATION_VERSION,
};

export const classifyStickerAssetBufferSafe = async (buffer, filename) => {
  try {
    return await classifyStickerAssetBuffer(buffer, filename);
  } catch (error) {
    logger.warn('Falha ao classificar figurinha via CLIP.', {
      action: 'sticker_classify_failed',
      error: error?.message,
    });
    return null;
  }
};
