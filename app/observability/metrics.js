import 'dotenv/config';

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import client from 'prom-client';
import logger from '../utils/logger/loggerModule.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseEnvNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseThresholds = (value, fallback) => {
  if (!value) return fallback;
  const parsed = String(value)
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
  return parsed.length ? parsed : fallback;
};

const METRICS_ENABLED = parseEnvBool(process.env.METRICS_ENABLED, true);
const METRICS_PORT = parseEnvNumber(process.env.METRICS_PORT, 9102);
const METRICS_HOST = process.env.METRICS_HOST || '0.0.0.0';
const METRICS_PATH = process.env.METRICS_PATH || '/metrics';
const METRICS_SERVICE = process.env.METRICS_SERVICE_NAME || process.env.ECOSYSTEM_NAME || 'omnizap';
const HTTP_SLO_TARGET_MS = Math.max(50, parseEnvNumber(process.env.HTTP_SLO_TARGET_MS, 750));

const QUERY_THRESHOLDS_MS = parseThresholds(process.env.DB_QUERY_ALERT_THRESHOLDS, [500, 1000]);

const registry = new client.Registry();
let metrics = null;
let server = null;
let serverStarted = false;
let stickerCatalogModulePromise = null;

const normalizeLabel = (value, fallback = 'unknown') => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
};

const normalizeRequestId = (value) => {
  const token = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 120);
  return token || randomUUID();
};

const normalizeHttpMethod = (method) => {
  const normalized = String(method || '').trim().toUpperCase();
  if (!normalized) return 'UNKNOWN';
  if (normalized.length > 12) return normalized.slice(0, 12);
  return normalized;
};

const toStatusClass = (statusCode) => {
  const numeric = Number(statusCode);
  if (!Number.isFinite(numeric) || numeric < 100) return 'unknown';
  const head = Math.floor(numeric / 100);
  return `${head}xx`;
};

const resolveRouteGroup = ({ pathname, metricsPath, catalogConfig = null } = {}) => {
  if (pathname?.startsWith(metricsPath)) return 'metrics';
  if (pathname === '/sitemap.xml') return 'sitemap';
  if (pathname === '/api/marketplace/stats') return 'marketplace_stats';

  const apiBasePath = catalogConfig?.apiBasePath || '';
  const webPath = catalogConfig?.webPath || '';
  const dataPublicPath = catalogConfig?.dataPublicPath || '';
  const userProfilePath = catalogConfig?.userProfilePath || '';

  if (apiBasePath && (pathname === apiBasePath || pathname?.startsWith(`${apiBasePath}/`))) {
    if (pathname === `${apiBasePath}/auth/google/session` || pathname === `${apiBasePath}/me` || pathname === `${apiBasePath}/admin/session`) {
      return 'catalog_api_auth';
    }
    if (pathname === `${apiBasePath}/create` || /\/(manage|finalize|stickers-upload|publish-state)(\/|$)/.test(pathname || '')) {
      return 'catalog_api_upload';
    }
    if (pathname?.startsWith(`${apiBasePath}/admin`)) return 'catalog_api_admin';
    return 'catalog_api_public';
  }
  if (dataPublicPath && (pathname === dataPublicPath || pathname?.startsWith(`${dataPublicPath}/`))) return 'catalog_data_asset';
  if (userProfilePath && (pathname === userProfilePath || pathname === `${userProfilePath}/`)) return 'catalog_user_profile';
  if (webPath && (pathname === webPath || pathname?.startsWith(`${webPath}/`))) return 'catalog_web';

  return 'other';
};

