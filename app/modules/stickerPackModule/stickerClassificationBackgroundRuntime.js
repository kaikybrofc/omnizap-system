import fs from 'node:fs/promises';
import os from 'node:os';

import logger from '../../utils/logger/loggerModule.js';
import { setQueueDepth } from '../../observability/metrics.js';
import { listStickerAssetsPendingClassification, findStickerAssetById } from './stickerAssetRepository.js';
import { classifierConfig, ensureStickerAssetClassified } from './stickerClassificationService.js';
import {
  listAssetsForLowConfidenceReprocess,
  listAssetsForModelUpgradeReprocess,
} from './stickerAssetClassificationRepository.js';
import {
  claimStickerAssetReprocessTask,
  completeStickerAssetReprocessTask,
  countStickerAssetReprocessQueueByStatus,
  enqueueStickerAssetReprocess,
  failStickerAssetReprocessTask,
} from './stickerAssetReprocessQueueRepository.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const BACKGROUND_ENABLED = parseEnvBool(process.env.STICKER_CLASSIFICATION_BACKGROUND_ENABLED, true);
const STARTUP_DELAY_MS = Math.max(1_000, Number(process.env.STICKER_CLASSIFICATION_BACKGROUND_STARTUP_DELAY_MS) || 15_000);
const INTERVAL_MS = Math.max(1_000, Number(process.env.STICKER_CLASSIFICATION_BACKGROUND_INTERVAL_MS) || 120_000);
const cpuCount = Math.max(1, Number(os.cpus()?.length || 1));
const BACKGROUND_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.STICKER_CLASSIFICATION_BACKGROUND_CONCURRENCY) || cpuCount),
);
const BATCH_SIZE = Math.max(
  1,
  Math.min(300, Number(process.env.STICKER_CLASSIFICATION_BACKGROUND_BATCH_SIZE) || BACKGROUND_CONCURRENCY * 2),
);

const REPROCESS_ENABLED = parseEnvBool(process.env.STICKER_REPROCESS_QUEUE_ENABLED, true);
const REPROCESS_MAX_PER_CYCLE = Math.max(0, Math.min(300, Number(process.env.STICKER_REPROCESS_MAX_PER_CYCLE) || BATCH_SIZE));
const REPROCESS_MODEL_UPGRADE_SCAN_LIMIT = Math.max(
  0,
  Math.min(2000, Number(process.env.STICKER_REPROCESS_MODEL_UPGRADE_SCAN_LIMIT) || 350),
);
const REPROCESS_LOW_CONFIDENCE_SCAN_LIMIT = Math.max(
  0,
  Math.min(2000, Number(process.env.STICKER_REPROCESS_LOW_CONFIDENCE_SCAN_LIMIT) || 250),
);
const REPROCESS_LOW_CONFIDENCE_THRESHOLD = Number.isFinite(Number(process.env.STICKER_REPROCESS_LOW_CONFIDENCE_THRESHOLD))
  ? Number(process.env.STICKER_REPROCESS_LOW_CONFIDENCE_THRESHOLD)
  : 0.65;
const REPROCESS_LOW_CONFIDENCE_STALE_HOURS = Math.max(
  1,
  Math.min(24 * 365, Number(process.env.STICKER_REPROCESS_LOW_CONFIDENCE_STALE_HOURS) || 48),
);
const REPROCESS_RETRY_DELAY_SECONDS = Math.max(
  5,
  Math.min(3600, Number(process.env.STICKER_REPROCESS_RETRY_DELAY_SECONDS) || 120),
);

let intervalHandle = null;
let startupTimeoutHandle = null;
let running = false;
let reprocessQueueAvailable = true;

const classifyAsset = async ({ asset, force = false }) => {
  if (!asset?.storage_path || !asset?.id) {
    return { ok: false, reason: 'asset_missing_storage' };
  }

  const buffer = await fs.readFile(asset.storage_path);
  const result = await ensureStickerAssetClassified({ asset, buffer, force });
  return { ok: Boolean(result), reason: result ? null : 'classification_empty' };
};

const processPendingAssets = async () => {
  const stats = {
    processed: 0,
    classified: 0,
    failed: 0,
  };

  const assets = await listStickerAssetsPendingClassification({ limit: BATCH_SIZE });
  if (!assets.length) {
    logger.debug('Worker de classificação: sem assets pendentes.', {
      action: 'sticker_classification_background_idle',
    });
    return stats;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(BACKGROUND_CONCURRENCY, assets.length) }).map(async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= assets.length) break;

      const asset = assets[index];
      stats.processed += 1;

      try {
        const result = await classifyAsset({ asset, force: false });
        if (result.ok) {
          stats.classified += 1;
        } else {
          stats.failed += 1;
        }
      } catch (error) {
        stats.failed += 1;
        logger.warn('Falha ao classificar asset no worker de background.', {
          action: 'sticker_classification_background_asset_failed',
          asset_id: asset?.id || null,
          storage_path: asset?.storage_path || null,
          error: error?.message,
        });
      }
    }
  });

  await Promise.all(workers);
  return stats;
};

