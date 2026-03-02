import fs from 'node:fs/promises';
import path from 'node:path';

import { safeJoin } from '../../utils/safePath.js';

let stickerCatalogControllerPromise = null;

const loadStickerCatalogController = async () => {
  if (!stickerCatalogControllerPromise) {
    stickerCatalogControllerPromise = import('../../controllers/sticker/stickerCatalogController.js');
  }
  return stickerCatalogControllerPromise;
};

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

const startsWithPath = (pathname, prefix) => {
  if (!pathname || !prefix) return false;
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
};

const DEFAULT_DATA_PUBLIC_PATH = '/data';
const DEFAULT_DATA_PUBLIC_DIR = path.resolve(process.cwd(), 'data');
const ALLOWED_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp']);

const sendJson = (req, res, statusCode, payload) => {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(JSON.stringify(payload));
};

const resolveContentType = (extension) => {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.avif') return 'image/avif';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/webp';
};

const decodeRelativePath = (pathname, dataPublicPath) => {
  const rawSuffix = pathname.slice(dataPublicPath.length).replace(/^\/+/, '');
  if (!rawSuffix) return '';

  const decodedSegments = rawSuffix
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  return decodedSegments.join('/');
};

export const getStickerDataRouterConfig = async () => {
  const controller = await loadStickerCatalogController();
  const legacyConfig = (typeof controller?.getStickerCatalogConfig === 'function' ? controller.getStickerCatalogConfig() : null) || {};
  return {
    dataPublicPath: normalizeBasePath(legacyConfig.dataPublicPath, DEFAULT_DATA_PUBLIC_PATH),
    dataPublicDir: path.resolve(legacyConfig.dataPublicDir || DEFAULT_DATA_PUBLIC_DIR),
  };
};

export const shouldHandleStickerDataPath = (pathname, stickerConfig = null) => {
  const dataPublicPath = normalizeBasePath(stickerConfig?.dataPublicPath, DEFAULT_DATA_PUBLIC_PATH);
  return startsWithPath(pathname, dataPublicPath);
};

export const maybeHandleStickerDataRequest = async (req, res, { pathname, config = null }) => {
  const resolvedConfig = config || (await getStickerDataRouterConfig());
  const dataPublicPath = normalizeBasePath(resolvedConfig.dataPublicPath, DEFAULT_DATA_PUBLIC_PATH);

  if (!shouldHandleStickerDataPath(pathname, resolvedConfig)) return false;

  if (!['GET', 'HEAD'].includes(req.method || '')) {
    sendJson(req, res, 405, { error: 'Method Not Allowed' });
    return true;
  }

  let relativePath = '';
  try {
    relativePath = decodeRelativePath(pathname, dataPublicPath);
  } catch {
    sendJson(req, res, 400, { error: 'Invalid path encoding' });
    return true;
  }

  if (!relativePath) {
    sendJson(req, res, 400, { error: 'Invalid path' });
    return true;
  }

  const absolutePath = safeJoin(resolvedConfig.dataPublicDir, relativePath);
  if (!absolutePath) {
    sendJson(req, res, 400, { error: 'Invalid path' });
    return true;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    sendJson(req, res, 403, { error: 'Forbidden file type' });
    return true;
  }

  try {
    const fileStat = await fs.stat(absolutePath);
    if (!fileStat.isFile()) {
      sendJson(req, res, 404, { error: 'Not Found' });
      return true;
    }

    const fileBuffer = req.method === 'HEAD' ? null : await fs.readFile(absolutePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', resolveContentType(extension));
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(fileBuffer);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(req, res, 404, { error: 'Not Found' });
      return true;
    }

    sendJson(req, res, 500, { error: 'Read error' });
    return true;
  }
};
