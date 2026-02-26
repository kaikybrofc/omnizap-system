import logger from '../../utils/logger/loggerModule.js';
import { getActiveSocket } from '../../services/socketState.js';
import { normalizeJid, resolveBotJid } from '../../config/baileysConfig.js';
import { recordStickerAutoPackCycle } from '../../observability/metrics.js';
import stickerPackService from './stickerPackServiceRuntime.js';
import { listClassifiedStickerAssetsWithoutPack } from './stickerAssetRepository.js';
import { listStickerClassificationsByAssetIds } from './stickerAssetClassificationRepository.js';
import { decorateStickerClassification } from './stickerClassificationService.js';
import { listStickerPacksByOwner } from './stickerPackRepository.js';
import { listStickerPackItems } from './stickerPackItemRepository.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const AUTO_ENABLED = parseEnvBool(process.env.STICKER_AUTO_PACK_BY_TAGS_ENABLED, true);
const STARTUP_DELAY_MS = Math.max(1_000, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_STARTUP_DELAY_MS) || 20_000);
const INTERVAL_MS = Math.max(20_000, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_INTERVAL_MS) || 180_000);
const TARGET_PACK_SIZE = Math.max(5, Math.min(30, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_TARGET_SIZE) || 30));
const MIN_GROUP_SIZE = Math.max(3, Math.min(100, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MIN_GROUP_SIZE) || 8));
const MAX_TAG_GROUPS = Math.max(1, Math.min(40, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_GROUPS) || 12));
const MAX_SCAN_ASSETS = Math.max(100, Math.min(50_000, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_SCAN_ASSETS) || 5000));
const MAX_ADDITIONS_PER_CYCLE = Math.max(10, Math.min(2000, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_ADDITIONS_PER_CYCLE) || 300));
const AUTO_PACK_VISIBILITY = String(process.env.STICKER_AUTO_PACK_BY_TAGS_VISIBILITY || 'public').trim().toLowerCase() || 'public';
const AUTO_PUBLISHER = String(process.env.STICKER_AUTO_PACK_BY_TAGS_PUBLISHER || 'OmniZap Auto').trim() || 'OmniZap Auto';
const TOP_TAGS_PER_ASSET = Math.max(1, Math.min(5, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_TOP_TAGS_PER_ASSET) || 3));
const NSFW_THRESHOLD = Number.isFinite(Number(process.env.STICKER_AUTO_PACK_BY_TAGS_NSFW_THRESHOLD))
  ? Number(process.env.STICKER_AUTO_PACK_BY_TAGS_NSFW_THRESHOLD)
  : 0.7;
const NSFW_SUGGESTIVE_THRESHOLD = Number.isFinite(Number(process.env.STICKER_AUTO_PACK_BY_TAGS_NSFW_SUGGESTIVE_THRESHOLD))
  ? Number(process.env.STICKER_AUTO_PACK_BY_TAGS_NSFW_SUGGESTIVE_THRESHOLD)
  : 0.4;
const NSFW_EXPLICIT_THRESHOLD = Number.isFinite(Number(process.env.STICKER_AUTO_PACK_BY_TAGS_NSFW_EXPLICIT_THRESHOLD))
  ? Number(process.env.STICKER_AUTO_PACK_BY_TAGS_NSFW_EXPLICIT_THRESHOLD)
  : 0.78;
const MIN_ASSET_EDGE = Math.max(32, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MIN_ASSET_EDGE) || 192);
const MIN_ASSET_AREA = Math.max(32 * 32, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MIN_ASSET_AREA) || 192 * 192);
const MIN_ASSET_BYTES = Math.max(512, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MIN_ASSET_BYTES) || 6 * 1024);
const MAX_BLURRY_SCORE = Number.isFinite(Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_BLURRY_SCORE))
  ? Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_BLURRY_SCORE)
  : 0.82;
const MAX_LOW_QUALITY_SCORE = Number.isFinite(Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_LOW_QUALITY_SCORE))
  ? Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_LOW_QUALITY_SCORE)
  : 0.82;
