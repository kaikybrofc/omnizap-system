# Sticker 10x Hardening And Rollout

## Scope

This runbook covers phases 4-8 of the sticker-pack scale plan:

1. ranking snapshot read path
2. internal outbox/event consumer
3. dedicated workers (classification/curation/rebuild)
4. object storage delivery with secure URLs
5. canary rollout, rollback, and final tuning

## Feature Flags

Flags are stored in `feature_flag`:

- `enable_ranking_snapshot_read`
- `enable_domain_event_outbox`
- `enable_worker_dedicated_processes`
- `enable_object_storage_delivery`

### Query Current Status

```sql
SELECT flag_name, is_enabled, rollout_percent, updated_at
FROM feature_flag
WHERE flag_name IN (
  'enable_ranking_snapshot_read',
  'enable_domain_event_outbox',
  'enable_worker_dedicated_processes',
  'enable_object_storage_delivery'
)
ORDER BY flag_name;
```

### Update Rollout Percent

```sql
UPDATE feature_flag
SET is_enabled = 1, rollout_percent = 25, updated_by = 'ops'
WHERE flag_name = 'enable_worker_dedicated_processes';
```

### Emergency Disable

```sql
UPDATE feature_flag
SET is_enabled = 0, rollout_percent = 0, updated_by = 'ops'
WHERE flag_name IN (
  'enable_worker_dedicated_processes',
  'enable_object_storage_delivery',
  'enable_domain_event_outbox'
);
```

## Canary Sequence

1. `enable_ranking_snapshot_read`: 10% -> 50% -> 100%
2. `enable_domain_event_outbox`: 10% -> 50% -> 100%
3. start dedicated worker processes and set `enable_worker_dedicated_processes`: 10% -> 50% -> 100%
4. `enable_object_storage_delivery`: 5% -> 25% -> 100%

Promotion gate for each step:

- HTTP p95 within target
- queue backlog stable (`pending`, `failed`)
- outbox DLQ not growing unexpectedly
- no sustained error-rate increase

## Dedicated Workers

Run workers as isolated processes:

```bash
npm run worker:sticker:classification
npm run worker:sticker:curation
npm run worker:sticker:rebuild
```

PM2 production profile includes these workers in `ecosystem.prod.config.cjs`.

## 10x Validation

### HTTP Stress

```bash
npm run loadtest:stickers -- --base-url http://127.0.0.1:9102 --duration-seconds 120 --concurrency 200 --slo-ms 750
```

### Queue/Worker Validation

Monitor:

- `sticker_worker_tasks_pending`
- `sticker_worker_tasks_processing`
- `sticker_worker_tasks_failed`
- `domain_event_outbox_pending`
- `domain_event_outbox_failed`

Acceptance:

- failed queues remain near zero (transient spikes allowed)
- pending queues recover after load burst
- no monotonic growth in DLQ tables

## Rollback Plan

1. Disable `enable_object_storage_delivery`.
2. Disable `enable_worker_dedicated_processes` (inline poller resumes).
3. Disable `enable_domain_event_outbox` if event flow is unstable.
4. Keep `enable_ranking_snapshot_read` enabled only if snapshot freshness is healthy.

Data safety notes:

- tasks/events are persisted in SQL queues
- failed terminal tasks/events are preserved in DLQ tables
- local disk read path remains fallback for sticker asset serving

## Post-Rollout Tuning

Tune these env vars after baseline:

- `STICKER_WORKER_CLASSIFICATION_CADENCE_MS`
- `STICKER_WORKER_CURATION_CADENCE_MS`
- `STICKER_WORKER_REBUILD_CADENCE_MS`
- `STICKER_DEDICATED_WORKER_POLL_INTERVAL_MS`
- `STICKER_SCORE_SNAPSHOT_REFRESH_INTERVAL_MS`
- `STICKER_OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS`