const ensureMetrics = () => {
  if (!METRICS_ENABLED) return null;
  if (metrics) return metrics;

  registry.setDefaultLabels({ service: METRICS_SERVICE });
  client.collectDefaultMetrics({ register: registry, prefix: 'omnizap_' });

  metrics = {
    dbQueryDurationMs: new client.Histogram({
      name: 'omnizap_db_query_duration_ms',
      help: 'Duracao de queries MySQL em ms',
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      labelNames: ['type', 'table', 'status'],
      registers: [registry],
    }),
    dbQueryTotal: new client.Counter({
      name: 'omnizap_db_query_total',
      help: 'Total de queries MySQL',
      labelNames: ['type', 'table', 'status'],
      registers: [registry],
    }),
    dbQueryOverMsTotal: new client.Counter({
      name: 'omnizap_db_query_over_ms_total',
      help: 'Total de queries acima de limiares em ms',
      labelNames: ['threshold', 'type', 'table', 'status'],
      registers: [registry],
    }),
    dbSlowQueriesTotal: new client.Counter({
      name: 'omnizap_db_slow_queries_total',
      help: 'Total de queries lentas (com base em DB_SLOW_QUERY_MS)',
      labelNames: ['type', 'table'],
      registers: [registry],
    }),
    dbWriteTotal: new client.Counter({
      name: 'omnizap_db_write_total',
      help: 'Total de writes por operacao',
      labelNames: ['operation', 'table'],
      registers: [registry],
    }),
    dbLastQueryDurationMs: new client.Gauge({
      name: 'omnizap_db_last_query_duration_ms',
      help: 'Duracao da ultima query observada em ms',
      labelNames: ['type', 'table', 'status'],
      registers: [registry],
    }),
    dbInFlight: new client.Gauge({
      name: 'omnizap_db_in_flight',
      help: 'Queries em voo no pool',
      registers: [registry],
    }),
    errorsTotal: new client.Counter({
      name: 'omnizap_errors_total',
      help: 'Total de erros por escopo',
      labelNames: ['scope'],
      registers: [registry],
    }),
    queueDepth: new client.Gauge({
      name: 'omnizap_queue_depth',
      help: 'Backlog das filas internas',
      labelNames: ['queue'],
      registers: [registry],
    }),
    httpRequestsTotal: new client.Counter({
      name: 'omnizap_http_requests_total',
      help: 'Total de requests HTTP por rota lógica',
      labelNames: ['route_group', 'method', 'status_class'],
      registers: [registry],
    }),
    httpRequestDurationMs: new client.Histogram({
      name: 'omnizap_http_request_duration_ms',
      help: 'Latência de requests HTTP em ms por rota lógica',
      buckets: [5, 10, 20, 40, 75, 120, 200, 350, 500, 750, 1000, 2000, 5000, 10000],
      labelNames: ['route_group', 'method', 'status_class'],
      registers: [registry],
    }),
    httpSloViolationTotal: new client.Counter({
      name: 'omnizap_http_slo_violation_total',
      help: 'Total de requests HTTP acima do SLO de latência',
      labelNames: ['route_group', 'method'],
      registers: [registry],
    }),
    messagesUpsertDurationMs: new client.Histogram({
      name: 'omnizap_messages_upsert_duration_ms',
      help: 'Duracao de processamento de messages.upsert em ms',
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      labelNames: ['type', 'status'],
      registers: [registry],
    }),
    messagesUpsertTotal: new client.Counter({
      name: 'omnizap_messages_upsert_total',
      help: 'Total de eventos messages.upsert',
      labelNames: ['type', 'status'],
      registers: [registry],
    }),
    messagesUpsertMessagesTotal: new client.Counter({
      name: 'omnizap_messages_upsert_messages_total',
      help: 'Total de mensagens processadas por messages.upsert',
      labelNames: ['type'],
      registers: [registry],
    }),
    rpgPlayersTotal: new client.Counter({
      name: 'rpg_players_total',
      help: 'Total de jogadores criados no RPG Pokemon',
      registers: [registry],
    }),
    rpgBattlesStartedTotal: new client.Counter({
      name: 'rpg_battles_started_total',
      help: 'Total de batalhas iniciadas no RPG Pokemon',
      registers: [registry],
    }),
    rpgBattlesTotal: new client.Counter({
      name: 'rpg_battles_total',
      help: 'Total de batalhas iniciadas no RPG Pokemon (alias geral)',
      registers: [registry],
    }),
    rpgCapturesTotal: new client.Counter({
      name: 'rpg_captures_total',
      help: 'Total de capturas realizadas no RPG Pokemon',
      registers: [registry],
    }),
    rpgCaptureAttemptsTotal: new client.Counter({
      name: 'rpg_capture_attempts_total',
      help: 'Total de tentativas de captura no RPG Pokemon',
      labelNames: ['result'],
      registers: [registry],
    }),
    rpgFleesTotal: new client.Counter({
      name: 'rpg_flees_total',
      help: 'Total de fugas de batalha no RPG Pokemon',
      registers: [registry],
    }),
    rpgBattleDurationSeconds: new client.Histogram({
      name: 'rpg_battle_duration_seconds',
      help: 'Duração de batalhas do RPG em segundos',
      buckets: [5, 10, 20, 30, 45, 60, 90, 120, 180, 240, 300, 600, 900],
      labelNames: ['mode', 'outcome'],
      registers: [registry],
    }),
    rpgActionsTotal: new client.Counter({
      name: 'rpg_actions_total',
      help: 'Total de ações/comandos do RPG Pokemon',
      labelNames: ['action', 'status'],
      registers: [registry],
    }),
    rpgSessionDurationSeconds: new client.Histogram({
      name: 'rpg_session_duration_seconds',
      help: 'Duração amostrada das sessões do RPG em segundos',
      buckets: [5, 10, 20, 30, 60, 120, 300, 600, 900, 1800, 3600],
      registers: [registry],
    }),
    rpgRaidsStartedTotal: new client.Counter({
      name: 'rpg_raids_started_total',
      help: 'Total de raids iniciadas no RPG',
      registers: [registry],
    }),
    rpgRaidsCompletedTotal: new client.Counter({
      name: 'rpg_raids_completed_total',
      help: 'Total de raids concluídas no RPG',
      registers: [registry],
    }),
    rpgPvpChallengesTotal: new client.Counter({
      name: 'rpg_pvp_challenges_total',
      help: 'Total de desafios PvP criados no RPG',
      registers: [registry],
    }),
    rpgPvpCompletedTotal: new client.Counter({
      name: 'rpg_pvp_completed_total',
      help: 'Total de PvP concluídos no RPG',
      registers: [registry],
    }),
    rpgPvpQueueTotal: new client.Counter({
      name: 'rpg_pvp_queue_total',
      help: 'Total de eventos da fila PvP (join/match/leave/expire)',
      labelNames: ['status'],
      registers: [registry],
    }),
    rpgTradesTotal: new client.Counter({
      name: 'rpg_trades_total',
      help: 'Total de trocas de jogadores no RPG',
      labelNames: ['status'],
      registers: [registry],
    }),
    rpgCoopCompletedTotal: new client.Counter({
      name: 'rpg_coop_completed_total',
      help: 'Total de missoes cooperativas concluídas',
      registers: [registry],
    }),
    rpgWeeklyEventCompletedTotal: new client.Counter({
      name: 'rpg_weekly_event_completed_total',
      help: 'Total de eventos semanais de grupo concluídos',
      registers: [registry],
    }),
    rpgKarmaVotesTotal: new client.Counter({
      name: 'rpg_karma_votes_total',
      help: 'Total de votos de karma no RPG',
      labelNames: ['type'],
      registers: [registry],
    }),
    rpgGroupRetentionRatio: new client.Histogram({
      name: 'rpg_group_retention_ratio',
      help: 'Retenção diária de usuários por grupo (0-1)',
      buckets: [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1],
      registers: [registry],
    }),
    rpgShinyFoundTotal: new client.Counter({
      name: 'rpg_shiny_found_total',
      help: 'Total de encontros shiny no RPG Pokemon',
      registers: [registry],
    }),
    rpgEvolutionsTotal: new client.Counter({
      name: 'rpg_evolutions_total',
      help: 'Total de evolucoes de Pokemon no RPG',
      registers: [registry],
    }),
    socialXpConvertedTotal: new client.Counter({
      name: 'social_xp_converted_total',
      help: 'XP social convertido em bonus de RPG',
      labelNames: ['action'],
      registers: [registry],
    }),
    socialXpConversionRate: new client.Histogram({
      name: 'social_xp_conversion_rate',
      help: 'Taxa de conversao aplicada no consumo de XP social',
      buckets: [0, 0.1, 0.25, 0.5, 0.75, 1, 1.1, 1.25, 1.5],
      labelNames: ['action'],
      registers: [registry],
    }),
    socialXpCapHitsTotal: new client.Counter({
      name: 'social_xp_cap_hits_total',
      help: 'Total de vezes que o cap de XP social bloqueou ganho/conversao',
      labelNames: ['scope'],
      registers: [registry],
    }),
    pokeApiCacheHitTotal: new client.Counter({
      name: 'pokeapi_cache_hit_total',
      help: 'Total de cache hits no cliente da PokéAPI',
      registers: [registry],
    }),
    stickerAutoPackCycleDurationMs: new client.Histogram({
      name: 'omnizap_sticker_autopack_cycle_duration_ms',
      help: 'Duracao do ciclo de auto-pack em ms',
      buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
      registers: [registry],
    }),
    stickerAutoPackAssetsScannedTotal: new client.Counter({
      name: 'omnizap_sticker_autopack_assets_scanned_total',
      help: 'Total de assets escaneados no auto-pack',
      registers: [registry],
    }),
    stickerAutoPackAssetsAddedTotal: new client.Counter({
      name: 'omnizap_sticker_autopack_assets_added_total',
      help: 'Total de assets adicionados em packs no auto-pack',
      registers: [registry],
    }),
    stickerAutoPackDuplicateRate: new client.Gauge({
      name: 'omnizap_sticker_autopack_duplicate_rate',
      help: 'Taxa de duplicidade observada no ciclo de auto-pack (0-1)',
      registers: [registry],
    }),
    stickerAutoPackRejectionRate: new client.Gauge({
      name: 'omnizap_sticker_autopack_rejection_rate',
      help: 'Taxa de rejeicao no ciclo de auto-pack (0-1)',
      registers: [registry],
    }),
    stickerAutoPackFillRate: new client.Gauge({
      name: 'omnizap_sticker_autopack_fill_rate',
      help: 'Taxa de packs completos em relacao ao target_size (0-1)',
      registers: [registry],
    }),
    stickerClassificationCycleDurationMs: new client.Histogram({
      name: 'omnizap_sticker_classification_cycle_duration_ms',
      help: 'Duração do ciclo de classificação de sticker em ms',
      buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
      labelNames: ['status'],
      registers: [registry],
    }),
    stickerClassificationCycleTotal: new client.Counter({
      name: 'omnizap_sticker_classification_cycle_total',
      help: 'Total de ciclos de classificação de sticker',
      labelNames: ['status'],
      registers: [registry],
    }),
    stickerClassificationAssetsTotal: new client.Counter({
      name: 'omnizap_sticker_classification_assets_total',
      help: 'Total de assets processados/classificados/falhos por ciclo',
      labelNames: ['outcome'],
      registers: [registry],
    }),
  };

  return metrics;
};

