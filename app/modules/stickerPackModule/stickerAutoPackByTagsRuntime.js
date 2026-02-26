import logger from '../../utils/logger/loggerModule.js';
import { getActiveSocket } from '../../services/socketState.js';
import { normalizeJid, resolveBotJid } from '../../config/baileysConfig.js';
import stickerPackService from './stickerPackServiceRuntime.js';
import { listClassifiedStickerAssetsWithoutPack } from './stickerAssetRepository.js';
import { listStickerClassificationsByAssetIds } from './stickerAssetClassificationRepository.js';
import { decorateStickerClassification } from './stickerClassificationService.js';
import { listStickerPacksByOwner } from './stickerPackRepository.js';

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

const buildAutoPackName = (tag, index) => `[AUTO] ${toPackTitleTag(tag)} #${index}`;
const buildAutoPackMarker = (tag) => `[auto-tag:${tag}]`;
const buildAutoPackDescription = (tag) =>
  `${buildAutoPackMarker(tag)} Pack automático baseado em classificação por tags. Grupo: ${tag}.`;

const selectPrimaryTag = (classification) => {
  const decorated = decorateStickerClassification(classification || null);
  const tags = Array.isArray(decorated?.tags) ? decorated.tags : [];
  if (!tags.length) return '';

  const nonTechnical = tags.find((tag) => !TECHNICAL_TAGS.has(tag));
  return nonTechnical || tags[0] || '';
};

const scoreForPrimaryTag = (classification, tag) => {
  if (!classification || !tag) return 0;

  const confidence = Number(classification.confidence || 0);
  let bestLabelScore = 0;
  for (const [label, score] of Object.entries(classification.all_scores || {})) {
    if (!Number.isFinite(Number(score))) continue;
    if (toTagFromLabel(label) !== tag) continue;
    bestLabelScore = Math.max(bestLabelScore, Number(score));
  }

  const categoryTag = toTagFromLabel(classification.category || '');
  if (categoryTag === tag) {
    bestLabelScore = Math.max(bestLabelScore, confidence);
  }

  const nsfwBoost = tag === 'nsfw' ? 0.03 : 0;
  return Number((confidence * 0.6 + bestLabelScore * 0.4 + nsfwBoost).toFixed(6));
};

const listCandidatesGroupedByTag = async () => {
  const grouped = new Map();
  let offset = 0;
  const pageLimit = 400;
  let scanned = 0;

  while (scanned < MAX_SCAN_ASSETS) {
    const remaining = MAX_SCAN_ASSETS - scanned;
    const limit = Math.max(1, Math.min(pageLimit, remaining));

    const page = await listClassifiedStickerAssetsWithoutPack({ limit, offset });
    const assets = Array.isArray(page?.assets) ? page.assets : [];
    if (!assets.length) break;

    const classifications = await listStickerClassificationsByAssetIds(assets.map((asset) => asset.id));
    const byAssetId = new Map(classifications.map((entry) => [entry.asset_id, entry]));

    for (const asset of assets) {
      const classification = byAssetId.get(asset.id);
      if (!classification) continue;

      const primaryTag = selectPrimaryTag(classification);
      if (!primaryTag) continue;

      const score = scoreForPrimaryTag(classification, primaryTag);
      const list = grouped.get(primaryTag) || [];
      list.push({ asset, classification, score });
      grouped.set(primaryTag, list);
    }

    scanned += assets.length;
    offset += assets.length;

    if (!page?.hasMore) break;
  }

  for (const list of grouped.values()) {
    list.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.asset?.created_at || '').localeCompare(String(right.asset?.created_at || ''));
    });
  }

  return grouped;
};

const ensureAutoPacksForTag = async ({ ownerJid, tag, requiredCount, existingPacksByTag }) => {
  const current = existingPacksByTag.get(tag) || [];
  const created = [];

  while (current.length + created.length < requiredCount) {
    const index = current.length + created.length + 1;
    const pack = await stickerPackService.createPack({
      ownerJid,
      name: buildAutoPackName(tag, index),
      publisher: AUTO_PUBLISHER,
      description: buildAutoPackDescription(tag),
      visibility: AUTO_PACK_VISIBILITY,
    });
    created.push(pack);
  }

  const merged = [...current, ...created];
  existingPacksByTag.set(tag, merged);
  return { packs: merged, createdCount: created.length };
};

