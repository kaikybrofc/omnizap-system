import http from 'node:http';
import logger from '../../app/utils/logger/loggerModule.js';
import { getMetricsServerConfig, isMetricsEnabled, recordHttpRequest, resolveRouteGroup } from '../../app/observability/metrics.js';
import { parseRequestUrl, normalizeRequestId } from './requestContext.js';
import { maybeHandleMetricsRoute } from '../routes/metricsRoute.js';
import { getStickerCatalogRouteConfig, maybeHandleStickerCatalogRoute } from '../routes/stickerCatalogRoute.js';

let server = null;
let serverStarted = false;

export const startHttpServer = () => {
  if (!isMetricsEnabled() || serverStarted) return;

  const { host, port, path: metricsPath } = getMetricsServerConfig();
  server = http.createServer(async (req, res) => {
    const requestStartedAt = Date.now();
    const requestId = normalizeRequestId(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', requestId);

    const parsedUrl = parseRequestUrl(req, host, port);
    const pathname = parsedUrl.pathname;
    let routeGroup = resolveRouteGroup({
      pathname,
      metricsPath,
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
      const catalogConfig = await getStickerCatalogRouteConfig();
      routeGroup = resolveRouteGroup({
        pathname,
        metricsPath,
        catalogConfig,
      });
      const handledByCatalog = await maybeHandleStickerCatalogRoute(req, res, {
        pathname,
        url: parsedUrl,
      });
      if (handledByCatalog) return;
    } catch (error) {
      logger.error('Erro ao inicializar rotas web de sticker packs.', {
        error: error?.message,
      });
    }

    const handledMetrics = await maybeHandleMetricsRoute(req, res, {
      pathname,
      metricsPath,
    });
    if (handledMetrics) return;

    res.statusCode = 404;
    res.end('Not Found');
  });

  server.listen(port, host, () => {
    serverStarted = true;
    logger.info('Servidor HTTP iniciado', {
      host,
      port,
      metrics_path: metricsPath,
    });

    getStickerCatalogRouteConfig()
      .then((config) => {
        if (!config?.enabled) return;
        logger.info('Catalogo web de sticker packs habilitado', {
          web_path: config.webPath,
          api_base_path: config.apiBasePath,
          orphan_api_path: config.orphanApiPath,
          data_public_path: config.dataPublicPath,
          data_public_dir: config.dataPublicDir,
          host,
          port,
        });
      })
      .catch((error) => {
        logger.warn('Nao foi possivel carregar configuracao do catalogo de sticker packs.', {
          error: error?.message,
        });
      });
  });

  server.on('error', (error) => {
    logger.error('Falha ao iniciar servidor HTTP', { error: error?.message });
  });
};

export const stopHttpServer = async () => {
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
