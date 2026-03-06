import { rateLimit } from 'express-rate-limit';
import { resolveClientIp } from '../http/clientIp.js';

const parseNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const buildLimiter = ({ keyPrefix, windowMs, max }) => {
  const safeWindowMs = parseNumber(windowMs, 60_000, 1_000, 60 * 60 * 1000);
  const safeMax = parseNumber(max, 10, 1, 100_000);
  const safeKeyPrefix = String(keyPrefix || 'auth').trim() || 'auth';

  return rateLimit({
    windowMs: safeWindowMs,
    limit: safeMax,
    standardHeaders: false,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => `${safeKeyPrefix}:${resolveClientIp(req)}`,
    handler: (req, res, _next, options) => {
      if (res.writableEnded) return;
      req.__endpointRateLimitBlocked = true;
      const retryAfterSeconds = Math.max(1, Math.ceil(Number(options?.windowMs || safeWindowMs) / 1000));
      res.statusCode = Number(options?.statusCode || 429);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Retry-After', String(retryAfterSeconds));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(
        JSON.stringify({
          error: 'Too Many Requests',
          code: 'RATE_LIMITED',
        }),
      );
    },
  });
};

const authLoginLimiter = buildLimiter({
  keyPrefix: 'auth_login',
  windowMs: parseNumber(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 60 * 60 * 1000),
  max: parseNumber(process.env.AUTH_LOGIN_RATE_LIMIT_MAX, 10, 1, 100_000),
});

const authPasswordLimiter = buildLimiter({
  keyPrefix: 'auth_password',
  windowMs: parseNumber(process.env.AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 60 * 60 * 1000),
  max: parseNumber(process.env.AUTH_PASSWORD_RATE_LIMIT_MAX, 8, 1, 100_000),
});

const authPasswordRecoveryRequestLimiter = buildLimiter({
  keyPrefix: 'auth_password_recovery_request',
  windowMs: parseNumber(process.env.AUTH_PASSWORD_RECOVERY_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 60 * 60 * 1000),
  max: parseNumber(process.env.AUTH_PASSWORD_RECOVERY_RATE_LIMIT_MAX, 4, 1, 100_000),
});

const adminSessionLimiter = buildLimiter({
  keyPrefix: 'admin_session',
  windowMs: parseNumber(process.env.AUTH_ADMIN_SESSION_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 60 * 60 * 1000),
  max: parseNumber(process.env.AUTH_ADMIN_SESSION_RATE_LIMIT_MAX, 6, 1, 100_000),
});

const runLimiter = async (limiter, req, res) => {
  req.__endpointRateLimitBlocked = false;

  const runPromise = new Promise((resolve) => {
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      resolve(true);
    };

    try {
      const maybePromise = limiter(req, res, next);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise
          .then(() => {
            if (nextCalled) return;
            if (req.__endpointRateLimitBlocked || res.writableEnded) {
              resolve(false);
              return;
            }
            resolve(true);
          })
          .catch(() => resolve(false));
        return;
      }

      if (nextCalled) {
        resolve(true);
        return;
      }

      if (req.__endpointRateLimitBlocked || res.writableEnded) {
        resolve(false);
        return;
      }

      resolve(true);
    } catch {
      resolve(false);
    }
  });

  return runPromise;
};

const isSensitivePostPath = (pathname) => {
  const safePath = String(pathname || '')
    .trim()
    .toLowerCase();
  if (!safePath) return null;

  if (safePath.endsWith('/auth/google/session') || safePath.endsWith('/auth/login')) {
    return 'auth_login';
  }

  if (safePath.endsWith('/auth/password')) {
    return 'auth_password';
  }

  if (safePath.endsWith('/auth/password/recovery/request')) {
    return 'auth_password_recovery_request';
  }

  if (safePath.endsWith('/auth/password/recovery/verify')) {
    return 'auth_password';
  }

  if (safePath.endsWith('/auth/password/recovery/session')) {
    return 'auth_password';
  }

  if (/\/auth\/password\/recovery\/session\/[^/]+\/request$/.test(safePath)) {
    return 'auth_password_recovery_request';
  }

  if (/\/auth\/password\/recovery\/session\/[^/]+\/(?:request|verify)$/.test(safePath)) {
    return 'auth_password';
  }

  if (safePath.endsWith('/admin/session')) {
    return 'admin_session';
  }

  return null;
};

export const applySensitiveRouteRateLimit = async (req, res, { pathname }) => {
  const method = String(req?.method || '').toUpperCase();
  if (method !== 'POST') return true;

  const routeType = isSensitivePostPath(pathname);
  if (!routeType) return true;

  if (routeType === 'auth_login') {
    return runLimiter(authLoginLimiter, req, res);
  }

  if (routeType === 'auth_password') {
    return runLimiter(authPasswordLimiter, req, res);
  }

  if (routeType === 'auth_password_recovery_request') {
    return runLimiter(authPasswordRecoveryRequestLimiter, req, res);
  }

  if (routeType === 'admin_session') {
    return runLimiter(adminSessionLimiter, req, res);
  }

  return true;
};