const REBUILD_ENABLED = parseEnvBool(process.env.STICKER_AUTO_PACK_BY_TAGS_REBUILD_ENABLED, true);
const MAX_REMOVALS_PER_CYCLE = Math.max(0, Math.min(500, Number(process.env.STICKER_AUTO_PACK_BY_TAGS_MAX_REMOVALS_PER_CYCLE) || 120));
const DEDUPE_SIMILARITY_THRESHOLD = Number.isFinite(Number(process.env.STICKER_AUTO_PACK_BY_TAGS_DEDUPE_SIMILARITY_THRESHOLD))
  ? Number(process.env.STICKER_AUTO_PACK_BY_TAGS_DEDUPE_SIMILARITY_THRESHOLD)
  : 0.985;
const COHESION_REBUILD_THRESHOLD = Number.isFinite(Number(process.env.STICKER_AUTO_PACK_BY_TAGS_COHESION_REBUILD_THRESHOLD))
  ? Number(process.env.STICKER_AUTO_PACK_BY_TAGS_COHESION_REBUILD_THRESHOLD)
  : 0.56;

const EXPLICIT_OWNER = String(process.env.STICKER_AUTO_PACK_OWNER_JID || process.env.USER_ADMIN || '').trim();

const LABEL_TO_TAG = {
  'anime illustration': 'anime',
  'video game screenshot': 'game',
  'real life photo': 'foto-real',
  'nsfw content': 'nsfw',
  cartoon: 'cartoon',
};

const TECHNICAL_TAGS = new Set([
  'low-quality-compressed-image',
  'blurry-image',
  'text-only-image',
  'sticker-style-image',
  'whatsapp-sticker-style',
  'telegram-sticker-style',
]);

const normalizeTag = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const toTagFromLabel = (label) => {
  const key = String(label || '').trim().toLowerCase();
  return LABEL_TO_TAG[key] || normalizeTag(key);
};

const toPackTitleTag = (tag) =>
  String(tag || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Outros';

const resolveOwnerJid = () => {
  const sock = getActiveSocket?.();
  const botJid = resolveBotJid(sock?.user?.id || '');
  if (botJid) return botJid;

  if (EXPLICIT_OWNER) {
    if (EXPLICIT_OWNER.includes('@')) return normalizeJid(EXPLICIT_OWNER);
    const digits = EXPLICIT_OWNER.replace(/\D+/g, '');
    if (digits) return normalizeJid(`${digits}@s.whatsapp.net`);
  }

  return null;
};

const buildThemeKey = (theme, subtheme = '') => {
  const normalizedTheme = normalizeTag(theme);
  const normalizedSubtheme = normalizeTag(subtheme);
  if (!normalizedTheme) return '';
  return normalizedSubtheme ? `${normalizedTheme}:${normalizedSubtheme}` : normalizedTheme;
};
const parseThemeKey = (raw) => {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return { theme: '', subtheme: '' };
  const [theme = '', subtheme = ''] = normalized.split(':', 2);
  return {
    theme: normalizeTag(theme),
    subtheme: normalizeTag(subtheme),
  };
};
const buildAutoPackName = (theme, subtheme, index) => {
  const base = `[AUTO] ${toPackTitleTag(theme)}${subtheme ? ` · ${toPackTitleTag(subtheme)}` : ''}`;
  return `${base} (Vol. ${index})`;
};
const buildAutoPackMarker = (themeKey) => `[auto-theme:${themeKey}]`;
const buildAutoPackDescription = ({ theme, subtheme, themeKey, groupScore }) =>
  `${buildAutoPackMarker(themeKey)} Curadoria automática por tema. Tema: ${theme}${
    subtheme ? ` / ${subtheme}` : ''
  }. score=${Number(groupScore || 0).toFixed(4)}.`;

const getTagScoreEntries = (classification) => {
  if (!classification || typeof classification !== 'object') return [];
  const byTag = new Map();

  const register = (tag, score) => {
    const normalizedTag = normalizeTag(tag);
    const numericScore = Number(score);
    if (!normalizedTag) return;
    if (!Number.isFinite(numericScore)) return;
    byTag.set(normalizedTag, Math.max(byTag.get(normalizedTag) || 0, numericScore));
  };

  for (const [label, score] of Object.entries(classification.all_scores || {})) {
    register(toTagFromLabel(label), score);
  }

  if (classification.category) {
    register(toTagFromLabel(classification.category), Number(classification.confidence || 0));
  }

  if (classification.is_nsfw) {
    register('nsfw', Math.max(Number(classification.nsfw_score || 0), 0.7));
  }

  return Array.from(byTag.entries())
    .map(([tag, score]) => [tag, Number(Number(score).toFixed(6))])
    .sort((left, right) => right[1] - left[1]);
};

const vectorNorm = (vector) =>
  Math.sqrt(
    Object.values(vector || {})
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .reduce((sum, value) => sum + value * value, 0),
  );

const cosineSimilarity = (left, right) => {
  if (!left || !right) return 0;
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});
  if (!leftKeys.length || !rightKeys.length) return 0;

  const leftNorm = vectorNorm(left);
  const rightNorm = vectorNorm(right);
  if (leftNorm <= 0 || rightNorm <= 0) return 0;

  let dot = 0;
  for (const key of leftKeys) {
    const leftValue = Number(left[key]);
    const rightValue = Number(right[key]);
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue;
    dot += leftValue * rightValue;
  }
  return Math.max(0, Math.min(1, dot / (leftNorm * rightNorm)));
};