let intervalHandle = null;
let startupHandle = null;
let running = false;

const executeCycle = async () => {
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
  let processedTags = 0;

  try {
    const grouped = await listCandidatesGroupedByTag();
    const eligibleGroups = Array.from(grouped.entries())
      .filter(([, list]) => list.length >= MIN_GROUP_SIZE)
      .sort((left, right) => right[1].length - left[1].length)
      .slice(0, MAX_TAG_GROUPS);

    if (!eligibleGroups.length) {
      logger.debug('Auto-pack por tags: nenhum grupo elegível neste ciclo.', {
        action: 'sticker_auto_pack_by_tags_idle',
      });
      return;
    }

    const ownerPacks = await listStickerPacksByOwner(ownerJid, { limit: 1000 });
    const existingPacksByTag = new Map();

    for (const pack of ownerPacks) {
      const marker = String(pack.description || '').match(/\[auto-tag:([^\]]+)\]/i);
      if (!marker?.[1]) continue;
      const tag = normalizeTag(marker[1]);
      if (!tag) continue;
      const list = existingPacksByTag.get(tag) || [];
      list.push(pack);
      existingPacksByTag.set(tag, list);
    }

    for (const [tag, candidates] of eligibleGroups) {
      if (added >= MAX_ADDITIONS_PER_CYCLE) break;
      processedTags += 1;

      const requiredPacks = Math.max(1, Math.ceil(candidates.length / TARGET_PACK_SIZE));
      const { packs, createdCount } = await ensureAutoPacksForTag({
        ownerJid,
        tag,
        requiredCount: requiredPacks,
        existingPacksByTag,
      });
      createdPacks += createdCount;

      const packCounts = new Map(
        packs.map((pack) => [pack.id, Math.max(0, Number(pack.sticker_count || 0))]),
      );

      for (let index = 0; index < candidates.length; index += 1) {
        if (added >= MAX_ADDITIONS_PER_CYCLE) break;

        const targetPackIndex = Math.floor(index / TARGET_PACK_SIZE);
        const targetPack = packs[targetPackIndex];
        if (!targetPack) break;

        const currentCount = packCounts.get(targetPack.id) || 0;
        if (currentCount >= TARGET_PACK_SIZE) continue;

        const candidate = candidates[index];

        try {
          await stickerPackService.addStickerToPack({
            ownerJid,
            identifier: targetPack.id,
            asset: { id: candidate.asset.id },
            emojis: [],
            accessibilityLabel: `Auto-tag ${tag}`,
          });
          packCounts.set(targetPack.id, currentCount + 1);
          added += 1;
        } catch (error) {
          if (error?.code === 'DUPLICATE_STICKER') continue;
          if (error?.code === 'PACK_LIMIT_REACHED') {
            packCounts.set(targetPack.id, TARGET_PACK_SIZE);
            continue;
          }

          logger.warn('Falha ao adicionar sticker em auto-pack por tags.', {
            action: 'sticker_auto_pack_by_tags_add_failed',
            tag,
            pack_id: targetPack.id,
            asset_id: candidate.asset.id,
            error: error?.message,
            error_code: error?.code,
          });
        }
      }
    }

    logger.info('Auto-pack por tags executado.', {
      action: 'sticker_auto_pack_by_tags_cycle',
      owner_jid: ownerJid,
      processed_tags: processedTags,
      created_packs: createdPacks,
      added_stickers: added,
      duration_ms: Date.now() - startedAt,
      min_group_size: MIN_GROUP_SIZE,
      target_pack_size: TARGET_PACK_SIZE,
      max_additions_per_cycle: MAX_ADDITIONS_PER_CYCLE,
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
  });

  startupHandle = setTimeout(() => {
    startupHandle = null;
    void executeCycle();

    intervalHandle = setInterval(() => {
      void executeCycle();
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
