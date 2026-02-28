# Sticker Catalog 10x Baseline e SLOs

Este documento define a baseline operacional da camada HTTP + pipeline de classificação para o módulo de stickers.

## 1. Metas SLO (fase inicial)

### HTTP catálogo (`/api/sticker-packs*`, `/stickers*`, `/api/marketplace/stats`)

- **Latência p95**: `<= 750ms`
- **Latência p99**: `<= 1500ms`
- **Taxa de erro (5xx + timeout)**: `<= 2%` por janela de 5 minutos
- **Throughput alvo**: escalar linearmente com workers/processos sem aumento abrupto do p95

### Classificação de stickers

- **Duração média do ciclo**: `<= 10s`
- **Throughput mínimo (assets classificados/min)**: `>= 300` (ajustar por hardware)
- **Backlog de fila (`sticker_reprocess_pending`)**: tendência de queda após picos; alerta se cresce por mais de 15 min

## 2. Métricas instrumentadas

### HTTP

- `omnizap_http_requests_total{route_group,method,status_class}`
- `omnizap_http_request_duration_ms{route_group,method,status_class}`
- `omnizap_http_slo_violation_total{route_group,method}`

`route_group` segmenta tráfego em:

- `catalog_api_public`
- `catalog_api_auth`
- `catalog_api_admin`
- `catalog_api_upload`
- `catalog_web`
- `catalog_data_asset`
- `catalog_user_profile`
- `marketplace_stats`
- `metrics`
- `other`

### Classificação

- `omnizap_sticker_classification_cycle_duration_ms{status}`
- `omnizap_sticker_classification_cycle_total{status}`
- `omnizap_sticker_classification_assets_total{outcome}`
- `omnizap_queue_depth{queue}`

## 3. Tracing mínimo

- Cada request HTTP agora recebe/propaga `X-Request-Id`.
- Se o cliente enviar `X-Request-Id`, o valor é reaproveitado.
- Sem header, o servidor gera UUID.

## 4. Baseline de carga (script local)

Script: `scripts/sticker-catalog-loadtest.mjs`

Exemplo:

```bash
node scripts/sticker-catalog-loadtest.mjs \
  --base-url http://127.0.0.1:9102 \
  --duration-seconds 60 \
  --concurrency 40 \
  --paths "/api/sticker-packs?limit=24&sort=popular,/api/sticker-packs/stats,/api/sticker-packs/creators?limit=25" \
  --out /tmp/sticker-loadtest-report.json
```

Interpretação rápida:

- `latency_ms.p95 <= 750` = SLO de latência cumprido
- `error_rate <= 0.02` = estabilidade aceitável
- `throughput_rps` = referência para comparar antes/depois de otimizações

## 5. Gate de rollout sugerido

1. Capturar baseline com carga atual.
2. Aplicar mudança de arquitetura/índice/cache.
3. Reexecutar carga com mesmos parâmetros.
4. Aprovar rollout apenas se:
   - p95 não piorar mais de 10%
   - erro não subir acima de 2%
   - backlog voltar ao patamar normal em até 15 min
