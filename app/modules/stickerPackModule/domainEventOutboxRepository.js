import { randomUUID } from 'node:crypto';

import { executeQuery, TABLES } from '../../../database/index.js';
import { normalizeDomainEventPayload } from './domainEvents.js';

const normalizeStatus = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (['pending', 'processing', 'completed', 'failed'].includes(normalized)) return normalized;
  return null;
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

const clampInt = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const CLAIM_LOCK_TIMEOUT_SECONDS = clampInt(process.env.DOMAIN_EVENT_OUTBOX_LOCK_TIMEOUT_SECONDS, 15 * 60, 30, 24 * 60 * 60);

const normalizeRow = (row) => {
  if (!row) return null;
  return {
    id: Number(row.id),
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    payload: parseJson(row.payload, {}),
    status: row.status,
    priority: Number(row.priority || 0),
    idempotency_key: row.idempotency_key || null,
    available_at: row.available_at || null,
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

export async function enqueueDomainEvent(eventPayload, connection = null) {
  const normalized = normalizeDomainEventPayload(eventPayload);
  if (!normalized) return false;

  await executeQuery(
    `INSERT INTO ${TABLES.DOMAIN_EVENT_OUTBOX}
      (
        event_type,
        aggregate_type,
        aggregate_id,
        payload,
        status,
        priority,
        idempotency_key,
        available_at,
        attempts,
        max_attempts
      )
     VALUES (?, ?, ?, ?, 'pending', ?, ?, COALESCE(?, UTC_TIMESTAMP()), 0, ?)
     ON DUPLICATE KEY UPDATE
      priority = GREATEST(priority, VALUES(priority)),
      available_at = LEAST(available_at, VALUES(available_at)),
      updated_at = CURRENT_TIMESTAMP`,
    [normalized.event_type, normalized.aggregate_type, normalized.aggregate_id, JSON.stringify(normalized.payload ?? {}), normalized.priority, normalized.idempotency_key, normalized.available_at, normalized.max_attempts],
    connection,
  );
  return true;
}

export async function claimDomainEvent({ eventTypes = [], allowRetryFailed = true } = {}, connection = null) {
  const workerToken = randomUUID();
  const statusClause = allowRetryFailed
    ? `(status = 'pending'
      OR (status = 'failed' AND attempts < max_attempts)
      OR (status = 'processing' AND locked_at <= (UTC_TIMESTAMP() - INTERVAL ${CLAIM_LOCK_TIMEOUT_SECONDS} SECOND)))`
    : `(status = 'pending'
      OR (status = 'processing' AND locked_at <= (UTC_TIMESTAMP() - INTERVAL ${CLAIM_LOCK_TIMEOUT_SECONDS} SECOND)))`;

  const normalizedTypes = Array.from(
    new Set(
      (Array.isArray(eventTypes) ? eventTypes : [])
        .map((type) =>
          String(type || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  );

  let eventTypeClause = '';
  let params = [workerToken];
  if (normalizedTypes.length) {
    eventTypeClause = `AND event_type IN (${normalizedTypes.map(() => '?').join(', ')})`;
    params = [workerToken, ...normalizedTypes];
  }

  await executeQuery(
    `UPDATE ${TABLES.DOMAIN_EVENT_OUTBOX}
     SET status = 'processing',
         worker_token = ?,
         locked_at = UTC_TIMESTAMP(),
         attempts = attempts + 1,
         updated_at = UTC_TIMESTAMP()
     WHERE id = (
       SELECT id FROM (
         SELECT id
         FROM ${TABLES.DOMAIN_EVENT_OUTBOX}
         WHERE ${statusClause}
           ${eventTypeClause}
           AND available_at <= UTC_TIMESTAMP()
         ORDER BY priority DESC, available_at ASC, id ASC
         LIMIT 1
       ) picked
     )`,
    params,
    connection,
  );

  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.DOMAIN_EVENT_OUTBOX}
     WHERE worker_token = ?
       AND status = 'processing'
     ORDER BY id DESC
     LIMIT 1`,
    [workerToken],
    connection,
  );

  return normalizeRow(rows?.[0] || null);
}

export async function completeDomainEvent(eventId, connection = null) {
  if (!eventId) return false;
  await executeQuery(
    `UPDATE ${TABLES.DOMAIN_EVENT_OUTBOX}
     SET status = 'completed',
         processed_at = UTC_TIMESTAMP(),
         worker_token = NULL,
         locked_at = NULL,
         last_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [eventId],
    connection,
  );
  return true;
}

export async function failDomainEvent(eventId, { error = null, retryDelaySeconds = 0 } = {}, connection = null) {
  if (!eventId) return false;

  const safeDelay = clampInt(retryDelaySeconds, 0, 0, 86400 * 7);
  const message =
    String(error || '')
      .trim()
      .slice(0, 255) || null;

  await executeQuery(
    `UPDATE ${TABLES.DOMAIN_EVENT_OUTBOX}
     SET status = IF(attempts >= max_attempts, 'failed', 'pending'),
         worker_token = NULL,
         locked_at = NULL,
         last_error = ?,
         available_at = IF(attempts >= max_attempts, available_at, UTC_TIMESTAMP() + INTERVAL ${safeDelay} SECOND),
         updated_at = CURRENT_TIMESTAMP,
         processed_at = IF(attempts >= max_attempts, UTC_TIMESTAMP(), processed_at)
     WHERE id = ?`,
    [message, eventId],
    connection,
  );

  await executeQuery(
    `INSERT INTO ${TABLES.DOMAIN_EVENT_OUTBOX_DLQ}
      (outbox_event_id, event_type, aggregate_type, aggregate_id, payload, attempts, max_attempts, last_error)
     SELECT id, event_type, aggregate_type, aggregate_id, payload, attempts, max_attempts, last_error
       FROM ${TABLES.DOMAIN_EVENT_OUTBOX}
      WHERE id = ?
        AND status = 'failed'
     ON DUPLICATE KEY UPDATE
      last_error = VALUES(last_error),
      attempts = VALUES(attempts),
      max_attempts = VALUES(max_attempts),
      failed_at = CURRENT_TIMESTAMP`,
    [eventId],
    connection,
  ).catch(() => null);
  return true;
}

export async function countDomainEventsByStatus(status = 'pending', connection = null) {
  const normalized = normalizeStatus(status);
  if (!normalized) return 0;
  const rows = await executeQuery(
    `SELECT COUNT(*) AS total
     FROM ${TABLES.DOMAIN_EVENT_OUTBOX}
     WHERE status = ?`,
    [normalized],
    connection,
  );
  return Number(rows?.[0]?.total || 0);
}