const enqueueModelUpgradeCandidates = async () => {
  if (!REPROCESS_ENABLED || !classifierConfig?.classification_version) return 0;

  const assetIds = await listAssetsForModelUpgradeReprocess({
    currentVersion: classifierConfig.classification_version,
    limit: REPROCESS_MODEL_UPGRADE_SCAN_LIMIT,
  });

  let enqueued = 0;
  for (const assetId of assetIds) {
    const inserted = await enqueueStickerAssetReprocess({
      assetId,
      reason: 'MODEL_UPGRADE',
      priority: 60,
    });
    if (inserted) enqueued += 1;
  }

  return enqueued;
};

const enqueueLowConfidenceCandidates = async () => {
  if (!REPROCESS_ENABLED || !Number.isFinite(REPROCESS_LOW_CONFIDENCE_THRESHOLD)) return 0;

  const assetIds = await listAssetsForLowConfidenceReprocess({
    confidenceThreshold: REPROCESS_LOW_CONFIDENCE_THRESHOLD,
    staleHours: REPROCESS_LOW_CONFIDENCE_STALE_HOURS,
    limit: REPROCESS_LOW_CONFIDENCE_SCAN_LIMIT,
  });

  let enqueued = 0;
  for (const assetId of assetIds) {
    const inserted = await enqueueStickerAssetReprocess({
      assetId,
      reason: 'LOW_CONFIDENCE',
      priority: 70,
    });
    if (inserted) enqueued += 1;
  }

  return enqueued;
};

const processReprocessQueue = async ({ limit = REPROCESS_MAX_PER_CYCLE } = {}) => {
  if (!REPROCESS_ENABLED || limit <= 0 || !reprocessQueueAvailable) {
    return {
      processed: 0,
      classified: 0,
      failed: 0,
      enqueued_model_upgrade: 0,
      enqueued_low_confidence: 0,
    };
  }

  let enqueuedModelUpgrade = 0;
  let enqueuedLowConfidence = 0;
  try {
    enqueuedModelUpgrade = await enqueueModelUpgradeCandidates();
    enqueuedLowConfidence = await enqueueLowConfidenceCandidates();
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      reprocessQueueAvailable = false;
      logger.warn('Fila de reprocessamento indisponivel (migração pendente). Seguindo sem reprocessar.', {
        action: 'sticker_reprocess_queue_unavailable',
      });
      return {
        processed: 0,
        classified: 0,
        failed: 0,
        enqueued_model_upgrade: 0,
        enqueued_low_confidence: 0,
      };
    }
    throw error;
  }

  const stats = {
    processed: 0,
    classified: 0,
    failed: 0,
    enqueued_model_upgrade: enqueuedModelUpgrade,
    enqueued_low_confidence: enqueuedLowConfidence,
  };

  for (let i = 0; i < limit; i += 1) {
    const task = await claimStickerAssetReprocessTask();
    if (!task) break;

    stats.processed += 1;

    try {
      const asset = await findStickerAssetById(task.asset_id);
      if (!asset?.id) {
        await completeStickerAssetReprocessTask(task.id);
        continue;
      }

      const result = await classifyAsset({ asset, force: true });
      if (result.ok) {
        await completeStickerAssetReprocessTask(task.id);
        stats.classified += 1;
      } else {
        stats.failed += 1;
        await failStickerAssetReprocessTask(task.id, {
          error: result.reason || 'reprocess_failed',
          retryDelaySeconds: REPROCESS_RETRY_DELAY_SECONDS,
        });
      }
    } catch (error) {
      stats.failed += 1;
      await failStickerAssetReprocessTask(task.id, {
        error: error?.message || 'reprocess_exception',
        retryDelaySeconds: REPROCESS_RETRY_DELAY_SECONDS,
      });

      logger.warn('Falha ao reclassificar asset da fila de reprocessamento.', {
        action: 'sticker_reprocess_queue_task_failed',
        task_id: task.id,
        asset_id: task.asset_id,
        reason: task.reason,
        attempts: task.attempts,
        error: error?.message,
      });
    }
  }

  try {
    const [pendingDepth, processingDepth] = await Promise.all([
      countStickerAssetReprocessQueueByStatus('pending'),
      countStickerAssetReprocessQueueByStatus('processing'),
    ]);
    setQueueDepth('sticker_reprocess_pending', pendingDepth);
    setQueueDepth('sticker_reprocess_processing', processingDepth);
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      reprocessQueueAvailable = false;
    } else {
      throw error;
    }
  }

  return stats;
};

