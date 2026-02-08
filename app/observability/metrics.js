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