const loadStickerCatalogModule = async () => {
  if (!stickerCatalogModulePromise) {
    stickerCatalogModulePromise = import('../modules/stickerPackModule/stickerPackCatalogHttp.js');
  }
  return stickerCatalogModulePromise;
};

export const isMetricsEnabled = () => METRICS_ENABLED;

export const startMetricsServer = () => {
  if (!METRICS_ENABLED || serverStarted) return;
  ensureMetrics();
  server = http.createServer(async (req, res) => {
    const requestStartedAt = Date.now();
    const requestId = normalizeRequestId(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', requestId);

    const host = req.headers.host || `${METRICS_HOST}:${METRICS_PORT}`;
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://${host}`);
    } catch {
      parsedUrl = new URL(req.url || '/', 'http://localhost');
    }
    const pathname = parsedUrl.pathname;
    let routeGroup = resolveRouteGroup({
      pathname,
      metricsPath: METRICS_PATH,
      catalogConfig: null,
    });

    res.once('finish', () => {
      recordHttpRequest({
        durationMs: Date.now() - requestStartedAt,
        method: req.method,
        statusCode: res.statusCode,
        routeGroup,
      });
    });

    try {
      const stickerCatalogModule = await loadStickerCatalogModule();
      const catalogConfig =
        typeof stickerCatalogModule.getStickerCatalogConfig === 'function'
          ? stickerCatalogModule.getStickerCatalogConfig()
          : null;
      routeGroup = resolveRouteGroup({
        pathname,
        metricsPath: METRICS_PATH,
        catalogConfig,
      });
      const handledByCatalog = await stickerCatalogModule.maybeHandleStickerCatalogRequest(req, res, {
        pathname,
        url: parsedUrl,
      });

      if (handledByCatalog) {
        return;
      }
    } catch (error) {
      logger.error('Erro ao inicializar rotas web de sticker packs.', {
        error: error.message,
      });
    }

    if (!pathname.startsWith(METRICS_PATH)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    try {
      const body = await registry.metrics();
      res.statusCode = 200;
      res.setHeader('Content-Type', registry.contentType);
      res.end(body);
    } catch (error) {
      res.statusCode = 500;
      res.end('Metrics error');
      logger.error('Erro ao gerar /metrics', { error: error.message });
    }
  });

  server.listen(METRICS_PORT, METRICS_HOST, () => {
    serverStarted = true;
    logger.info('Servidor /metrics iniciado', {
      host: METRICS_HOST,
      port: METRICS_PORT,
      path: METRICS_PATH,
    });

    loadStickerCatalogModule()
      .then((module) => {
        const config = typeof module.getStickerCatalogConfig === 'function' ? module.getStickerCatalogConfig() : null;
        if (!config?.enabled) return;
        logger.info('Catalogo web de sticker packs habilitado', {
          web_path: config.webPath,
          api_base_path: config.apiBasePath,
          orphan_api_path: config.orphanApiPath,
          data_public_path: config.dataPublicPath,
          data_public_dir: config.dataPublicDir,
          host: METRICS_HOST,
          port: METRICS_PORT,
        });
      })
      .catch((error) => {
        logger.warn('Nao foi possivel carregar configuracao do catalogo de sticker packs.', {
          error: error.message,
        });
      });
  });

  server.on('error', (error) => {
    logger.error('Falha ao iniciar servidor /metrics', { error: error.message });
  });
};

export const stopMetricsServer = async () => {
  if (!serverStarted || !server) return;
  const current = server;
  server = null;
  serverStarted = false;
  await new Promise((resolve, reject) => {
    current.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

export const recordError = (scope = 'app') => {
  const m = ensureMetrics();
  if (!m) return;
  const labelScope = normalizeLabel(scope, 'app');
  m.errorsTotal.inc({ scope: labelScope });
};

export const setQueueDepth = (queue, depth) => {
  const m = ensureMetrics();
  if (!m) return;
  const value = Number(depth);
  if (!Number.isFinite(value)) return;
  m.queueDepth.set({ queue: normalizeLabel(queue, 'unknown') }, value);
};

export const recordHttpRequest = ({ durationMs, method, statusCode, routeGroup }) => {
  const m = ensureMetrics();
  if (!m) return;
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration < 0) return;

  const labels = {
    route_group: normalizeLabel(routeGroup, 'other'),
    method: normalizeHttpMethod(method),
    status_class: toStatusClass(statusCode),
  };

  m.httpRequestsTotal.inc(labels);
  m.httpRequestDurationMs.observe(labels, duration);
  if (duration >= HTTP_SLO_TARGET_MS) {
    m.httpSloViolationTotal.inc({
      route_group: labels.route_group,
      method: labels.method,
    });
  }
};

export const setDbInFlight = (value) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  m.dbInFlight.set(numeric);
};

export const recordDbQuery = ({ durationMs, type, table, ok, isSlow }) => {
  const m = ensureMetrics();
  if (!m) return;
  const duration = Number(durationMs);
  if (!Number.isFinite(duration)) return;

  const labels = {
    type: normalizeLabel(type, 'OTHER'),
    table: normalizeLabel(table, 'unknown'),
    status: ok ? 'ok' : 'error',
  };

  m.dbQueryDurationMs.observe(labels, duration);
  m.dbQueryTotal.inc(labels);
  m.dbLastQueryDurationMs.set(labels, duration);

  QUERY_THRESHOLDS_MS.forEach((threshold) => {
    if (duration >= threshold) {
      m.dbQueryOverMsTotal.inc({
        threshold: String(threshold),
        ...labels,
      });
    }
  });

  if (isSlow) {
    m.dbSlowQueriesTotal.inc({ type: labels.type, table: labels.table });
  }
};

export const recordDbWrite = ({ operation, table }) => {
  const m = ensureMetrics();
  if (!m) return;
  const op = normalizeLabel(operation, 'unknown');
  const tableLabel = normalizeLabel(table, 'unknown');
  m.dbWriteTotal.inc({ operation: op, table: tableLabel });
};

export const recordMessagesUpsert = ({ durationMs, type, messagesCount, ok }) => {
  const m = ensureMetrics();
  if (!m) return;

  const duration = Number(durationMs);
  const eventType = normalizeLabel(type, 'unknown');
  const status = ok ? 'ok' : 'error';

  if (Number.isFinite(duration)) {
    m.messagesUpsertDurationMs.observe({ type: eventType, status }, duration);
  }

  m.messagesUpsertTotal.inc({ type: eventType, status });

  const count = Number(messagesCount);
  if (Number.isFinite(count) && count > 0) {
    m.messagesUpsertMessagesTotal.inc({ type: eventType }, count);
  }
};

export const recordRpgPlayerCreated = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgPlayersTotal.inc(numeric);
};

export const recordRpgBattleStarted = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgBattlesStartedTotal.inc(numeric);
  m.rpgBattlesTotal.inc(numeric);
};

