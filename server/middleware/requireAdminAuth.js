import logger from '../../app/utils/logger/loggerModule.js';

const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN || '').trim();

const extractAdminTokenFromRequest = (req) => {
  const headerToken = String(req.headers['x-admin-token'] || '').trim();
  if (headerToken) return headerToken;

  const authorizationHeader = String(req.headers.authorization || '').trim();
  if (!authorizationHeader) return '';

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || '').trim();
};

const sendUnauthorized = (res) => {
  if (res.writableEnded) return;
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'Unauthorized' }));
};

/**
 * Camada opcional de auth de admin.
 * Quando `ADMIN_TOKEN` nao estiver configurado, delega para a auth interna do controller.
 */
export const requireAdminAuth = (req, res) => {
  if (!ADMIN_TOKEN) return true;

  const requestToken = extractAdminTokenFromRequest(req);
  if (requestToken && requestToken === ADMIN_TOKEN) return true;

  logger.warn('Tentativa de acesso admin sem token valido.', {
    action: 'admin_auth_token_invalid',
    method: req.method || 'UNKNOWN',
    path: req.url || '',
    remote_address: req.socket?.remoteAddress || null,
  });
  sendUnauthorized(res);
  return false;
};