const getScoreByTag = (classification, tag) => {
  const normalizedTag = normalizeTag(tag);
  if (!normalizedTag) return 0;
  const entries = getTagScoreEntries(classification);
  const found = entries.find(([entryTag]) => entryTag === normalizedTag);
  return Number(found?.[1] || 0);
};

const buildTopTags = (classification) => {
  const decorated = decorateStickerClassification(classification || null);
  const decoratedTags = Array.isArray(decorated?.tags) ? decorated.tags.map((tag) => normalizeTag(tag)).filter(Boolean) : [];
  const ranked = getTagScoreEntries(classification)
    .filter(([tag]) => !TECHNICAL_TAGS.has(tag))
    .map(([tag, score]) => ({ tag, score }));

  const tags = [];
  for (const entry of ranked) {
    if (tags.some((item) => item.tag === entry.tag)) continue;
    tags.push(entry);
    if (tags.length >= TOP_TAGS_PER_ASSET) break;
  }

  for (const tag of decoratedTags) {
    if (TECHNICAL_TAGS.has(tag)) continue;
    if (tags.some((item) => item.tag === tag)) continue;
    tags.push({ tag, score: Number(classification?.confidence || 0) });
    if (tags.length >= TOP_TAGS_PER_ASSET) break;
  }

  return tags.slice(0, TOP_TAGS_PER_ASSET);
};

const evaluateQualityGate = (asset, classification) => {
  const width = Number(asset?.width || 0);
  const height = Number(asset?.height || 0);
  const sizeBytes = Number(asset?.size_bytes || 0);
  const area = width > 0 && height > 0 ? width * height : 0;
  const blurryScore = getScoreByTag(classification, 'blurry-image');
  const lowQualityScore = getScoreByTag(classification, 'low-quality-compressed-image');

  if ((width && width < MIN_ASSET_EDGE) || (height && height < MIN_ASSET_EDGE)) {
    return { accepted: false, reason: 'min_edge', qualityScore: 0 };
  }
  if (area && area < MIN_ASSET_AREA) {
    return { accepted: false, reason: 'min_area', qualityScore: 0 };
  }
  if (sizeBytes && sizeBytes < MIN_ASSET_BYTES) {
    return { accepted: false, reason: 'min_size_bytes', qualityScore: 0 };
  }
  if (blurryScore > MAX_BLURRY_SCORE) {
    return { accepted: false, reason: 'blurry', qualityScore: 0 };
  }
  if (lowQualityScore > MAX_LOW_QUALITY_SCORE) {
    return { accepted: false, reason: 'low_quality', qualityScore: 0 };
  }

  const qualityPenalty = Math.min(0.6, blurryScore * 0.35 + lowQualityScore * 0.35);
  const qualityScore = Number(Math.max(0.2, 1 - qualityPenalty).toFixed(6));
  return { accepted: true, reason: null, qualityScore };
};

