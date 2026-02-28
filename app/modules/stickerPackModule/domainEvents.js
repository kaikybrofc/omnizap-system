export const STICKER_DOMAIN_EVENTS = Object.freeze({
  STICKER_ASSET_CREATED: 'STICKER_ASSET_CREATED',
  STICKER_CLASSIFIED: 'STICKER_CLASSIFIED',
  PACK_UPDATED: 'PACK_UPDATED',
  ENGAGEMENT_RECORDED: 'ENGAGEMENT_RECORDED',
});

export const STICKER_DOMAIN_EVENT_TYPES = new Set(Object.values(STICKER_DOMAIN_EVENTS));

const normalizeType = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 96);

const normalizeAggregateType = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '')
    .slice(0, 96);

const normalizeAggregateId = (value) =>
  String(value || '')
    .trim()
    .slice(0, 128);

const normalizeIdempotencyKey = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_:-]/g, '')
    .slice(0, 180);

export const normalizeDomainEventPayload = ({ eventType, aggregateType, aggregateId, payload = null, priority = 50, availableAt = null, idempotencyKey = '', maxAttempts = 10 } = {}) => {
  const normalizedType = normalizeType(eventType);
  if (!normalizedType) return null;
  const normalizedAggregateType = normalizeAggregateType(aggregateType);
  const normalizedAggregateId = normalizeAggregateId(aggregateId);
  if (!normalizedAggregateType || !normalizedAggregateId) return null;

  return {
    event_type: normalizedType,
    aggregate_type: normalizedAggregateType,
    aggregate_id: normalizedAggregateId,
    payload: payload && typeof payload === 'object' ? payload : (payload ?? null),
    priority: Math.max(1, Math.min(100, Number(priority) || 50)),
    available_at: availableAt ? new Date(availableAt) : null,
    idempotency_key: normalizeIdempotencyKey(idempotencyKey) || null,
    max_attempts: Math.max(1, Math.min(30, Number(maxAttempts) || 10)),
  };
};
