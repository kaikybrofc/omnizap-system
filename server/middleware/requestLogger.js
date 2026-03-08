import logger from '../../utils/logger/loggerModule.js';

const SENSITIVE_PATH_MARKERS = ['/auth/password/recovery/session/', '/user/password-reset/'];

const redactTokenSegment = (rawPath, marker) => {
  const lower = rawPath.toLowerCase();
  const markerIndex = lower.indexOf(marker);
  if (markerIndex < 0) return rawPath;
  const tokenStart = markerIndex + marker.length;
  const suffix = rawPath.slice(tokenStart);
  const nextSlashIndex = suffix.indexOf('/');
  if (nextSlashIndex < 0) {
    const rawSegment = String(suffix || '')
      .trim()
      .toLowerCase();
    if (rawSegment === 'request' || rawSegment === 'verify') {
      return rawPath;
    }
    return `${rawPath.slice(0, tokenStart)}[redacted]`;
  }
  return `${rawPath.slice(0, tokenStart)}[redacted]${suffix.slice(nextSlashIndex)}`;
};

const sanitizePathForLogs = (pathname) => {
  const rawPath = String(pathname || '').trim();
  if (!rawPath) return null;
  return SENSITIVE_PATH_MARKERS.reduce((currentPath, marker) => {
    if (!currentPath) return currentPath;
    return redactTokenSegment(currentPath, marker);
  }, rawPath);
};

export const attachRequestLogger = (req, res, { pathname = '', requestId = '', startedAt = Date.now() } = {}) => {
  if (req.__requestLoggerAttached) return;
  req.__requestLoggerAttached = true;

  res.once('finish', () => {
    logger.info('HTTP request', {
      request_id: requestId || null,
      method: req.method || 'UNKNOWN',
      path: sanitizePathForLogs(pathname),
      status_code: res.statusCode,
      duration_ms: Math.max(0, Date.now() - Number(startedAt || Date.now())),
    });
  });
};