const deriveThemeFromClassification = (classification) => {
  const topTags = buildTopTags(classification);
  const nsfwScore = Number(classification?.nsfw_score || 0);
  const isNsfw = classification?.is_nsfw === true || nsfwScore >= NSFW_THRESHOLD || nsfwScore >= NSFW_SUGGESTIVE_THRESHOLD;
  if (isNsfw) {
    const nsfwLevel = nsfwScore >= NSFW_EXPLICIT_THRESHOLD ? 'explicit' : 'suggestive';
    return {
      theme: `nsfw-${nsfwLevel}`,
      subtheme: topTags.find((entry) => entry.tag !== 'nsfw')?.tag || '',
      topTags,
      nsfwScore,
      nsfwLevel,
    };
  }

  const primary = topTags.find((entry) => entry.tag !== 'nsfw')?.tag || '';
  const secondary = topTags.find((entry) => entry.tag !== primary && entry.tag !== 'nsfw')?.tag || '';
  return {
    theme: primary,
    subtheme: secondary,
    topTags,
    nsfwScore,
    nsfwLevel: 'safe',
  };
};

const dedupeCandidatesByEmbedding = (candidates) => {
  if (!Array.isArray(candidates) || candidates.length <= 1) {
    return { deduped: Array.isArray(candidates) ? candidates : [], duplicateRate: 0, dropped: 0 };
  }

  const deduped = [];
  let dropped = 0;
  for (const candidate of candidates) {
    const candidateVector = candidate?.classification?.all_scores || {};
    const isDuplicate = deduped.some((entry) => {
      const entryVector = entry?.classification?.all_scores || {};
      return cosineSimilarity(candidateVector, entryVector) >= DEDUPE_SIMILARITY_THRESHOLD;
    });

    if (isDuplicate) {
      dropped += 1;
      continue;
    }
    deduped.push(candidate);
  }

  const duplicateRate = candidates.length > 0 ? dropped / candidates.length : 0;
  return {
    deduped,
    duplicateRate: Number(duplicateRate.toFixed(6)),
    dropped,
  };
};

const scoreCandidate = ({ classification, theme, topTags, qualityScore }) => {
  const confidence = Number(classification?.confidence || 0);
  const themeScore = Number(topTags.find((entry) => entry.tag === theme)?.score || 0);
  const score = confidence * 0.35 + themeScore * 0.4 + qualityScore * 0.25;
  return Number(Math.max(0, Math.min(1.2, score)).toFixed(6));
};

const collectCuratableCandidates = async () => {
  const grouped = new Map();
  let offset = 0;
  const pageLimit = 400;
  let scanned = 0;
  const stats = {
    assets_scanned: 0,
    assets_rejected_quality: 0,
    assets_rejected_no_theme: 0,
    assets_grouped: 0,
    reject_reason_counts: {},
  };

  while (scanned < MAX_SCAN_ASSETS) {
    const remaining = MAX_SCAN_ASSETS - scanned;
    const limit = Math.max(1, Math.min(pageLimit, remaining));

    const page = await listClassifiedStickerAssetsWithoutPack({ limit, offset });
    const assets = Array.isArray(page?.assets) ? page.assets : [];
    if (!assets.length) break;

    const classifications = await listStickerClassificationsByAssetIds(assets.map((asset) => asset.id));
    const byAssetId = new Map(classifications.map((entry) => [entry.asset_id, entry]));

    for (const asset of assets) {
      stats.assets_scanned += 1;
      const classification = byAssetId.get(asset.id);
      if (!classification) continue;

      const quality = evaluateQualityGate(asset, classification);
      if (!quality.accepted) {
        const reason = quality.reason || 'unknown';
        stats.assets_rejected_quality += 1;
        stats.reject_reason_counts[reason] = (stats.reject_reason_counts[reason] || 0) + 1;
        continue;
      }

      const { theme, subtheme, topTags, nsfwScore, nsfwLevel } = deriveThemeFromClassification(classification);
      if (!theme) {
        stats.assets_rejected_no_theme += 1;
        continue;
      }

      const themeKey = buildThemeKey(theme, subtheme);
      const score = scoreCandidate({ classification, theme, topTags, qualityScore: quality.qualityScore });
      const list = grouped.get(themeKey) || [];
      list.push({
        asset,
        classification,
        theme,
        subtheme,
        themeKey,
        topTags,
        qualityScore: quality.qualityScore,
        score,
        nsfwScore,
        nsfwLevel,
      });
      grouped.set(themeKey, list);
      stats.assets_grouped += 1;
    }

    scanned += assets.length;
    offset += assets.length;

    if (!page?.hasMore) break;
  }

  let dedupeDropped = 0;
  for (const [groupKey, list] of grouped.entries()) {
    const { deduped, duplicateRate, dropped } = dedupeCandidatesByEmbedding(list);
    dedupeDropped += dropped;
    stats.reject_reason_counts.duplicate_embedding = (stats.reject_reason_counts.duplicate_embedding || 0) + dropped;

    const normalizedList = deduped.map((candidate) => ({
      ...candidate,
      duplicateRate,
    }));
    normalizedList.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(right.asset?.created_at || '').localeCompare(String(left.asset?.created_at || ''));
    });

    grouped.set(groupKey, normalizedList);
  }

  stats.assets_deduped = dedupeDropped;

  return { grouped, stats };
};

