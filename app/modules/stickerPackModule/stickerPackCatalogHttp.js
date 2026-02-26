import fs from 'node:fs/promises';
import path from 'node:path';

import logger from '../../utils/logger/loggerModule.js';
import { getSystemMetrics } from '../../utils/systemMetrics/systemMetricsModule.js';
import { listStickerPacksForCatalog, findStickerPackByPackKey } from './stickerPackRepository.js';
import { listStickerPackItems } from './stickerPackItemRepository.js';
import { listStickerAssetsWithoutPack } from './stickerAssetRepository.js';
import { readStickerAssetBuffer } from './stickerStorageService.js';
import { sanitizeText } from './stickerPackUtils.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

export const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
      ? withLeadingSlash.slice(0, -1)
      : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

export const normalizeCatalogVisibility = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'unlisted') return 'unlisted';
  return 'public';
};

export const stripWebpExtension = (value) => String(value || '').trim().replace(/\.webp$/i, '');

const clampInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const STICKER_CATALOG_ENABLED = parseEnvBool(process.env.STICKER_CATALOG_ENABLED, true);
const STICKER_WEB_PATH = normalizeBasePath(process.env.STICKER_WEB_PATH, '/stickers');
const STICKER_API_BASE_PATH = normalizeBasePath(process.env.STICKER_API_BASE_PATH, '/api/sticker-packs');
const STICKER_ORPHAN_API_PATH = `${STICKER_API_BASE_PATH}/orphan-stickers`;
const STICKER_DATA_PUBLIC_PATH = normalizeBasePath(process.env.STICKER_DATA_PUBLIC_PATH, '/data');
const STICKER_DATA_PUBLIC_DIR = path.resolve(process.env.STICKER_DATA_PUBLIC_DIR || path.join(process.cwd(), 'data'));
const CATALOG_PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const CATALOG_TEMPLATE_PATH = path.join(CATALOG_PUBLIC_DIR, 'index.html');
const CATALOG_STYLES_FILE_PATH = path.join(CATALOG_PUBLIC_DIR, 'css', 'styles.css');
const CATALOG_SCRIPT_FILE_PATH = path.join(CATALOG_PUBLIC_DIR, 'js', 'catalog.js');
const DEFAULT_LIST_LIMIT = clampInt(process.env.STICKER_WEB_LIST_LIMIT, 24, 1, 60);
const MAX_LIST_LIMIT = clampInt(process.env.STICKER_WEB_LIST_MAX_LIMIT, 60, 1, 100);
const DEFAULT_ORPHAN_LIST_LIMIT = clampInt(process.env.STICKER_ORPHAN_LIST_LIMIT, 120, 1, 300);
const MAX_ORPHAN_LIST_LIMIT = clampInt(process.env.STICKER_ORPHAN_LIST_MAX_LIMIT, 300, 1, 500);
const DEFAULT_DATA_LIST_LIMIT = clampInt(process.env.STICKER_DATA_LIST_LIMIT, 50, 1, 200);
const MAX_DATA_LIST_LIMIT = clampInt(process.env.STICKER_DATA_LIST_MAX_LIMIT, 200, 1, 500);
const MAX_DATA_SCAN_FILES = clampInt(process.env.STICKER_DATA_SCAN_MAX_FILES, 10000, 100, 50000);
const ASSET_CACHE_SECONDS = clampInt(process.env.STICKER_WEB_ASSET_CACHE_SECONDS, 60 * 10, 0, 60 * 60 * 24 * 7);
const METRICS_ENDPOINT =
  process.env.METRICS_ENDPOINT ||
  `http://127.0.0.1:${process.env.METRICS_PORT || 9102}${process.env.METRICS_PATH || '/metrics'}`;
const METRICS_SUMMARY_TIMEOUT_MS = clampInt(process.env.STICKER_SYSTEM_METRICS_TIMEOUT_MS, 1200, 300, 5000);
const DATA_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp']);

const hasPathPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const isPackPubliclyVisible = (pack) => pack?.visibility === 'public' || pack?.visibility === 'unlisted';
const toIsoOrNull = (value) => (value ? new Date(value).toISOString() : null);
const formatDuration = (totalSeconds) => {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const hhmmss = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
};

const sendJson = (req, res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

const sendText = (req, res, statusCode, body, contentType) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

const sendAsset = (req, res, buffer, mimetype = 'image/webp') => {
  res.statusCode = 200;
  res.setHeader('Content-Type', mimetype);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', `public, max-age=${ASSET_CACHE_SECONDS}`);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(buffer);
};

const parsePrometheusLabels = (raw) => {
  if (!raw) return {};
  const labels = {};
  const regex = /(\w+)="((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return labels;
};

const parsePrometheusText = (text) => {
  const series = new Map();
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const [metricPart, valuePart] = trimmed.split(/\s+/, 2);
    if (!metricPart || !valuePart) continue;
    const value = Number(valuePart);
    if (!Number.isFinite(value)) continue;

    let name = metricPart;
    let labels = {};
    const labelStart = metricPart.indexOf('{');
    if (labelStart !== -1) {
      name = metricPart.slice(0, labelStart);
      const labelBody = metricPart.slice(labelStart + 1, metricPart.lastIndexOf('}'));
      labels = parsePrometheusLabels(labelBody);
    }

    const list = series.get(name) || [];
    list.push({ labels, value });
    series.set(name, list);
  }
  return series;
};

const pickMetricValue = (series, name) => {
  const list = series.get(name) || [];
  return list.length ? list[0].value : null;
};

const sumMetricValues = (series, name) => {
  const list = series.get(name) || [];
  return list.reduce((sum, entry) => sum + (Number.isFinite(entry.value) ? entry.value : 0), 0);
};

