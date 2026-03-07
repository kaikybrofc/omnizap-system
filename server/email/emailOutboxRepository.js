import { randomUUID } from 'node:crypto';

import { executeQuery, TABLES } from '../../database/index.js';

const STATUS_VALUES = new Set(['pending', 'processing', 'sent', 'failed']);

const clampInt = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const CLAIM_LOCK_TIMEOUT_SECONDS = clampInt(
  process.env.EMAIL_OUTBOX_LOCK_TIMEOUT_SECONDS,
  15 * 60,
  30,
  24 * 60 * 60,
);

const normalizeStatus = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return STATUS_VALUES.has(normalized) ? normalized : null;
};

const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 255);

const normalizeIdempotencyKey = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_:-]/g, '')
    .slice(0, 180);

const normalizeTemplateKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '')
    .slice(0, 64);

const normalizeSubject = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 180);

const normalizeNullableText = (value, maxLength = 200_000) => {
  const normalized =
    String(value || '')
      .trim()
      .slice(0, maxLength) || '';
  return normalized || null;
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
    recipient_email: normalizeEmail(row.recipient_email),
    recipient_name:
      String(row.recipient_name || '')
        .trim()
        .slice(0, 120) || null,
    subject: normalizeSubject(row.subject),
    text_body: row.text_body || null,
    html_body: row.html_body || null,
    template_key: normalizeTemplateKey(row.template_key) || null,
    template_payload: parseJson(row.template_payload, {}),
    metadata: parseJson(row.metadata, {}),
    status: normalizeStatus(row.status) || 'pending',
    priority: Number(row.priority || 0),
    idempotency_key: row.idempotency_key || null,
    available_at: row.available_at || null,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    worker_token: row.worker_token || null,
    provider_message_id: row.provider_message_id || null,
    last_error: row.last_error || null,
    locked_at: row.locked_at || null,
    sent_at: row.sent_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

export async function enqueueEmailOutbox(
  {
    recipientEmail,
    recipientName = '',
    subject,
    textBody = null,
    htmlBody = null,
    templateKey = '',
    templatePayload = {},
    metadata = {},
    priority = 50,
    scheduledAt = null,
    maxAttempts = 5,
    idempotencyKey = '',
  } = {},
  connection = null,
) {
  const normalizedRecipientEmail = normalizeEmail(recipientEmail);
  const normalizedSubject = normalizeSubject(subject);
  const normalizedTextBody = normalizeNullableText(textBody, 120_000);
  const normalizedHtmlBody = normalizeNullableText(htmlBody, 500_000);

  if (!normalizedRecipientEmail || !normalizedRecipientEmail.includes('@')) return null;
  if (!normalizedSubject) return null;
  if (!normalizedTextBody && !normalizedHtmlBody) return null;

  const normalizedRecipientName =
    String(recipientName || '')
      .trim()
      .slice(0, 120) || null;
  const normalizedTemplateKey = normalizeTemplateKey(templateKey) || null;
  const normalizedTemplatePayload =
    templatePayload && typeof templatePayload === 'object' && !Array.isArray(templatePayload)
      ? templatePayload
      : {};
  const normalizedMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const safePriority = clampInt(priority, 50, 1, 100);
  const safeMaxAttempts = clampInt(maxAttempts, 5, 1, 20);
  const safeScheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  const scheduledValue =
    safeScheduledAt && Number.isFinite(safeScheduledAt.valueOf()) ? safeScheduledAt : null;
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey) || null;

  const result = await executeQuery(
    `INSERT INTO ${TABLES.EMAIL_OUTBOX}
      (recipient_email, recipient_name, subject, text_body, html_body, template_key, template_payload, metadata, status, priority, idempotency_key, available_at, attempts, max_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, COALESCE(?, UTC_TIMESTAMP()), 0, ?)
     ON DUPLICATE KEY UPDATE
      id = LAST_INSERT_ID(id),
      subject = IF(status IN ('pending', 'failed'), VALUES(subject), subject),
      text_body = IF(status IN ('pending', 'failed'), VALUES(text_body), text_body),
      html_body = IF(status IN ('pending', 'failed'), VALUES(html_body), html_body),
      template_key = IF(status IN ('pending', 'failed'), VALUES(template_key), template_key),
      template_payload = IF(status IN ('pending', 'failed'), VALUES(template_payload), template_payload),
      metadata = IF(status IN ('pending', 'failed'), VALUES(metadata), metadata),
      priority = GREATEST(priority, VALUES(priority)),
      available_at = LEAST(available_at, VALUES(available_at)),
      status = IF(status = 'failed' AND attempts < max_attempts, 'pending', status),
      updated_at = UTC_TIMESTAMP()`,
    [
      normalizedRecipientEmail,
      normalizedRecipientName,
      normalizedSubject,
      normalizedTextBody,
      normalizedHtmlBody,
      normalizedTemplateKey,
      JSON.stringify(normalizedTemplatePayload),
      JSON.stringify(normalizedMetadata),
      safePriority,
      normalizedIdempotencyKey,
      scheduledValue,
      safeMaxAttempts,
    ],
    connection,
  );

  const insertedId = Number(result?.insertId || 0);
  return Number.isFinite(insertedId) && insertedId > 0 ? insertedId : null;
}

