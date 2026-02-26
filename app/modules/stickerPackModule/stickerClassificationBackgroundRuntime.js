import fs from 'node:fs/promises';
import os from 'node:os';

import logger from '../../utils/logger/loggerModule.js';
import { listStickerAssetsPendingClassification } from './stickerAssetRepository.js';
import { classifierConfig, ensureStickerAssetClassified } from './stickerClassificationService.js';

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

let intervalHandle = null;
let startupTimeoutHandle = null;
let running = false;

const classifyBatch = async () => {
  if (running) return;
  if (!BACKGROUND_ENABLED || !classifierConfig.enabled) return;

  running = true;
  const startedAt = Date.now();
  let processed = 0;
  let classified = 0;
  let failed = 0;

  try {
    const assets = await listStickerAssetsPendingClassification({ limit: BATCH_SIZE });

    if (!assets.length) {
      logger.debug('Worker de classificação: sem assets pendentes.', {
        action: 'sticker_classification_background_idle',
      });
      return;
    }

    let cursor = 0;
    const workers = Array.from({ length: Math.min(BACKGROUND_CONCURRENCY, assets.length) }).map(async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= assets.length) break;

        const asset = assets[index];
        processed += 1;

        try {
          if (!asset?.storage_path) {
            failed += 1;
            continue;
          }

          const buffer = await fs.readFile(asset.storage_path);
          const result = await ensureStickerAssetClassified({ asset, buffer, force: false });
          if (result) classified += 1;
        } catch (error) {
          failed += 1;
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
  } catch (error) {
    logger.error('Falha no loop de classificação em background.', {
      action: 'sticker_classification_background_cycle_failed',
      error: error?.message,
    });
  } finally {
    running = false;
    const durationMs = Date.now() - startedAt;
    if (processed > 0) {
      logger.info('Worker de classificação executado.', {
        action: 'sticker_classification_background_cycle',
        processed,
        classified,
        failed,
        duration_ms: durationMs,
        batch_size: BATCH_SIZE,
        concurrency: BACKGROUND_CONCURRENCY,
      });
    }
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
