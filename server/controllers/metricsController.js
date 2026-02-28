import logger from '../../app/utils/logger/loggerModule.js';
import { getMetricsPayload } from '../../app/observability/metrics.js';

export const sendMetricsResponse = async (res) => {
  try {
    const payload = await getMetricsPayload();
    if (!payload) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', payload.contentType);
    res.end(payload.body);
  } catch (error) {
    res.statusCode = 500;
    res.end('Metrics error');
    logger.error('Erro ao gerar /metrics', { error: error?.message });
  }
};