export async function claimEmailOutboxTask({ allowRetryFailed = true } = {}, connection = null) {
  const workerToken = randomUUID();
  const statusClause = allowRetryFailed
    ? `(status = 'pending'
      OR (status = 'failed' AND attempts < max_attempts)
      OR (status = 'processing' AND locked_at <= (UTC_TIMESTAMP() - INTERVAL ${CLAIM_LOCK_TIMEOUT_SECONDS} SECOND)))`
    : `(status = 'pending'
      OR (status = 'processing' AND locked_at <= (UTC_TIMESTAMP() - INTERVAL ${CLAIM_LOCK_TIMEOUT_SECONDS} SECOND)))`;

  await executeQuery(
    `UPDATE ${TABLES.EMAIL_OUTBOX}
     SET status = 'processing',
         worker_token = ?,
         locked_at = UTC_TIMESTAMP(),
         attempts = attempts + 1,
         updated_at = UTC_TIMESTAMP()
     WHERE id = (
       SELECT id FROM (
         SELECT id
         FROM ${TABLES.EMAIL_OUTBOX}
         WHERE ${statusClause}
           AND available_at <= UTC_TIMESTAMP()
         ORDER BY priority DESC, available_at ASC, id ASC
         LIMIT 1
       ) picked
     )`,
    [workerToken],
    connection,
  );

  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.EMAIL_OUTBOX}
     WHERE worker_token = ?
       AND status = 'processing'
     ORDER BY id DESC
     LIMIT 1`,
    [workerToken],
    connection,
  );

  return normalizeRow(rows?.[0] || null);
}

export async function completeEmailOutboxTask(
  taskId,
  { providerMessageId = '' } = {},
  connection = null,
) {
  if (!taskId) return false;
  const normalizedProviderMessageId =
    String(providerMessageId || '')
      .trim()
      .slice(0, 255) || null;

  await executeQuery(
    `UPDATE ${TABLES.EMAIL_OUTBOX}
     SET status = 'sent',
         provider_message_id = ?,
         sent_at = UTC_TIMESTAMP(),
         worker_token = NULL,
         locked_at = NULL,
         last_error = NULL,
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [normalizedProviderMessageId, taskId],
    connection,
  );

  return true;
}

export async function failEmailOutboxTask(
  taskId,
  { error = null, retryDelaySeconds = 0 } = {},
  connection = null,
) {
  if (!taskId) return false;

  const safeDelay = clampInt(retryDelaySeconds, 0, 0, 86400 * 7);
  const normalizedError =
    String(error || '')
      .trim()
      .slice(0, 255) || null;

  await executeQuery(
    `UPDATE ${TABLES.EMAIL_OUTBOX}
     SET status = IF(attempts >= max_attempts, 'failed', 'pending'),
         worker_token = NULL,
         locked_at = NULL,
         last_error = ?,
         available_at = IF(attempts >= max_attempts, available_at, UTC_TIMESTAMP() + INTERVAL ${safeDelay} SECOND),
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [normalizedError, taskId],
    connection,
  );

  return true;
}

export async function countEmailOutboxByStatus(status = 'pending', connection = null) {
  const normalizedStatus = normalizeStatus(status);
  if (!normalizedStatus) return 0;

  const rows = await executeQuery(
    `SELECT COUNT(*) AS total
     FROM ${TABLES.EMAIL_OUTBOX}
     WHERE status = ?`,
    [normalizedStatus],
    connection,
  );

  return Number(rows?.[0]?.total || 0);
}

export async function getEmailOutboxStatusSnapshot(connection = null) {
  const rows = await executeQuery(
    `SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      COUNT(*) AS total
     FROM ${TABLES.EMAIL_OUTBOX}`,
    [],
    connection,
  );

  const row = rows?.[0] || {};
  return {
    pending: Number(row.pending || 0),
    processing: Number(row.processing || 0),
    sent: Number(row.sent || 0),
    failed: Number(row.failed || 0),
    total: Number(row.total || 0),
  };
}