export const recordRpgCapture = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgCapturesTotal.inc(numeric);
};

export const recordRpgCaptureAttempt = (result = 'failed', value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgCaptureAttemptsTotal.inc({ result: normalizeLabel(result, 'failed') }, numeric);
};

export const recordRpgFlee = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgFleesTotal.inc(numeric);
};

export const recordRpgBattleDuration = ({ mode = 'wild', outcome = 'unknown', seconds }) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric < 0) return;
  m.rpgBattleDurationSeconds.observe(
    {
      mode: normalizeLabel(mode, 'wild'),
      outcome: normalizeLabel(outcome, 'unknown'),
    },
    numeric,
  );
};

export const recordRpgAction = ({ action = 'unknown', status = 'ok', value = 1 }) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgActionsTotal.inc(
    {
      action: normalizeLabel(action, 'unknown'),
      status: normalizeLabel(status, 'ok'),
    },
    numeric,
  );
};

export const recordRpgSessionDuration = (seconds) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric < 0) return;
  m.rpgSessionDurationSeconds.observe(numeric);
};

export const recordRpgRaidStarted = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgRaidsStartedTotal.inc(numeric);
};

export const recordRpgRaidCompleted = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgRaidsCompletedTotal.inc(numeric);
};

export const recordRpgPvpChallenge = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgPvpChallengesTotal.inc(numeric);
};

