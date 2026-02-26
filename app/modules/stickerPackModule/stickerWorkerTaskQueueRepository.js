import { randomUUID } from 'node:crypto';

import { executeQuery, TABLES } from '../../../database/index.js';

const normalizeTaskType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['classification_cycle', 'curation_cycle', 'rebuild_cycle'].includes(normalized)) return normalized;
  return null;
};

const normalizeStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['pending', 'processing', 'completed', 'failed'].includes(normalized)) return normalized;
  return null;
};

const clampInt = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  if (Buffer.isBuffer(value)) {
    try {
      return JSON.parse(value.toString('utf8'));
    } catch {
      return fallback;
    }
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
};

const normalizeRow = (row) => {
  if (!row) return null;
  return {
    id: Number(row.id),
    task_type: row.task_type,
    payload: parseJson(row.payload, {}),
    priority: Number(row.priority || 0),
    scheduled_at: row.scheduled_at || null,
    status: row.status,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    worker_token: row.worker_token || null,
    last_error: row.last_error || null,
    locked_at: row.locked_at || null,
    processed_at: row.processed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

export async function enqueueWorkerTask(
  { taskType, payload = {}, priority = 50, scheduledAt = null, maxAttempts = 5 },
  connection = null,
) {
  const normalizedTaskType = normalizeTaskType(taskType);
  if (!normalizedTaskType) return false;

  const safePriority = clampInt(priority, 50, 1, 100);
  const safeMaxAttempts = clampInt(maxAttempts, 5, 1, 20);
  const safeScheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  const scheduledValue = safeScheduledAt && Number.isFinite(safeScheduledAt.valueOf()) ? safeScheduledAt : null;

  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_WORKER_TASK_QUEUE}
      (task_type, payload, priority, scheduled_at, status, attempts, max_attempts)
     VALUES (?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), 'pending', 0, ?)`,
    [normalizedTaskType, JSON.stringify(payload || {}), safePriority, scheduledValue, safeMaxAttempts],
    connection,
  );
  return true;
}

export async function hasPendingWorkerTask(taskType, connection = null) {
  const normalizedTaskType = normalizeTaskType(taskType);
  if (!normalizedTaskType) return false;

  const rows = await executeQuery(
    `SELECT id
     FROM ${TABLES.STICKER_WORKER_TASK_QUEUE}
     WHERE task_type = ?
       AND status IN ('pending', 'processing')
     LIMIT 1`,
    [normalizedTaskType],
    connection,
  );
  return rows.length > 0;
}

export async function claimWorkerTask({ taskType, allowRetryFailed = true } = {}, connection = null) {
  const normalizedTaskType = normalizeTaskType(taskType);
  if (!normalizedTaskType) return null;

  const workerToken = randomUUID();
  const statusClause = allowRetryFailed
    ? "(status = 'pending' OR (status = 'failed' AND attempts < max_attempts))"
    : "status = 'pending'";

  await executeQuery(
    `UPDATE ${TABLES.STICKER_WORKER_TASK_QUEUE}
     SET status = 'processing',
         worker_token = ?,
         locked_at = UTC_TIMESTAMP(),
         attempts = attempts + 1,
         updated_at = UTC_TIMESTAMP()
     WHERE id = (
       SELECT id FROM (
         SELECT id
         FROM ${TABLES.STICKER_WORKER_TASK_QUEUE}
         WHERE task_type = ?
           AND ${statusClause}
           AND scheduled_at <= UTC_TIMESTAMP()
         ORDER BY priority DESC, scheduled_at ASC, id ASC
         LIMIT 1
       ) pick
     )`,
    [workerToken, normalizedTaskType],
    connection,
  );

  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.STICKER_WORKER_TASK_QUEUE}
     WHERE worker_token = ?
       AND status = 'processing'
     ORDER BY id DESC
     LIMIT 1`,
    [workerToken],
    connection,
  );

  return normalizeRow(rows?.[0] || null);
}

export async function completeWorkerTask(taskId, connection = null) {
  if (!taskId) return false;
  await executeQuery(
    `UPDATE ${TABLES.STICKER_WORKER_TASK_QUEUE}
     SET status = 'completed',
         processed_at = UTC_TIMESTAMP(),
         worker_token = NULL,
         locked_at = NULL,
         last_error = NULL,
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [taskId],
    connection,
  );
  return true;
}

export async function failWorkerTask(
  taskId,
  {
    error = null,
    retryDelaySeconds = 0,
  } = {},
  connection = null,
) {
  if (!taskId) return false;
  const safeDelay = clampInt(retryDelaySeconds, 0, 0, 86400 * 7);
  const message = String(error || '').trim().slice(0, 255) || null;

  await executeQuery(
    `UPDATE ${TABLES.STICKER_WORKER_TASK_QUEUE}
     SET status = IF(attempts >= max_attempts, 'failed', 'pending'),
         worker_token = NULL,
         locked_at = NULL,
         last_error = ?,
         scheduled_at = IF(attempts >= max_attempts, scheduled_at, UTC_TIMESTAMP() + INTERVAL ${safeDelay} SECOND),
         updated_at = UTC_TIMESTAMP(),
         processed_at = IF(attempts >= max_attempts, UTC_TIMESTAMP(), processed_at)
     WHERE id = ?`,
    [message, taskId],
    connection,
  );
  return true;
}

export async function countWorkerTasksByStatus(status = 'pending', connection = null) {
  const normalizedStatus = normalizeStatus(status);
  if (!normalizedStatus) return 0;

  const rows = await executeQuery(
    `SELECT COUNT(*) AS total
     FROM ${TABLES.STICKER_WORKER_TASK_QUEUE}
     WHERE status = ?`,
    [normalizedStatus],
    connection,
  );
  return Number(rows?.[0]?.total || 0);
}
