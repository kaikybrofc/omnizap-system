import fs from 'node:fs/promises';
import path from 'node:path';

import logger from '../../utils/logger/loggerModule.js';

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

const STICKER_API_BASE_PATH = normalizeBasePath(process.env.STICKER_API_BASE_PATH, '/api/sticker-packs');
const STICKER_LOGIN_WEB_PATH = normalizeBasePath(process.env.STICKER_LOGIN_WEB_PATH, '/login');
const USER_PROFILE_WEB_PATH = normalizeBasePath(process.env.USER_PROFILE_WEB_PATH, '/user');
const USER_PASSWORD_RESET_WEB_PATH = normalizeBasePath(process.env.USER_PASSWORD_RESET_WEB_PATH, '/user/password-reset');
const USER_DASHBOARD_TEMPLATE_PATH = path.join(process.cwd(), 'public', 'user', 'index.html');

const USER_API_PATHS = new Set([`${STICKER_API_BASE_PATH}/auth/google/session`, `${STICKER_API_BASE_PATH}/me`, `${STICKER_API_BASE_PATH}/bot-contact`, `${STICKER_API_BASE_PATH}/support`]);
const hasPathPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const escapeHtmlAttribute = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const replaceDataAttribute = (html, attributeName, value) => String(html || '').replace(new RegExp(`(${attributeName}=")([^"]*)(")`, 'i'), `$1${escapeHtmlAttribute(value)}$3`);

const renderUserDashboardHtml = async () => {
  const template = await fs.readFile(USER_DASHBOARD_TEMPLATE_PATH, 'utf8');
  const dataAttributes = {
    'data-api-base-path': STICKER_API_BASE_PATH,
    'data-login-path': STICKER_LOGIN_WEB_PATH,
    'data-password-reset-web-path': USER_PASSWORD_RESET_WEB_PATH,
  };

  let html = template;
  for (const [attributeName, value] of Object.entries(dataAttributes)) {
    html = replaceDataAttribute(html, attributeName, value);
  }

  return html;
};

let stickerCatalogControllerPromise = null;
const loadStickerCatalogController = async () => {
  if (!stickerCatalogControllerPromise) {
    stickerCatalogControllerPromise = import('./sticker/stickerCatalogController.js');
  }
  return stickerCatalogControllerPromise;
};

const sendHtml = (req, res, html) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(html);
};

const sendJson = (req, res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

export const getUserRouteConfig = () => ({
  webPath: USER_PROFILE_WEB_PATH,
  loginPath: STICKER_LOGIN_WEB_PATH,
  passwordResetWebPath: USER_PASSWORD_RESET_WEB_PATH,
  apiBasePath: STICKER_API_BASE_PATH,
});

export const maybeHandleUserRequest = async (req, res, { pathname, url }) => {
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return false;

  const isUserHomePath = pathname === USER_PROFILE_WEB_PATH || pathname === `${USER_PROFILE_WEB_PATH}/`;
  const isPasswordResetPath = hasPathPrefix(pathname, USER_PASSWORD_RESET_WEB_PATH);

  if (isUserHomePath || isPasswordResetPath) {
    if (!['GET', 'HEAD'].includes(req.method || '')) return false;
    try {
      const html = await renderUserDashboardHtml();
      sendHtml(req, res, html);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        sendJson(req, res, 404, { error: 'Template da pagina de usuario nao encontrado.' });
        return true;
      }
      logger.error('Falha ao renderizar pagina de usuario.', {
        action: 'user_page_render_failed',
        path: pathname,
        error: error?.message,
      });
      sendJson(req, res, 500, { error: 'Falha interna ao renderizar pagina de usuario.' });
    }
    return true;
  }

  if (USER_API_PATHS.has(pathname)) {
    const controller = await loadStickerCatalogController();
    if (typeof controller?.maybeHandleStickerCatalogRequest !== 'function') return false;
    return controller.maybeHandleStickerCatalogRequest(req, res, { pathname, url });
  }

  return false;
};