export const recordRpgPvpCompleted = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgPvpCompletedTotal.inc(numeric);
};

export const recordRpgPvpQueue = (status = 'join', value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgPvpQueueTotal.inc({ status: normalizeLabel(status, 'join') }, numeric);
};

export const recordRpgTrade = (status = 'created', value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgTradesTotal.inc({ status: normalizeLabel(status, 'created') }, numeric);
};

export const recordRpgCoopCompleted = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgCoopCompletedTotal.inc(numeric);
};

export const recordRpgWeeklyEventCompleted = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgWeeklyEventCompletedTotal.inc(numeric);
};

export const recordRpgKarmaVote = (type = 'up', value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgKarmaVotesTotal.inc({ type: normalizeLabel(type, 'up') }, numeric);
};

export const recordRpgGroupRetentionRatio = (ratio) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(ratio);
  if (!Number.isFinite(numeric) || numeric < 0) return;
  m.rpgGroupRetentionRatio.observe(Math.min(1, numeric));
};

export const recordPokeApiCacheHit = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.pokeApiCacheHitTotal.inc(numeric);
};

export const recordRpgShinyFound = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgShinyFoundTotal.inc(numeric);
};

export const recordRpgEvolution = (value = 1) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.rpgEvolutionsTotal.inc(numeric);
};