const computeGroupMetrics = (themeKey, candidates) => {
  const first = candidates[0] || {};
  const theme = first.theme || parseThemeKey(themeKey).theme || '';
  const subtheme = first.subtheme || parseThemeKey(themeKey).subtheme || '';
  const size = candidates.length;
  if (!size) {
    return { theme, subtheme, themeKey, groupScore: 0, cohesion: 0, avgConfidence: 0, avgQuality: 0 };
  }

  const avgConfidence =
    candidates.reduce((sum, candidate) => sum + Number(candidate.classification?.confidence || 0), 0) / size;
  const avgQuality = candidates.reduce((sum, candidate) => sum + Number(candidate.qualityScore || 0), 0) / size;
  const avgDuplicateRate = candidates.reduce((sum, candidate) => sum + Number(candidate.duplicateRate || 0), 0) / size;
  let semanticSimilaritySum = 0;
  let semanticPairs = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      semanticPairs += 1;
      semanticSimilaritySum += cosineSimilarity(candidates[i]?.classification?.all_scores || {}, candidates[j]?.classification?.all_scores || {});
    }
  }
  const semanticCohesion = semanticPairs > 0 ? semanticSimilaritySum / semanticPairs : 1;
  const cooccurrence = new Map();
  for (const candidate of candidates) {
    const localSecondary = (candidate.topTags || [])
      .map((entry) => entry.tag)
      .find((tag) => tag && tag !== theme && tag !== 'nsfw');
    if (!localSecondary) continue;
    cooccurrence.set(localSecondary, (cooccurrence.get(localSecondary) || 0) + 1);
  }
  const bestCooccurrence = Math.max(0, ...cooccurrence.values());
  const topicalCohesion = size ? bestCooccurrence / size : 0;
  const cohesion = topicalCohesion * 0.45 + semanticCohesion * 0.55;
  const subthemeFromCooccurrence = Array.from(cooccurrence.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || subtheme;
  const volumeBoost = Math.min(1, size / Math.max(MIN_GROUP_SIZE, TARGET_PACK_SIZE));
  const duplicatePenalty = Math.max(0.65, 1 - avgDuplicateRate * 0.8);
  const groupScore = Number(
    (avgConfidence * (0.55 + cohesion * 0.45) * avgQuality * (0.75 + volumeBoost * 0.25) * duplicatePenalty).toFixed(6),
  );

  return {
    theme,
    subtheme: subthemeFromCooccurrence,
    themeKey,
    groupScore,
    cohesion: Number(cohesion.toFixed(6)),
    topical_cohesion: Number(topicalCohesion.toFixed(6)),
    semantic_cohesion: Number(semanticCohesion.toFixed(6)),
    avgConfidence: Number(avgConfidence.toFixed(6)),
    avgQuality: Number(avgQuality.toFixed(6)),
    duplicateRate: Number(avgDuplicateRate.toFixed(6)),
  };
};

const buildCurationPlan = ({ grouped, stats }) => {
  const curatedGroups = Array.from(grouped.entries())
    .map(([themeKey, candidates]) => {
      const metrics = computeGroupMetrics(themeKey, candidates);
      return { ...metrics, candidates };
    })
    .filter((group) => group.theme && group.candidates.length >= MIN_GROUP_SIZE)
    .sort((left, right) => {
      if (right.groupScore !== left.groupScore) return right.groupScore - left.groupScore;
      return right.candidates.length - left.candidates.length;
    })
    .slice(0, MAX_TAG_GROUPS);

  return {
    groups: curatedGroups,
    stats: {
      ...stats,
      groups_formed: curatedGroups.length,
    },
  };
};