export const runStickerClassificationCycle = async ({
  processPending = true,
  processReprocess = true,
} = {}) => {
  if (!BACKGROUND_ENABLED || !classifierConfig.enabled) {
    return {
      skipped: true,
      reason: !BACKGROUND_ENABLED ? 'background_disabled' : 'classifier_disabled',
    };
  }

  const startedAt = Date.now();
  const reprocessStats = processReprocess ? await processReprocessQueue() : null;
  const pendingStats = processPending ? await processPendingAssets() : null;

  return {
    skipped: false,
    duration_ms: Date.now() - startedAt,
    pending: pendingStats,
    reprocess: reprocessStats,
  };
};

const classifyBatch = async () => {
  if (running) return;
  if (!BACKGROUND_ENABLED || !classifierConfig.enabled) return;

  running = true;
  const startedAt = Date.now();

  try {
    const result = await runStickerClassificationCycle({
      processPending: true,
      processReprocess: true,
    });

    const pending = result?.pending || { processed: 0, classified: 0, failed: 0 };
    const reprocess = result?.reprocess || {
      processed: 0,
      classified: 0,
      failed: 0,
      enqueued_model_upgrade: 0,
      enqueued_low_confidence: 0,
    };

    const processed = Number(pending.processed || 0) + Number(reprocess.processed || 0);
    const classified = Number(pending.classified || 0) + Number(reprocess.classified || 0);
    const failed = Number(pending.failed || 0) + Number(reprocess.failed || 0);

    if (processed > 0 || reprocess.enqueued_model_upgrade > 0 || reprocess.enqueued_low_confidence > 0) {
      logger.info('Worker de classificação executado.', {
        action: 'sticker_classification_background_cycle',
        processed,
        classified,
        failed,
        reprocess_processed: Number(reprocess.processed || 0),
        reprocess_classified: Number(reprocess.classified || 0),
        reprocess_failed: Number(reprocess.failed || 0),
        reprocess_enqueued_model_upgrade: Number(reprocess.enqueued_model_upgrade || 0),
        reprocess_enqueued_low_confidence: Number(reprocess.enqueued_low_confidence || 0),
        duration_ms: Date.now() - startedAt,
        batch_size: BATCH_SIZE,
        concurrency: BACKGROUND_CONCURRENCY,
      });
    }
  } catch (error) {
    logger.error('Falha no loop de classificação em background.', {
      action: 'sticker_classification_background_cycle_failed',
      error: error?.message,
    });
  } finally {
    running = false;
  }
};

export const startStickerClassificationBackground = () => {
  if (intervalHandle || startupTimeoutHandle) return;

  if (!BACKGROUND_ENABLED) {
    logger.info('Worker de classificação em background desabilitado.', {
      action: 'sticker_classification_background_disabled',
    });
    return;
  }

  if (!classifierConfig.enabled) {
    logger.info('Worker de classificação em background ignorado (CLIP desativado).', {
      action: 'sticker_classification_background_classifier_disabled',
    });
    return;
  }

  logger.info('Iniciando worker de classificação em background.', {
    action: 'sticker_classification_background_start',
    startup_delay_ms: STARTUP_DELAY_MS,
    interval_ms: INTERVAL_MS,
    batch_size: BATCH_SIZE,
    concurrency: BACKGROUND_CONCURRENCY,
    classifier_api: classifierConfig.api_url,
    reprocess_enabled: REPROCESS_ENABLED,
    reprocess_max_per_cycle: REPROCESS_MAX_PER_CYCLE,
  });

  startupTimeoutHandle = setTimeout(() => {
    startupTimeoutHandle = null;
    void classifyBatch();

    intervalHandle = setInterval(() => {
      void classifyBatch();
    }, INTERVAL_MS);

    if (typeof intervalHandle.unref === 'function') {
      intervalHandle.unref();
    }
  }, STARTUP_DELAY_MS);

  if (typeof startupTimeoutHandle.unref === 'function') {
    startupTimeoutHandle.unref();
  }
};

export const stopStickerClassificationBackground = () => {
  if (startupTimeoutHandle) {
    clearTimeout(startupTimeoutHandle);
    startupTimeoutHandle = null;
  }

  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
