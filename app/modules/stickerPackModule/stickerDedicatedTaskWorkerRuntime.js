import logger from '../../utils/logger/loggerModule.js';
import { setQueueDepth } from '../../observability/metrics.js';
import { isFeatureEnabled } from '../../services/featureFlagService.js';
import { runStickerClassificationCycle } from './stickerClassificationBackgroundRuntime.js';
import { runStickerAutoPackByTagsCycle } from './stickerAutoPackByTagsRuntime.js';
import { claimWorkerTask, completeWorkerTask, countWorkerTasksByStatus, failWorkerTask } from './stickerWorkerTaskQueueRepository.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const clampInt = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const DEDICATED_WORKERS_ENABLED = parseEnvBool(process.env.STICKER_DEDICATED_WORKERS_ENABLED, true);
const DEDICATED_WORKERS_FORCE_ENABLED = parseEnvBool(process.env.STICKER_DEDICATED_WORKERS_FORCE_ENABLED, false);
const DEDICATED_WORKER_RETRY_DELAY_SECONDS = clampInt(process.env.STICKER_DEDICATED_WORKER_RETRY_DELAY_SECONDS, 60, 5, 3600);
const DEDICATED_WORKER_POLL_INTERVAL_MS = clampInt(process.env.STICKER_DEDICATED_WORKER_POLL_INTERVAL_MS, 2500, 250, 60_000);
const DEDICATED_WORKER_MAX_TASKS_PER_TICK = clampInt(process.env.STICKER_DEDICATED_WORKER_MAX_TASKS_PER_TICK, 1, 1, 25);
const DEDICATED_WORKER_COHORT_KEY = String(process.env.STICKER_DEDICATED_WORKER_COHORT_KEY || process.env.HOSTNAME || process.pid).trim() || 'worker';

const SUPPORTED_TASK_TYPES = new Set(['classification_cycle', 'curation_cycle', 'rebuild_cycle']);

const normalizeTaskType = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return SUPPORTED_TASK_TYPES.has(normalized) ? normalized : null;
};

const runTaskHandler = async (taskType, payload = {}) => {
  if (taskType === 'classification_cycle') {
    return runStickerClassificationCycle({
      processPending: true,
      processReprocess: true,
      processDeterministic: true,
      ...payload,
    });
  }
  if (taskType === 'curation_cycle') {
    return runStickerAutoPackByTagsCycle({
      enableAdditions: true,
      enableRebuild: false,
      ...payload,
    });
  }
  if (taskType === 'rebuild_cycle') {
    return runStickerAutoPackByTagsCycle({
      enableAdditions: false,
      enableRebuild: true,
      ...payload,
    });
  }
  throw new Error(`unsupported_task_type:${taskType}`);
};

const refreshQueueDepthMetrics = async () => {
  const [pending, processing, failed] = await Promise.all([countWorkerTasksByStatus('pending'), countWorkerTasksByStatus('processing'), countWorkerTasksByStatus('failed')]);
  setQueueDepth('sticker_worker_tasks_pending', pending);
  setQueueDepth('sticker_worker_tasks_processing', processing);
  setQueueDepth('sticker_worker_tasks_failed', failed);
};

const canRunDedicatedWorkers = async (taskType) => {
  if (!DEDICATED_WORKERS_ENABLED) return false;
  if (DEDICATED_WORKERS_FORCE_ENABLED) return true;
  return isFeatureEnabled('enable_worker_dedicated_processes', {
    fallback: false,
    subjectKey: `worker:${taskType}:${DEDICATED_WORKER_COHORT_KEY}`,
  });
};

export const isSupportedStickerWorkerTaskType = (taskType) => Boolean(normalizeTaskType(taskType));

export const runDedicatedStickerWorkerTick = async ({ taskType, maxTasks = DEDICATED_WORKER_MAX_TASKS_PER_TICK, retryDelaySeconds = DEDICATED_WORKER_RETRY_DELAY_SECONDS } = {}) => {
  const normalizedTaskType = normalizeTaskType(taskType);
  if (!normalizedTaskType) {
    return { executed: false, reason: 'invalid_task_type', task_type: taskType || null };
  }

  const enabled = await canRunDedicatedWorkers(normalizedTaskType);
  if (!enabled) {
    return { executed: false, reason: 'feature_disabled', task_type: normalizedTaskType };
  }

  const safeMaxTasks = clampInt(maxTasks, DEDICATED_WORKER_MAX_TASKS_PER_TICK, 1, 25);
  const stats = {
    executed: true,
    task_type: normalizedTaskType,
    claimed: 0,
    completed: 0,
    failed: 0,
  };

  for (let i = 0; i < safeMaxTasks; i += 1) {
    const task = await claimWorkerTask({ taskType: normalizedTaskType });
    if (!task) break;

    stats.claimed += 1;

    try {
      await runTaskHandler(normalizedTaskType, task.payload || {});
      await completeWorkerTask(task.id);
      stats.completed += 1;
    } catch (error) {
      stats.failed += 1;
      await failWorkerTask(task.id, {
        error: error?.message || 'dedicated_worker_task_failed',
        retryDelaySeconds,
      });

      logger.warn('Task falhou no worker dedicado.', {
        action: 'sticker_dedicated_worker_task_failed',
        task_type: normalizedTaskType,
        task_id: task.id,
        attempts: task.attempts,
        error: error?.message,
      });
    }
  }

  if (stats.claimed > 0) {
    await refreshQueueDepthMetrics().catch(() => null);
  }

  return stats;
};

export const startDedicatedStickerWorker = ({ taskType, pollIntervalMs = DEDICATED_WORKER_POLL_INTERVAL_MS, maxTasksPerTick = DEDICATED_WORKER_MAX_TASKS_PER_TICK, retryDelaySeconds = DEDICATED_WORKER_RETRY_DELAY_SECONDS, label = '' } = {}) => {
  const normalizedTaskType = normalizeTaskType(taskType);
  if (!normalizedTaskType) {
    throw new Error(`invalid_task_type:${taskType}`);
  }

  const safePollIntervalMs = clampInt(pollIntervalMs, DEDICATED_WORKER_POLL_INTERVAL_MS, 250, 60_000);
  let tickInFlight = false;
  let stopped = false;

  const runTick = async () => {
    if (stopped || tickInFlight) return;
    tickInFlight = true;
    try {
      await runDedicatedStickerWorkerTick({
        taskType: normalizedTaskType,
        maxTasks: maxTasksPerTick,
        retryDelaySeconds,
      });
    } catch (error) {
      if (error?.code !== 'ER_NO_SUCH_TABLE') {
        logger.error('Falha no worker dedicado de sticker.', {
          action: 'sticker_dedicated_worker_tick_failed',
          task_type: normalizedTaskType,
          error: error?.message,
        });
      }
    } finally {
      tickInFlight = false;
    }
  };

  const intervalHandle = setInterval(() => {
    void runTick();
  }, safePollIntervalMs);
  if (typeof intervalHandle?.unref === 'function') {
    intervalHandle.unref();
  }

  void runTick();

  logger.info('Worker dedicado de sticker iniciado.', {
    action: 'sticker_dedicated_worker_started',
    task_type: normalizedTaskType,
    poll_interval_ms: safePollIntervalMs,
    max_tasks_per_tick: maxTasksPerTick,
    label: label || null,
  });

  return {
    taskType: normalizedTaskType,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(intervalHandle);
      logger.info('Worker dedicado de sticker encerrado.', {
        action: 'sticker_dedicated_worker_stopped',
        task_type: normalizedTaskType,
        label: label || null,
      });
    },
  };
};