const ensureAutoPacksForTheme = async ({ ownerJid, theme, subtheme, themeKey, groupScore, requiredCount, existingPacksByTheme }) => {
  const current = existingPacksByTheme.get(themeKey) || [];
  const created = [];

  while (current.length + created.length < requiredCount) {
    const index = current.length + created.length + 1;
    const pack = await stickerPackService.createPack({
      ownerJid,
      name: buildAutoPackName(theme, subtheme, index),
      publisher: AUTO_PUBLISHER,
      description: buildAutoPackDescription({ theme, subtheme, themeKey, groupScore }),
      visibility: AUTO_PACK_VISIBILITY,
    });
    created.push(pack);
  }

  const merged = [...current, ...created];
  existingPacksByTheme.set(themeKey, merged);
  return { packs: merged, createdCount: created.length };
};

let intervalHandle = null;
let startupHandle = null;
let running = false;

export const runStickerAutoPackByTagsCycle = async ({
  enableAdditions = true,
  enableRebuild = REBUILD_ENABLED,
} = {}) => {
  if (running) return;
  if (!AUTO_ENABLED) return;

  const ownerJid = resolveOwnerJid();
  if (!ownerJid) {
    logger.warn('Auto-pack por tags: owner_jid indisponível, ciclo ignorado.', {
      action: 'sticker_auto_pack_by_tags_owner_missing',
    });
    return;
  }

  running = true;
  const startedAt = Date.now();
  let added = 0;
  let createdPacks = 0;
  let processedGroups = 0;
  let duplicateSkips = 0;
  let packLimitSkips = 0;
  let removed = 0;

  try {
    const curationInput = await collectCuratableCandidates();
    const { groups: curatedGroups, stats } = buildCurationPlan(curationInput);

    if (!curatedGroups.length) {
      logger.debug('Auto-pack por tags: nenhum grupo elegível neste ciclo.', {
        action: 'sticker_auto_pack_by_tags_idle',
        ...stats,
      });
      return;
    }

    const ownerPacks = await listStickerPacksByOwner(ownerJid, { limit: 1000 });
    const existingPacksByTheme = new Map();

    for (const pack of ownerPacks) {
      const description = String(pack.description || '');
      const themeMarker = description.match(/\[auto-theme:([^\]]+)\]/i);
      const legacyTagMarker = description.match(/\[auto-tag:([^\]]+)\]/i);
      const markerValue = themeMarker?.[1] || legacyTagMarker?.[1] || '';
      if (!markerValue) continue;
      const parsed = parseThemeKey(markerValue);
      const normalizedLegacyTheme = !parsed.theme ? normalizeTag(markerValue) : '';
      if (!parsed.theme && !normalizedLegacyTheme) continue;
      const themeKey = buildThemeKey(parsed.theme, parsed.subtheme);
      const fallbackThemeKey = normalizedLegacyTheme || '';
      const finalThemeKey = themeKey || fallbackThemeKey;
      if (!finalThemeKey) continue;
      const list = existingPacksByTheme.get(finalThemeKey) || [];
      list.push(pack);
      existingPacksByTheme.set(finalThemeKey, list);
    }

    const executionGroups = [];
    for (const group of curatedGroups) {
      const requiredPacks = Math.max(1, Math.ceil(group.candidates.length / TARGET_PACK_SIZE));
      const { packs, createdCount } = await ensureAutoPacksForTheme({
        ownerJid,
        theme: group.theme,
        subtheme: group.subtheme,
        themeKey: group.themeKey,
        groupScore: group.groupScore,
        requiredCount: requiredPacks,
        existingPacksByTheme,
      });
      createdPacks += createdCount;
      processedGroups += 1;

      executionGroups.push({
        ...group,
        packs,
        candidateIndex: 0,
        assignedCount: 0,
        packCounts: new Map(
        packs.map((pack) => [pack.id, Math.max(0, Number(pack.sticker_count || 0))]),
        ),
      });
    }

    if (enableRebuild && MAX_REMOVALS_PER_CYCLE > 0) {
      for (const group of executionGroups) {
        if (removed >= MAX_REMOVALS_PER_CYCLE) break;
        if (Number(group.semantic_cohesion || 0) >= COHESION_REBUILD_THRESHOLD) continue;
        const desiredByPack = new Map();

        for (let packIndex = 0; packIndex < group.packs.length; packIndex += 1) {
          const start = packIndex * TARGET_PACK_SIZE;
          const end = start + TARGET_PACK_SIZE;
          const desiredIds = group.candidates.slice(start, end).map((candidate) => candidate.asset.id);
          desiredByPack.set(group.packs[packIndex].id, new Set(desiredIds));
        }

        for (const pack of group.packs) {
          if (removed >= MAX_REMOVALS_PER_CYCLE) break;
          const desiredSet = desiredByPack.get(pack.id) || new Set();
          const currentItems = await listStickerPackItems(pack.id);
          for (const item of currentItems) {
            if (removed >= MAX_REMOVALS_PER_CYCLE) break;
            if (desiredSet.has(item.sticker_id)) continue;

            try {
              await stickerPackService.removeStickerFromPack({
                ownerJid,
                identifier: pack.id,
                selector: item.sticker_id,
              });
              removed += 1;
              const currentCount = group.packCounts.get(pack.id) || 0;
              group.packCounts.set(pack.id, Math.max(0, currentCount - 1));
            } catch (error) {
              logger.warn('Falha ao remover sticker no rebuild de auto-pack por tags.', {
                action: 'sticker_auto_pack_by_tags_rebuild_remove_failed',
                theme: group.theme,
                theme_key: group.themeKey,
                pack_id: pack.id,
                asset_id: item.sticker_id,
                error: error?.message,
                error_code: error?.code,
              });
            }
          }
        }
      }
    }

    let progressed = true;
    while (enableAdditions && added < MAX_ADDITIONS_PER_CYCLE && progressed) {
      progressed = false;

      for (const group of executionGroups) {
        if (added >= MAX_ADDITIONS_PER_CYCLE) break;
        if (group.candidateIndex >= group.candidates.length) continue;

        let targetPackIndex = Math.floor(group.assignedCount / TARGET_PACK_SIZE);
        let targetPack = group.packs[targetPackIndex];
        while (targetPack && (group.packCounts.get(targetPack.id) || 0) >= TARGET_PACK_SIZE) {
          targetPackIndex += 1;
          targetPack = group.packs[targetPackIndex];
        }
        if (!targetPack) continue;

        const candidate = group.candidates[group.candidateIndex];
        group.candidateIndex += 1;
        progressed = true;

        try {
          await stickerPackService.addStickerToPack({
            ownerJid,
            identifier: targetPack.id,
            asset: { id: candidate.asset.id },
            emojis: [],
            accessibilityLabel: `Auto-theme ${group.theme}${group.subtheme ? `/${group.subtheme}` : ''}`,
          });
          const currentCount = group.packCounts.get(targetPack.id) || 0;
          group.packCounts.set(targetPack.id, currentCount + 1);
          group.assignedCount += 1;
          added += 1;
        } catch (error) {
          if (error?.code === 'DUPLICATE_STICKER') {
            duplicateSkips += 1;
            continue;
          }
          if (error?.code === 'PACK_LIMIT_REACHED') {
            group.packCounts.set(targetPack.id, TARGET_PACK_SIZE);
            packLimitSkips += 1;
            continue;
          }

          logger.warn('Falha ao adicionar sticker em auto-pack por tags.', {
            action: 'sticker_auto_pack_by_tags_add_failed',
            theme: group.theme,
            subtheme: group.subtheme || null,
            theme_key: group.themeKey,
            pack_id: targetPack.id,
            asset_id: candidate.asset.id,
            error: error?.message,
            error_code: error?.code,
          });
        }
      }
    }

    const duplicateRate = Number(stats.assets_deduped || 0) / Math.max(1, Number(stats.assets_scanned || 0));
    const rejectedCount = Number(stats.assets_rejected_quality || 0) + Number(stats.assets_rejected_no_theme || 0);
    const rejectionRate = rejectedCount / Math.max(1, Number(stats.assets_scanned || 0));
    const fillRate = added / Math.max(1, processedGroups * TARGET_PACK_SIZE);

    recordStickerAutoPackCycle({
      durationMs: Date.now() - startedAt,
      assetsScanned: Number(stats.assets_scanned || 0),
      assetsAdded: added,
      duplicateRate,
      rejectionRate,
      fillRate,
    });

    logger.info('Auto-pack por tags executado.', {
      action: 'sticker_auto_pack_by_tags_cycle',
      owner_jid: ownerJid,
      processed_groups: processedGroups,
      created_packs: createdPacks,
      added_stickers: added,
      removed_stickers: removed,
      rebuild_enabled_cycle: Boolean(enableRebuild),
      additions_enabled_cycle: Boolean(enableAdditions),
      cohesion_rebuild_threshold: Number(COHESION_REBUILD_THRESHOLD.toFixed(6)),
      duplicate_skips: duplicateSkips,
      pack_limit_skips: packLimitSkips,
      duration_ms: Date.now() - startedAt,
      duplicate_rate: Number(duplicateRate.toFixed(6)),
      rejection_rate: Number(rejectionRate.toFixed(6)),
      pack_fill_rate: Number(fillRate.toFixed(6)),
      min_group_size: MIN_GROUP_SIZE,
      target_pack_size: TARGET_PACK_SIZE,
      max_additions_per_cycle: MAX_ADDITIONS_PER_CYCLE,
      ...stats,
    });
  } catch (error) {
    logger.error('Falha no ciclo do auto-pack por tags.', {
      action: 'sticker_auto_pack_by_tags_cycle_failed',
      error: error?.message,
      stack: error?.stack,
    });
  } finally {
    running = false;
  }
};

