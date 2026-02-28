#!/usr/bin/env node
import 'dotenv/config';

import logger from '../app/utils/logger/loggerModule.js';
import initializeDatabase from '../database/init.js';
import { closePool } from '../database/index.js';
import { isSupportedStickerWorkerTaskType, startDedicatedStickerWorker } from '../app/modules/stickerPackModule/stickerDedicatedTaskWorkerRuntime.js';

const parseCliArgs = (argv = []) => {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(token, true);
      continue;
    }
    args.set(token, next);
    index += 1;
  }
  return args;
};

const args = parseCliArgs(process.argv.slice(2));
const workerTaskType = String(args.get('--task-type') || process.env.STICKER_WORKER_TASK_TYPE || '')
  .trim()
  .toLowerCase();

if (!isSupportedStickerWorkerTaskType(workerTaskType)) {
  logger.error('Tipo de task inválido para worker dedicado.', {
    action: 'sticker_worker_task_invalid_type',
    task_type: workerTaskType || null,
  });
  process.exit(1);
}

let shuttingDown = false;
let workerHandle = null;

const shutdown = async (signal, error = null) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn('Encerrando worker dedicado de sticker.', {
    action: 'sticker_worker_task_shutdown',
    signal,
    task_type: workerTaskType,
    error: error?.message || null,
  });

  try {
    workerHandle?.stop?.();
  } catch (stopError) {
    logger.warn('Falha ao encerrar loop do worker dedicado.', {
      action: 'sticker_worker_task_stop_failed',
      task_type: workerTaskType,
      error: stopError?.message,
    });
  }

  try {
    await closePool();
  } catch (poolError) {
    logger.warn('Falha ao encerrar pool MySQL no worker dedicado.', {
      action: 'sticker_worker_task_pool_close_failed',
      task_type: workerTaskType,
      error: poolError?.message,
    });
  }

  process.exit(error ? 1 : 0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('uncaughtException', (error) => {
  logger.error('Exceção não capturada no worker dedicado de sticker.', {
    action: 'sticker_worker_task_uncaught_exception',
    task_type: workerTaskType,
    error: error?.message,
    stack: error?.stack,
  });
  void shutdown('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason || '');
  logger.error('Promise rejeitada sem tratamento no worker dedicado de sticker.', {
    action: 'sticker_worker_task_unhandled_rejection',
    task_type: workerTaskType,
    error: message,
  });
  void shutdown('unhandledRejection', reason instanceof Error ? reason : new Error(message));
});

const start = async () => {
  await initializeDatabase();
  workerHandle = startDedicatedStickerWorker({
    taskType: workerTaskType,
    label: `process:${process.pid}`,
  });
};

start().catch((error) => {
  logger.error('Falha ao inicializar worker dedicado de sticker.', {
    action: 'sticker_worker_task_start_failed',
    task_type: workerTaskType,
    error: error?.message,
    stack: error?.stack,
  });
  void shutdown('startup_error', error);
});
