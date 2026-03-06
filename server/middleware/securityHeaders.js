import helmet from 'helmet';

import logger from '../../utils/logger/loggerModule.js';

const parseEnvBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const HELMET_CSP_ENABLED = parseEnvBool(process.env.HELMET_CONTENT_SECURITY_POLICY_ENABLED, false);
const BACKEND_BUILD_ID = String(process.env.OMNIZAP_BUILD_ID || '')
  .trim()
  .slice(0, 80);

const helmetMiddleware = helmet({
  contentSecurityPolicy: HELMET_CSP_ENABLED ? undefined : false,
  crossOriginEmbedderPolicy: false,
  // Mantemos permissões explícitas para browser APIs sensíveis.
  permissionsPolicy: {
    features: {
      geolocation: [],
      microphone: [],
      camera: [],
    },
  },
});

const applyFallbackHeaders = (res) => {
  if (!res.getHeader('X-Content-Type-Options')) res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!res.getHeader('X-Frame-Options')) res.setHeader('X-Frame-Options', 'DENY');
  if (!res.getHeader('Referrer-Policy')) res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!res.getHeader('Permissions-Policy')) res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (BACKEND_BUILD_ID && !res.getHeader('X-Omnizap-Build')) res.setHeader('X-Omnizap-Build', BACKEND_BUILD_ID);
};

export const applySecurityHeaders = (req, res) => {
  try {
    const maybePromise = helmetMiddleware(req, res, () => {});
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch((error) => {
        logger.warn('Falha ao aplicar helmet middleware.', {
          action: 'helmet_apply_failed',
          error: error?.message,
        });
      });
    }
  } catch (error) {
    logger.warn('Falha ao aplicar headers do helmet. Aplicando fallback.', {
      action: 'helmet_apply_failed',
      error: error?.message,
    });
  }

  applyFallbackHeaders(res);
};