export const startStickerAutoPackByTagsBackground = () => {
  if (startupHandle || intervalHandle) return;

  if (!AUTO_ENABLED) {
    logger.info('Auto-pack por tags desabilitado.', {
      action: 'sticker_auto_pack_by_tags_disabled',
    });
    return;
  }

  logger.info('Iniciando auto-pack por tags em background.', {
    action: 'sticker_auto_pack_by_tags_start',
    startup_delay_ms: STARTUP_DELAY_MS,
    interval_ms: INTERVAL_MS,
    target_pack_size: TARGET_PACK_SIZE,
    min_group_size: MIN_GROUP_SIZE,
    max_groups: MAX_TAG_GROUPS,
    max_scan_assets: MAX_SCAN_ASSETS,
    max_additions_per_cycle: MAX_ADDITIONS_PER_CYCLE,
    visibility: AUTO_PACK_VISIBILITY,
    top_tags_per_asset: TOP_TAGS_PER_ASSET,
    nsfw_threshold: NSFW_THRESHOLD,
    nsfw_suggestive_threshold: NSFW_SUGGESTIVE_THRESHOLD,
    nsfw_explicit_threshold: NSFW_EXPLICIT_THRESHOLD,
    rebuild_enabled: REBUILD_ENABLED,
    max_removals_per_cycle: MAX_REMOVALS_PER_CYCLE,
    dedupe_similarity_threshold: DEDUPE_SIMILARITY_THRESHOLD,
    quality_gate: {
      min_asset_edge: MIN_ASSET_EDGE,
      min_asset_area: MIN_ASSET_AREA,
      min_asset_bytes: MIN_ASSET_BYTES,
      max_blurry_score: MAX_BLURRY_SCORE,
      max_low_quality_score: MAX_LOW_QUALITY_SCORE,
    },
  });

  startupHandle = setTimeout(() => {
    startupHandle = null;
    void runStickerAutoPackByTagsCycle();

    intervalHandle = setInterval(() => {
      void runStickerAutoPackByTagsCycle();
    }, INTERVAL_MS);

    if (typeof intervalHandle.unref === 'function') {
      intervalHandle.unref();
    }
  }, STARTUP_DELAY_MS);

  if (typeof startupHandle.unref === 'function') {
    startupHandle.unref();
  }
};

export const stopStickerAutoPackByTagsBackground = () => {
  if (startupHandle) {
    clearTimeout(startupHandle);
    startupHandle = null;
  }

  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