const fetchPrometheusSummary = async () => {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch indisponivel');
  }

  const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), METRICS_SUMMARY_TIMEOUT_MS);

  try {
    const response = await globalThis.fetch(METRICS_ENDPOINT, controller ? { signal: controller.signal } : {});
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const series = parsePrometheusText(text);

    const processStart = pickMetricValue(series, 'omnizap_process_start_time_seconds');
    const nowSeconds = Date.now() / 1000;
    const processUptimeSeconds = Number.isFinite(processStart) ? Math.max(0, nowSeconds - processStart) : null;

    const lagP99 = pickMetricValue(series, 'omnizap_nodejs_eventloop_lag_p99_seconds');
    const dbTotal = sumMetricValues(series, 'omnizap_db_query_total');
    const dbSlow = sumMetricValues(series, 'omnizap_db_slow_queries_total');

    const queueDepthSeries = series.get('omnizap_queue_depth') || [];
    const queuePeak = queueDepthSeries.reduce((max, entry) => {
      if (!Number.isFinite(entry.value)) return max;
      return Math.max(max, entry.value);
    }, 0);

    return {
      process_uptime: processUptimeSeconds !== null ? formatDuration(processUptimeSeconds) : 'n/a',
      lag_p99_ms: Number.isFinite(lagP99) ? Number((lagP99 * 1000).toFixed(2)) : null,
      db_total: Math.round(dbTotal || 0),
      db_slow: Math.round(dbSlow || 0),
      queue_peak: Math.round(queuePeak || 0),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const buildPackApiUrl = (packKey) => `${STICKER_API_BASE_PATH}/${encodeURIComponent(packKey)}`;
const buildPackWebUrl = (packKey) => `${STICKER_WEB_PATH}/${encodeURIComponent(packKey)}`;
const buildStickerAssetUrl = (packKey, stickerId) =>
  `${STICKER_API_BASE_PATH}/${encodeURIComponent(packKey)}/stickers/${encodeURIComponent(stickerId)}.webp`;
const buildOrphanStickersApiUrl = () => STICKER_ORPHAN_API_PATH;
const buildDataAssetApiBaseUrl = () => `${STICKER_API_BASE_PATH}/data-files`;
const buildCatalogStylesUrl = () => `${STICKER_WEB_PATH}/assets/styles.css`;
const buildCatalogScriptUrl = () => `${STICKER_WEB_PATH}/assets/catalog.js`;
const buildDataAssetUrl = (relativePath) =>
  `${STICKER_DATA_PUBLIC_PATH}/${String(relativePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;

const normalizeRelativePath = (value) => String(value || '').split(path.sep).join('/').replace(/^\/+/, '');
const isAllowedDataImageFile = (filePath) => DATA_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
const isInsideDataPublicRoot = (targetPath) =>
  targetPath === STICKER_DATA_PUBLIC_DIR || targetPath.startsWith(`${STICKER_DATA_PUBLIC_DIR}${path.sep}`);

const toPublicDataUrlFromStoragePath = (storagePath) => {
  if (!storagePath) return null;
  const absolutePath = path.resolve(String(storagePath));
  if (!isInsideDataPublicRoot(absolutePath)) return null;

  const relativePath = normalizeRelativePath(path.relative(STICKER_DATA_PUBLIC_DIR, absolutePath));
  if (!relativePath || relativePath.startsWith('..')) return null;
  return buildDataAssetUrl(relativePath);
};

const toImageMimeType = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.avif') return 'image/avif';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/webp';
};

const listDataImageFiles = async () => {
  const files = [];
  const queue = [STICKER_DATA_PUBLIC_DIR];

  while (queue.length && files.length < MAX_DATA_SCAN_FILES) {
    const currentDir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);

      if (!isInsideDataPublicRoot(absolutePath)) continue;
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!isAllowedDataImageFile(entry.name)) continue;

      const relativePath = normalizeRelativePath(path.relative(STICKER_DATA_PUBLIC_DIR, absolutePath));
      if (!relativePath || relativePath.startsWith('..')) continue;

      let stat = null;
      try {
        stat = await fs.stat(absolutePath);
      } catch {
        stat = null;
      }

      files.push({
        name: path.basename(relativePath),
        relative_path: relativePath,
        size_bytes: stat?.size ?? null,
        updated_at: stat?.mtime ? stat.mtime.toISOString() : null,
        created_at: stat?.ctime ? stat.ctime.toISOString() : null,
        url: buildDataAssetUrl(relativePath),
      });

      if (files.length >= MAX_DATA_SCAN_FILES) break;
    }
  }

  files.sort((left, right) => {
    const leftTime = left.updated_at ? Date.parse(left.updated_at) : 0;
    const rightTime = right.updated_at ? Date.parse(right.updated_at) : 0;
    return rightTime - leftTime;
  });

  return files;
};

const mapPackSummary = (pack) => ({
  id: pack.id,
  pack_key: pack.pack_key,
  name: pack.name,
  publisher: pack.publisher,
  description: pack.description || null,
  visibility: pack.visibility,
  sticker_count: Number(pack.sticker_count || 0),
  cover_sticker_id: pack.cover_sticker_id || null,
  cover_url: pack.cover_sticker_id ? buildStickerAssetUrl(pack.pack_key, pack.cover_sticker_id) : null,
  api_url: buildPackApiUrl(pack.pack_key),
  web_url: buildPackWebUrl(pack.pack_key),
  updated_at: toIsoOrNull(pack.updated_at),
});

const mapPackDetails = (pack, items) => {
  const coverStickerId = pack.cover_sticker_id || items[0]?.sticker_id || null;

  return {
    ...mapPackSummary({
      ...pack,
      cover_sticker_id: coverStickerId,
      sticker_count: items.length,
    }),
    items: items.map((item) => ({
      id: item.id,
      sticker_id: item.sticker_id,
      position: Number(item.position || 0),
      emojis: Array.isArray(item.emojis) ? item.emojis : [],
      accessibility_label: item.accessibility_label || null,
      created_at: toIsoOrNull(item.created_at),
      asset_url: buildStickerAssetUrl(pack.pack_key, item.sticker_id),
      asset: item.asset
        ? {
            id: item.asset.id,
            mimetype: item.asset.mimetype || 'image/webp',
            is_animated: Boolean(item.asset.is_animated),
            width: item.asset.width !== null && item.asset.width !== undefined ? Number(item.asset.width) : null,
            height: item.asset.height !== null && item.asset.height !== undefined ? Number(item.asset.height) : null,
            size_bytes:
              item.asset.size_bytes !== null && item.asset.size_bytes !== undefined ? Number(item.asset.size_bytes) : 0,
          }
        : null,
    })),
  };
};

const mapOrphanStickerAsset = (asset) => ({
  id: asset.id,
  owner_jid: asset.owner_jid,
  sha256: asset.sha256,
  mimetype: asset.mimetype || 'image/webp',
  is_animated: Boolean(asset.is_animated),
  width: asset.width !== null && asset.width !== undefined ? Number(asset.width) : null,
  height: asset.height !== null && asset.height !== undefined ? Number(asset.height) : null,
  size_bytes: asset.size_bytes !== null && asset.size_bytes !== undefined ? Number(asset.size_bytes) : 0,
  created_at: toIsoOrNull(asset.created_at),
  url: toPublicDataUrlFromStoragePath(asset.storage_path),
});

export const extractPackKeyFromWebPath = (pathname) => {
  if (!hasPathPrefix(pathname, STICKER_WEB_PATH)) return null;

  const suffix = pathname.slice(STICKER_WEB_PATH.length);
  if (!suffix || suffix === '/') return null;

  const [firstSegment] = suffix.split('/').filter(Boolean);
  if (!firstSegment) return null;

  try {
    return decodeURIComponent(firstSegment);
  } catch {
    return null;
  }
};

const escapeHtmlAttribute = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const renderCatalogHtml = async ({ initialPackKey }) => {
  const template = await fs.readFile(CATALOG_TEMPLATE_PATH, 'utf8');
  const replacements = {
    __STICKER_WEB_PATH__: escapeHtmlAttribute(STICKER_WEB_PATH),
    __STICKER_API_BASE_PATH__: escapeHtmlAttribute(STICKER_API_BASE_PATH),
    __STICKER_ORPHAN_API_PATH__: escapeHtmlAttribute(buildOrphanStickersApiUrl()),
    __STICKER_DATA_PUBLIC_PATH__: escapeHtmlAttribute(STICKER_DATA_PUBLIC_PATH),
    __DEFAULT_LIST_LIMIT__: String(DEFAULT_LIST_LIMIT),
    __DEFAULT_ORPHAN_LIST_LIMIT__: String(DEFAULT_ORPHAN_LIST_LIMIT),
    __INITIAL_PACK_KEY__: escapeHtmlAttribute(initialPackKey || ''),
    __CATALOG_STYLES_PATH__: escapeHtmlAttribute(buildCatalogStylesUrl()),
    __CATALOG_SCRIPT_PATH__: escapeHtmlAttribute(buildCatalogScriptUrl()),
    __CURRENT_YEAR__: String(new Date().getFullYear()),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(token, value);
  }
  return html;
};

const sendStaticTextFile = async (req, res, filePath, contentType) => {
  try {
    const body = await fs.readFile(filePath, 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(body);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(req, res, 404, { error: 'Arquivo estatico nao encontrado.' });
      return true;
    }

    logger.error('Falha ao servir asset estatico do catalogo.', {
      action: 'sticker_catalog_static_asset_failed',
      path: filePath,
      error: error?.message,
    });
    sendJson(req, res, 500, { error: 'Falha ao servir arquivo estatico.' });
    return true;
  }
};

const handleCatalogStaticAssetRequest = async (req, res, pathname) => {
  if (pathname === buildCatalogStylesUrl()) {
    return sendStaticTextFile(req, res, CATALOG_STYLES_FILE_PATH, 'text/css; charset=utf-8');
  }

  if (pathname === buildCatalogScriptUrl()) {
    return sendStaticTextFile(req, res, CATALOG_SCRIPT_FILE_PATH, 'application/javascript; charset=utf-8');
  }

  return false;
};

const handleListRequest = async (req, res, url) => {
  const q = sanitizeText(url.searchParams.get('q') || '', 120, { allowEmpty: true }) || '';
  const visibility = normalizeCatalogVisibility(url.searchParams.get('visibility'));
  const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000);

  const { packs, hasMore } = await listStickerPacksForCatalog({
    visibility,
    search: q,
    limit,
    offset,
  });

  sendJson(req, res, 200, {
    data: packs.map((pack) => mapPackSummary(pack)),
    pagination: {
      limit,
      offset,
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
    },
    filters: {
      q,
      visibility,
    },
  });
};

const handleOrphanStickerListRequest = async (req, res, url) => {
  const q = sanitizeText(url.searchParams.get('q') || '', 140, { allowEmpty: true }) || '';
  const limit = clampInt(url.searchParams.get('limit'), DEFAULT_ORPHAN_LIST_LIMIT, 1, MAX_ORPHAN_LIST_LIMIT);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);

  const { assets, hasMore, total } = await listStickerAssetsWithoutPack({
    search: q,
    limit,
    offset,
  });
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  sendJson(req, res, 200, {
    data: assets.map((asset) => mapOrphanStickerAsset(asset)),
    pagination: {
      limit,
      offset,
      page: currentPage,
      total,
      total_pages: totalPages,
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
    },
    filters: {
      q,
    },
  });
};

const handleDataFileListRequest = async (req, res, url) => {
  const q = sanitizeText(url.searchParams.get('q') || '', 140, { allowEmpty: true }) || '';
  const limit = clampInt(url.searchParams.get('limit'), DEFAULT_DATA_LIST_LIMIT, 1, MAX_DATA_LIST_LIMIT);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);
  const normalizedQuery = q.toLowerCase();

  const allFiles = await listDataImageFiles();
  const filteredFiles = normalizedQuery
    ? allFiles.filter(
        (item) => item.name.toLowerCase().includes(normalizedQuery) || item.relative_path.toLowerCase().includes(normalizedQuery),
      )
    : allFiles;

  const page = filteredFiles.slice(offset, offset + limit);
  const hasMore = offset + limit < filteredFiles.length;

  sendJson(req, res, 200, {
    data: page,
    pagination: {
      limit,
      offset,
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
      total: filteredFiles.length,
    },
    filters: {
      q,
    },
    meta: {
      root: STICKER_DATA_PUBLIC_DIR,
      public_path: STICKER_DATA_PUBLIC_PATH,
      api_base: buildDataAssetApiBaseUrl(),
    },
  });
};

const handleSystemSummaryRequest = async (req, res) => {
  const system = getSystemMetrics();
  let prometheus = null;
  let prometheusError = null;

  try {
    prometheus = await fetchPrometheusSummary();
  } catch (error) {
    prometheusError = error?.message || 'Falha ao consultar /metrics';
  }

  sendJson(req, res, 200, {
    data: {
      host: {
        cpu_percent: system.usoCpuPercentual,
        memory_percent: system.usoMemoriaPercentual,
        memory_used: system.memoriaUsada,
        memory_total: system.memoriaTotal,
        uptime: system.uptimeSistema,
      },
      process: {
        uptime: prometheus?.process_uptime || system.uptime,
        node_version: system.versaoNode,
      },
      observability: {
        lag_p99_ms: prometheus?.lag_p99_ms ?? null,
        db_total: prometheus?.db_total ?? null,
        db_slow: prometheus?.db_slow ?? null,
        queue_peak: prometheus?.queue_peak ?? null,
      },
      updated_at: new Date().toISOString(),
    },
    meta: {
      metrics_endpoint: METRICS_ENDPOINT,
      metrics_ok: Boolean(prometheus),
      metrics_error: prometheusError,
    },
  });
};

const handlePublicDataAssetRequest = async (req, res, pathname) => {
  const suffix = pathname.slice(STICKER_DATA_PUBLIC_PATH.length).replace(/^\/+/, '');
  if (!suffix) {
    sendJson(req, res, 400, {
      error: 'Informe o caminho do arquivo. Exemplo: /data/stickers/arquivo.webp',
    });
    return true;
  }

  const decodedSegments = suffix.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });

  const relativePath = normalizeRelativePath(decodedSegments.join('/'));
  if (!relativePath || relativePath.includes('..') || !isAllowedDataImageFile(relativePath)) {
    sendJson(req, res, 400, { error: 'Caminho de imagem invalido.' });
    return true;
  }

  const absolutePath = path.resolve(STICKER_DATA_PUBLIC_DIR, relativePath);
  if (!isInsideDataPublicRoot(absolutePath)) {
    sendJson(req, res, 403, { error: 'Acesso negado.' });
    return true;
  }

  try {
    const buffer = await fs.readFile(absolutePath);
    sendAsset(req, res, buffer, toImageMimeType(absolutePath));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(req, res, 404, { error: 'Imagem nao encontrada.' });
      return true;
    }

    logger.error('Falha ao servir imagem da pasta data.', {
      action: 'sticker_catalog_data_asset_failed',
      error: error?.message,
      relative_path: relativePath,
    });
    sendJson(req, res, 500, { error: 'Falha ao ler imagem no servidor.' });
    return true;
  }
};

const handleDetailsRequest = async (req, res, packKey) => {
  const normalizedPackKey = sanitizeText(packKey, 160, { allowEmpty: false });
  if (!normalizedPackKey) {
    sendJson(req, res, 400, { error: 'pack_key invalido.' });
    return;
  }

  const pack = await findStickerPackByPackKey(normalizedPackKey);
  if (!pack || !isPackPubliclyVisible(pack)) {
    sendJson(req, res, 404, { error: 'Pack nao encontrado.' });
    return;
  }

  const items = await listStickerPackItems(pack.id);
  sendJson(req, res, 200, {
    data: mapPackDetails(pack, items),
  });
};

const handleAssetRequest = async (req, res, packKey, stickerToken) => {
  const normalizedPackKey = sanitizeText(packKey, 160, { allowEmpty: false });
  const normalizedStickerId = sanitizeText(stripWebpExtension(stickerToken), 36, { allowEmpty: false });

  if (!normalizedPackKey || !normalizedStickerId) {
    sendJson(req, res, 400, { error: 'Parametros invalidos.' });
    return;
  }

  const pack = await findStickerPackByPackKey(normalizedPackKey);
  if (!pack || !isPackPubliclyVisible(pack)) {
    sendJson(req, res, 404, { error: 'Pack nao encontrado.' });
    return;
  }

  const items = await listStickerPackItems(pack.id);
  const item = items.find((entry) => entry.sticker_id === normalizedStickerId);

  if (!item?.asset) {
    sendJson(req, res, 404, { error: 'Sticker nao encontrado.' });
    return;
  }

  try {
    const buffer = await readStickerAssetBuffer(item.asset);
    sendAsset(req, res, buffer, item.asset.mimetype || 'image/webp');
  } catch (error) {
    logger.warn('Falha ao ler asset de sticker para rota web.', {
      action: 'sticker_catalog_asset_read_failed',
      pack_key: normalizedPackKey,
      sticker_id: normalizedStickerId,
      error: error?.message,
    });
    sendJson(req, res, 404, { error: 'Arquivo de sticker indisponivel.' });
  }
};

const handleCatalogApiRequest = async (req, res, pathname, url) => {
  if (pathname === STICKER_API_BASE_PATH) {
    await handleListRequest(req, res, url);
    return true;
  }

  if (pathname === STICKER_ORPHAN_API_PATH) {
    await handleOrphanStickerListRequest(req, res, url);
    return true;
  }

  const suffix = pathname.slice(STICKER_API_BASE_PATH.length).replace(/^\/+/, '');
  if (!suffix) return false;

  const segments = suffix.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });

  if (segments.length === 1 && segments[0] === 'data-files') {
    await handleDataFileListRequest(req, res, url);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'system-summary') {
    await handleSystemSummaryRequest(req, res);
    return true;
  }

  if (segments.length === 1) {
    await handleDetailsRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'stickers') {
    await handleAssetRequest(req, res, segments[0], segments[2]);
    return true;
  }

  sendJson(req, res, 404, { error: 'Rota de sticker pack nao encontrada.' });
  return true;
};

const handleCatalogPageRequest = async (req, res, pathname) => {
  const initialPackKey = extractPackKeyFromWebPath(pathname);

  try {
    const html = await renderCatalogHtml({ initialPackKey });
    sendText(req, res, 200, html, 'text/html; charset=utf-8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(req, res, 404, { error: 'Template do catalogo nao encontrado.' });
      return;
    }

    logger.error('Falha ao renderizar pagina do catalogo de sticker packs.', {
      action: 'sticker_catalog_page_render_failed',
      path: pathname,
      error: error?.message,
    });
    sendJson(req, res, 500, { error: 'Falha interna ao renderizar catalogo.' });
  }
};

export const isStickerCatalogEnabled = () => STICKER_CATALOG_ENABLED;
export const getStickerCatalogConfig = () => ({
  enabled: STICKER_CATALOG_ENABLED,
  webPath: STICKER_WEB_PATH,
  apiBasePath: STICKER_API_BASE_PATH,
  orphanApiPath: STICKER_ORPHAN_API_PATH,
  dataPublicPath: STICKER_DATA_PUBLIC_PATH,
  dataPublicDir: STICKER_DATA_PUBLIC_DIR,
  stylesPath: buildCatalogStylesUrl(),
  scriptPath: buildCatalogScriptUrl(),
});

/**
 * Manipula rotas web/API de catalogo de sticker packs.
 *
 * @param {import('node:http').IncomingMessage} req Requisicao HTTP.
 * @param {import('node:http').ServerResponse} res Resposta HTTP.
 * @param {{ pathname: string, url: URL }} context Contexto parseado da URL.
 * @returns {Promise<boolean>} `true` quando a rota foi tratada.
 */
export async function maybeHandleStickerCatalogRequest(req, res, { pathname, url }) {
  if (!STICKER_CATALOG_ENABLED) return false;
  if (!['GET', 'HEAD'].includes(req.method || '')) return false;

  if (hasPathPrefix(pathname, STICKER_DATA_PUBLIC_PATH)) {
    return handlePublicDataAssetRequest(req, res, pathname);
  }

  if (hasPathPrefix(pathname, STICKER_WEB_PATH)) {
    const handledStaticAsset = await handleCatalogStaticAssetRequest(req, res, pathname);
    if (handledStaticAsset) return true;

    await handleCatalogPageRequest(req, res, pathname);
    return true;
  }

  if (hasPathPrefix(pathname, STICKER_API_BASE_PATH)) {
    try {
      return await handleCatalogApiRequest(req, res, pathname, url);
    } catch (error) {
      logger.error('Erro ao processar API de sticker packs.', {
        action: 'sticker_catalog_api_error',
        path: pathname,
        error: error?.message,
      });
      sendJson(req, res, 500, { error: 'Falha interna ao processar a requisicao.' });
      return true;
    }
  }

  return false;
}
