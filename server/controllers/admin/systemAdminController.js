import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

import logger from '../../../app/utils/logger/loggerModule.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

const STICKER_API_BASE_PATH = normalizeBasePath(process.env.STICKER_API_BASE_PATH, '/api/sticker-packs');
const STICKER_WEB_PATH = normalizeBasePath(process.env.STICKER_WEB_PATH, '/stickers');
const STICKER_ADMIN_WEB_PATH = `${STICKER_WEB_PATH}/admin`;
const USER_PROFILE_WEB_PATH = normalizeBasePath(process.env.USER_PROFILE_WEB_PATH, '/user');
const USER_SYSTEMADM_WEB_PATH = `${USER_PROFILE_WEB_PATH}/systemadm`;
const STICKER_ADMIN_REDIRECT_TO_USER = parseEnvBool(process.env.STICKER_ADMIN_REDIRECT_TO_USER, true);
const SITE_ORIGIN = String(process.env.SITE_ORIGIN || 'https://omnizap.shop')
  .trim()
  .replace(/\/+$/, '');

const USER_SYSTEMADM_TEMPLATE_PATH = path.join(process.cwd(), 'public', 'user', 'systemadm', 'index.html');
const LEGACY_STICKER_ADMIN_TEMPLATE_PATH = path.join(process.cwd(), 'public', 'stickers', 'admin', 'index.html');

let stickerCatalogControllerPromise = null;
const loadStickerCatalogController = async () => {
  if (!stickerCatalogControllerPromise) {
    stickerCatalogControllerPromise = import('../sticker/stickerCatalogController.js');
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

const sendRedirect = (res, location) => {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};

export const getSystemAdminRouteConfig = () => ({
  webPath: USER_SYSTEMADM_WEB_PATH,
  legacyWebPath: STICKER_ADMIN_WEB_PATH,
  apiAdminBasePath: `${STICKER_API_BASE_PATH}/admin`,
  apiAdminSessionPath: `${STICKER_API_BASE_PATH}/admin/session`,
});

export const maybeHandleSystemAdminRequest = async (req, res, { pathname, url }) => {
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return false;

  if (pathname === USER_SYSTEMADM_WEB_PATH || pathname === `${USER_SYSTEMADM_WEB_PATH}/`) {
    if (!['GET', 'HEAD'].includes(req.method || '')) return false;
    try {
      const html = await fs.readFile(USER_SYSTEMADM_TEMPLATE_PATH, 'utf8');
      sendHtml(req, res, html);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        sendJson(req, res, 404, { error: 'Template da pagina system admin nao encontrado.' });
        return true;
      }
      logger.error('Falha ao renderizar pagina system admin.', {
        action: 'user_system_admin_page_render_failed',
        path: pathname,
        error: error?.message,
      });
      sendJson(req, res, 500, { error: 'Falha interna ao renderizar pagina system admin.' });
    }
    return true;
  }

  if (pathname === STICKER_ADMIN_WEB_PATH || pathname === `${STICKER_ADMIN_WEB_PATH}/`) {
    if (!['GET', 'HEAD'].includes(req.method || '')) return false;
    if (STICKER_ADMIN_REDIRECT_TO_USER) {
      const requestUrl = new URL(req.url || `${STICKER_ADMIN_WEB_PATH}/`, SITE_ORIGIN);
      const userUrl = new URL(`${USER_SYSTEMADM_WEB_PATH}/`, SITE_ORIGIN);
      for (const [key, value] of requestUrl.searchParams.entries()) {
        userUrl.searchParams.append(key, value);
      }
      sendRedirect(res, `${userUrl.pathname}${userUrl.search}`);
      return true;
    }
    try {
      const html = await fs.readFile(LEGACY_STICKER_ADMIN_TEMPLATE_PATH, 'utf8');
      sendHtml(req, res, html);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        sendJson(req, res, 404, { error: 'Template do painel admin nao encontrado.' });
        return true;
      }
      logger.error('Falha ao renderizar pagina admin legado.', {
        action: 'legacy_sticker_admin_page_render_failed',
        path: pathname,
        error: error?.message,
      });
      sendJson(req, res, 500, { error: 'Falha interna ao renderizar painel admin.' });
    }
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/admin/session` || pathname.startsWith(`${STICKER_API_BASE_PATH}/admin/`)) {
    const controller = await loadStickerCatalogController();
    if (typeof controller?.maybeHandleStickerCatalogRequest !== 'function') return false;
    return controller.maybeHandleStickerCatalogRequest(req, res, { pathname, url });
  }

  return false;
};
