import { sendMetricsResponse } from '../../controllers/metricsController.js';
import { resolveClientIp } from '../../http/clientIp.js';

const startsWithPath = (pathname, prefix) => {
  if (!pathname || !prefix) return false;
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
};

const parseEnvBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const METRICS_ALLOW_REMOTE = parseEnvBool(process.env.METRICS_ALLOW_REMOTE, false);
const METRICS_TOKEN = String(process.env.METRICS_TOKEN || process.env.METRICS_API_KEY || '').trim();
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const extractMetricsTokenFromRequest = (req) => {
  const headerToken = String(req?.headers?.['x-metrics-token'] || '').trim();
  if (headerToken) return headerToken;
  const authHeader = String(req?.headers?.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
};

const isLoopbackRequest = (req) => LOOPBACK_IPS.has(resolveClientIp(req));

const canAccessMetrics = (req) => {
  if (METRICS_TOKEN) {
    const requestToken = extractMetricsTokenFromRequest(req);
    return Boolean(requestToken && requestToken === METRICS_TOKEN);
  }
  if (METRICS_ALLOW_REMOTE) return true;
  return isLoopbackRequest(req);
};

const sendForbidden = (req, res) => {
  if (res.writableEnded) return true;
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(JSON.stringify({ error: 'Forbidden' }));
  return true;
};

export const maybeHandleMetricsRequest = async (req, res, { pathname, metricsPath }) => {
  if (!startsWithPath(pathname, metricsPath)) return false;
  if (!canAccessMetrics(req)) return sendForbidden(req, res);
  await sendMetricsResponse(res);
  return true;
};
