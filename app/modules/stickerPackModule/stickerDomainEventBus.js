import logger from '../../utils/logger/loggerModule.js';
import { isFeatureEnabled } from '../../services/featureFlagService.js';
import { enqueueDomainEvent } from './domainEventOutboxRepository.js';

const resolveDefaultIdempotencyKey = ({
  eventType,
  aggregateType,
  aggregateId,
  payload = null,
}) => {
  const payloadKey = payload && typeof payload === 'object' ? JSON.stringify(payload).slice(0, 80) : '';
  return `${eventType}:${aggregateType}:${aggregateId}:${payloadKey}`.slice(0, 180);
};

export const publishStickerDomainEvent = async (
  eventPayload,
  { connection = null, force = false } = {},
) => {
  const eventType = String(eventPayload?.eventType || '').trim();
  const aggregateType = String(eventPayload?.aggregateType || '').trim();
  const aggregateId = String(eventPayload?.aggregateId || '').trim();

  if (!eventType || !aggregateType || !aggregateId) return false;

  const enabled = force ? true : await isFeatureEnabled('enable_domain_event_outbox', {
    fallback: true,
    subjectKey: `${aggregateType}:${aggregateId}`,
  });
  if (!enabled) return false;

  try {
    const idempotencyKey =
      String(eventPayload?.idempotencyKey || '').trim()
      || resolveDefaultIdempotencyKey({
        eventType,
        aggregateType,
        aggregateId,
        payload: eventPayload?.payload || null,
      });

    return await enqueueDomainEvent(
      {
        eventType,
        aggregateType,
        aggregateId,
        payload: eventPayload?.payload || null,
        priority: eventPayload?.priority ?? 50,
        availableAt: eventPayload?.availableAt || null,
        maxAttempts: eventPayload?.maxAttempts ?? 10,
        idempotencyKey,
      },
      connection,
    );
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      logger.warn('Outbox indisponível; evento de domínio descartado.', {
        action: 'sticker_domain_event_outbox_unavailable',
        event_type: eventType,
      });
      return false;
    }
    logger.warn('Falha ao publicar evento de domínio.', {
      action: 'sticker_domain_event_publish_failed',
      event_type: eventType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      error: error?.message,
    });
    return false;
  }
};
