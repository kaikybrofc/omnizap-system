import logger from '../../app/utils/logger/loggerModule.js';

export const attachRequestLogger = (req, res, { pathname = '', requestId = '', startedAt = Date.now() } = {}) => {
  if (req.__requestLoggerAttached) return;
  req.__requestLoggerAttached = true;

  res.once('finish', () => {
    logger.info('HTTP request', {
      request_id: requestId || null,
      method: req.method || 'UNKNOWN',
      path: pathname || null,
      status_code: res.statusCode,
      duration_ms: Math.max(0, Date.now() - Number(startedAt || Date.now())),
    });
  });
};