export const recordSocialXpConverted = ({ value = 1, action = 'unknown' } = {}) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  m.socialXpConvertedTotal.inc({ action: normalizeLabel(action, 'unknown') }, numeric);
};

export const recordSocialXpConversionRate = ({ rate, action = 'unknown' } = {}) => {
  const m = ensureMetrics();
  if (!m) return;
  const numeric = Number(rate);
  if (!Number.isFinite(numeric) || numeric < 0) return;
  m.socialXpConversionRate.observe({ action: normalizeLabel(action, 'unknown') }, numeric);
};

export const recordSocialXpCapHit = ({ scope = 'earn' } = {}) => {
  const m = ensureMetrics();
  if (!m) return;
  m.socialXpCapHitsTotal.inc({ scope: normalizeLabel(scope, 'earn') });
};

export const recordStickerAutoPackCycle = ({
  durationMs,
  assetsScanned = 0,
  assetsAdded = 0,
  duplicateRate = null,
  rejectionRate = null,
  fillRate = null,
} = {}) => {
  const m = ensureMetrics();
  if (!m) return;

  const duration = Number(durationMs);
  if (Number.isFinite(duration) && duration >= 0) {
    m.stickerAutoPackCycleDurationMs.observe(duration);
  }

  const scanned = Number(assetsScanned);
  if (Number.isFinite(scanned) && scanned > 0) {
    m.stickerAutoPackAssetsScannedTotal.inc(scanned);
  }

  const added = Number(assetsAdded);
  if (Number.isFinite(added) && added > 0) {
    m.stickerAutoPackAssetsAddedTotal.inc(added);
  }

  const duplicate = Number(duplicateRate);
  if (Number.isFinite(duplicate)) {
    m.stickerAutoPackDuplicateRate.set(Math.max(0, Math.min(1, duplicate)));
  }

  const rejection = Number(rejectionRate);
  if (Number.isFinite(rejection)) {
    m.stickerAutoPackRejectionRate.set(Math.max(0, Math.min(1, rejection)));
  }

  const fill = Number(fillRate);
  if (Number.isFinite(fill)) {
    m.stickerAutoPackFillRate.set(Math.max(0, Math.min(1, fill)));
  }
};

export const recordStickerClassificationCycle = ({
  status = 'ok',
  durationMs,
  processed = 0,
  classified = 0,
  failed = 0,
} = {}) => {
  const m = ensureMetrics();
  if (!m) return;

  const cycleStatus = normalizeLabel(status, 'ok').slice(0, 24);
  const duration = Number(durationMs);
  if (Number.isFinite(duration) && duration >= 0) {
    m.stickerClassificationCycleDurationMs.observe({ status: cycleStatus }, duration);
  }
  m.stickerClassificationCycleTotal.inc({ status: cycleStatus });

  const processedValue = Number(processed);
  if (Number.isFinite(processedValue) && processedValue > 0) {
    m.stickerClassificationAssetsTotal.inc({ outcome: 'processed' }, processedValue);
  }
  const classifiedValue = Number(classified);
  if (Number.isFinite(classifiedValue) && classifiedValue > 0) {
    m.stickerClassificationAssetsTotal.inc({ outcome: 'classified' }, classifiedValue);
  }
  const failedValue = Number(failed);
  if (Number.isFinite(failedValue) && failedValue > 0) {
    m.stickerClassificationAssetsTotal.inc({ outcome: 'failed' }, failedValue);
  }
};
