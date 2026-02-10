import 'dotenv/config';

import http from 'node:http';
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
    pokeApiCacheHitTotal: new client.Counter({
      name: 'pokeapi_cache_hit_total',
      help: 'Total de cache hits no cliente da PokéAPI',
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
    const host = req.headers.host || `${METRICS_HOST}:${METRICS_PORT}`;
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://${host}`);
    } catch {
      parsedUrl = new URL(req.url || '/', 'http://localhost');
    }
    const pathname = parsedUrl.pathname;

    try {
      const stickerCatalogModule = await loadStickerCatalogModule();
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
