import fs from 'node:fs/promises';
import path from 'node:path';

import { executeQuery } from '../../../database/index.js';
import { getJidUser, normalizeJid, resolveBotJid } from '../../config/baileysConfig.js';
import { getActiveSocket } from '../../services/socketState.js';
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
const STICKER_WEB_WHATSAPP_MESSAGE_TEMPLATE =
  String(process.env.STICKER_WEB_WHATSAPP_MESSAGE_TEMPLATE || '/pack send {{pack_key}}').trim() ||
  '/pack send {{pack_key}}';
const METRICS_ENDPOINT =
  process.env.METRICS_ENDPOINT ||
  `http://127.0.0.1:${process.env.METRICS_PORT || 9102}${process.env.METRICS_PATH || '/metrics'}`;
const METRICS_SUMMARY_TIMEOUT_MS = clampInt(process.env.STICKER_SYSTEM_METRICS_TIMEOUT_MS, 1200, 300, 5000);
const GITHUB_REPOSITORY = String(process.env.GITHUB_REPOSITORY || 'Kaikygr/omnizap-system').trim();
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const GITHUB_PROJECT_CACHE_SECONDS = clampInt(process.env.GITHUB_PROJECT_CACHE_SECONDS, 300, 30, 3600);
const GLOBAL_RANK_REFRESH_SECONDS = clampInt(process.env.GLOBAL_RANK_REFRESH_SECONDS, 600, 60, 3600);
const DATA_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp']);

const hasPathPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const isPackPubliclyVisible = (pack) => pack?.visibility === 'public' || pack?.visibility === 'unlisted';
const toIsoOrNull = (value) => (value ? new Date(value).toISOString() : null);
const GITHUB_PROJECT_CACHE = {
  expiresAt: 0,
  value: null,
};
const GLOBAL_RANK_CACHE = {
  expiresAt: 0,
  value: null,
  pending: null,
};
let globalRankRefreshTimer = null;
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

const normalizeGitHubRepo = (value) => {
  const raw = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const [owner, repo] = raw.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
  };
};

const GITHUB_REPO_INFO = normalizeGitHubRepo(GITHUB_REPOSITORY);

const githubFetchJson = async (url) => {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch indisponivel');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'omnizap-system/2.1',
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await globalThis.fetch(url, { headers });
  if (!response.ok) {
    const error = new Error(`GitHub HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
};

const githubFetchJsonSafe = async (url, fallbackValue) => {
  try {
    return await githubFetchJson(url);
  } catch {
    return fallbackValue;
  }
};

const mapGitHubProjectSummary = (repoData, latestReleaseData, releasesData = [], commitsData = [], languagesData = {}, openPrs = null) => ({
  repository: repoData?.full_name || GITHUB_REPO_INFO?.fullName || null,
  html_url: repoData?.html_url || (GITHUB_REPO_INFO ? `https://github.com/${GITHUB_REPO_INFO.fullName}` : null),
  description: repoData?.description || null,
  stars: Number(repoData?.stargazers_count || 0),
  forks: Number(repoData?.forks_count || 0),
  open_issues: Number(repoData?.open_issues_count || 0),
  open_prs: Number.isFinite(Number(openPrs)) ? Number(openPrs) : null,
  watchers: Number(repoData?.subscribers_count || repoData?.watchers_count || 0),
  language: repoData?.language || null,
  languages: Object.entries(languagesData || {})
    .map(([name, bytes]) => ({ name, bytes: Number(bytes || 0) }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 6),
  topics: Array.isArray(repoData?.topics) ? repoData.topics : [],
  size_kb: Number(repoData?.size || 0),
  default_branch: repoData?.default_branch || null,
  license: repoData?.license?.spdx_id || repoData?.license?.name || null,
  created_at: toIsoOrNull(repoData?.created_at),
  updated_at: toIsoOrNull(repoData?.updated_at),
  pushed_at: toIsoOrNull(repoData?.pushed_at),
  latest_release: latestReleaseData
    ? {
        tag: latestReleaseData.tag_name || null,
        name: latestReleaseData.name || null,
        published_at: toIsoOrNull(latestReleaseData.published_at),
        html_url: latestReleaseData.html_url || null,
      }
    : null,
  latest_releases: (Array.isArray(releasesData) ? releasesData : []).slice(0, 5).map((release) => ({
    tag: release?.tag_name || null,
    name: release?.name || null,
    html_url: release?.html_url || null,
    draft: Boolean(release?.draft),
    prerelease: Boolean(release?.prerelease),
    published_at: toIsoOrNull(release?.published_at),
  })),
  latest_commits: (Array.isArray(commitsData) ? commitsData : []).slice(0, 5).map((commit) => ({
    sha: String(commit?.sha || '').slice(0, 7) || null,
    html_url: commit?.html_url || null,
    message: String(commit?.commit?.message || '').split('\n')[0] || null,
    author: commit?.commit?.author?.name || commit?.author?.login || null,
    date: toIsoOrNull(commit?.commit?.author?.date),
  })),
});

const fetchGitHubProjectSummary = async () => {
  if (!GITHUB_REPO_INFO) {
    throw new Error('GITHUB_REPOSITORY invalido');
  }

  const now = Date.now();
  if (GITHUB_PROJECT_CACHE.value && now < GITHUB_PROJECT_CACHE.expiresAt) {
    return GITHUB_PROJECT_CACHE.value;
  }

  const repoUrl = `https://api.github.com/repos/${encodeURIComponent(GITHUB_REPO_INFO.owner)}/${encodeURIComponent(
    GITHUB_REPO_INFO.repo,
  )}`;
  const releasesUrl = `${repoUrl}/releases?per_page=5`;
  const commitsUrl = `${repoUrl}/commits?per_page=5`;
  const languagesUrl = `${repoUrl}/languages`;
  const openPrsUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(
    `repo:${GITHUB_REPO_INFO.fullName} is:pr is:open`,
  )}&per_page=1`;

  const repoData = await githubFetchJson(repoUrl);
  const [releasesData, commitsData, languagesData, openPrsData] = await Promise.all([
    githubFetchJsonSafe(releasesUrl, []),
    githubFetchJsonSafe(commitsUrl, []),
    githubFetchJsonSafe(languagesUrl, {}),
    githubFetchJsonSafe(openPrsUrl, { total_count: null }),
  ]);

  const latestReleaseData = Array.isArray(releasesData) ? releasesData[0] || null : null;
  const summary = mapGitHubProjectSummary(
    repoData,
    latestReleaseData,
    releasesData,
    commitsData,
    languagesData,
    openPrsData?.total_count,
  );
  GITHUB_PROJECT_CACHE.value = summary;
  GITHUB_PROJECT_CACHE.expiresAt = now + GITHUB_PROJECT_CACHE_SECONDS * 1000;
  return summary;
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

const normalizePhoneDigits = (value) => String(value || '').replace(/\D+/g, '');

const resolveCatalogBotPhone = () => {
  const activeSocket = getActiveSocket();
  const botJid = resolveBotJid(activeSocket?.user?.id);
  const jidUser = getJidUser(botJid || '');
  const fromSocket = normalizePhoneDigits(jidUser);
  if (fromSocket) return fromSocket;

  const envCandidates = [
    process.env.WHATSAPP_BOT_NUMBER,
    process.env.BOT_NUMBER,
    process.env.PHONE_NUMBER,
    process.env.BOT_PHONE_NUMBER,
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizePhoneDigits(candidate);
    if (normalized) return normalized;
  }

  return '';
};

const buildPackWhatsAppText = (pack) =>
  STICKER_WEB_WHATSAPP_MESSAGE_TEMPLATE
    .replaceAll('{{pack_key}}', String(pack?.pack_key || ''))
    .replaceAll('{{pack_name}}', String(pack?.name || ''));

const buildPackWhatsAppInfo = (pack) => {
  const phone = resolveCatalogBotPhone();
  if (!phone) return null;

  const text = buildPackWhatsAppText(pack);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

  return {
    phone,
    text,
    url,
  };
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
  whatsapp: buildPackWhatsAppInfo(pack),
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

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout_${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

const parseMessageTypeFromRaw = (rawMessage) => {
  try {
    const message = JSON.parse(rawMessage || '{}')?.message || {};
    if (message.conversation || message.extendedTextMessage) return 'texto';
    if (message.imageMessage) return 'imagem';
    if (message.videoMessage) return 'video';
    if (message.audioMessage) return 'audio';
    if (message.stickerMessage) return 'figurinha';
    if (message.documentMessage) return 'documento';
    if (message.locationMessage) return 'localizacao';
    if (message.reactionMessage) return 'reacao';
    return 'outros';
  } catch {
    return 'outros';
  }
};

const resolveBotUserCandidates = (activeSocket) => {
  const candidates = new Set();
  const botJidFromSocket = resolveBotJid(activeSocket?.user?.id);
  const botUserFromSocket = getJidUser(botJidFromSocket || '');
  if (botUserFromSocket) candidates.add(String(botUserFromSocket).trim());
  const botPhoneFromCatalog = String(resolveCatalogBotPhone() || '').replace(/\D+/g, '');
  if (botPhoneFromCatalog) candidates.add(botPhoneFromCatalog);

  const envCandidates = [
    process.env.WHATSAPP_BOT_NUMBER,
    process.env.BOT_NUMBER,
    process.env.PHONE_NUMBER,
    process.env.BOT_PHONE_NUMBER,
  ];

  for (const candidate of envCandidates) {
    const digits = String(candidate || '').replace(/\D+/g, '');
    if (digits) candidates.add(digits);
  }

  return Array.from(candidates).filter((value) => value.length >= 8);
};

const isSenderFromAnyBotUser = (senderId, botUsers) => {
  const normalizedSender = String(senderId || '').trim();
  if (!normalizedSender) return false;
  return botUsers.some((botUser) => {
    const safe = String(botUser || '').trim();
    if (!safe) return false;
    return normalizedSender === `${safe}@s.whatsapp.net` || normalizedSender.startsWith(`${safe}:`) || normalizedSender.startsWith(`${safe}@`);
  });
};

const sanitizeRankingPayloadByBot = (payload, botUsers) => {
  const sourceRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const filteredRows = sourceRows.filter((row) => !isSenderFromAnyBotUser(row?.sender_id, botUsers));
  const normalizedRows = filteredRows.slice(0, Number(payload?.limit || 5)).map((row, index) => ({
    ...row,
    position: index + 1,
  }));
  const totalMessages = Number(payload?.total_messages || 0);
  const topTotal = normalizedRows.reduce((acc, row) => acc + Number(row?.total_messages || 0), 0);
  const topShare = totalMessages > 0 ? Number(((topTotal / totalMessages) * 100).toFixed(2)) : 0;

  return {
    ...payload,
    rows: normalizedRows,
    top_share_percent: topShare,
  };
};

const extractPushNameFromRaw = (rawMessage) => {
  try {
    const parsed = JSON.parse(rawMessage || '{}');
    const direct = String(parsed?.pushName || '').trim();
    if (direct) return direct;

    const nested = String(parsed?.message?.extendedTextMessage?.contextInfo?.participantName || '').trim();
    if (nested) return nested;
  } catch {
    return '';
  }
  return '';
};

const resolveRankingDisplayName = async (senderId) => {
  if (!senderId) return 'Desconhecido';
  const fallback = `@${String(getJidUser(senderId) || senderId).trim()}`;
  try {
    const rows = await executeQuery(
      `SELECT raw_message FROM messages
       WHERE sender_id = ?
         AND raw_message IS NOT NULL
       ORDER BY id DESC
       LIMIT 12`,
      [senderId],
    );
    for (const row of rows) {
      const name = extractPushNameFromRaw(row?.raw_message);
      if (name) return name;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const resolveRankingAvatarUrl = async (sock, senderId) => {
  if (!sock || !senderId || typeof sock.profilePictureUrl !== 'function') return null;
  const normalized = normalizeJid(senderId) || senderId;
  try {
    const url = await sock.profilePictureUrl(normalized, 'image');
    return typeof url === 'string' && url.trim() ? url : null;
  } catch {
    return null;
  }
};

const buildGlobalRankingSummary = async () => {
  const LIMIT = 5;
  const QUERY_LIMIT = 12;
  const SAMPLE_LIMIT = 50000;
  const activeSocket = getActiveSocket();
  const botUsers = resolveBotUserCandidates(activeSocket);

  const whereClauses = ['sender_id IS NOT NULL'];
  const params = [];
  for (const botUser of botUsers) {
    whereClauses.push('sender_id <> ?');
    params.push(`${botUser}@s.whatsapp.net`);
    whereClauses.push('sender_id NOT LIKE ?');
    whereClauses.push('sender_id NOT LIKE ?');
    params.push(`${botUser}@%`, `${botUser}:%`);
  }

  const where = whereClauses.join(' AND ');
  const recentScopeSql = `SELECT id, sender_id, timestamp, raw_message FROM messages WHERE ${where} ORDER BY id DESC LIMIT ${SAMPLE_LIMIT}`;

  const [totalRow] = await executeQuery(`SELECT COUNT(*) AS total FROM (${recentScopeSql}) recent_scope`, params);
  const totalMessages = Number(totalRow?.total || 0);

  const rows = await executeQuery(
    `SELECT
      recent_scope.sender_id,
      CONCAT('@', SUBSTRING_INDEX(recent_scope.sender_id, '@', 1)) AS display_name,
      COUNT(*) AS total_messages,
      MAX(
        CASE
          WHEN recent_scope.timestamp > 1000000000000 THEN FROM_UNIXTIME(recent_scope.timestamp / 1000)
          WHEN recent_scope.timestamp > 1000000000 THEN FROM_UNIXTIME(recent_scope.timestamp)
          ELSE recent_scope.timestamp
        END
      ) AS last_message
    FROM (${recentScopeSql}) recent_scope
    GROUP BY recent_scope.sender_id
    ORDER BY total_messages DESC
    LIMIT ${QUERY_LIMIT}`,
    params,
  );

  const typeRows = await executeQuery(
    `SELECT recent_scope.raw_message
     FROM (${recentScopeSql}) recent_scope
     WHERE recent_scope.raw_message IS NOT NULL
     ORDER BY recent_scope.id DESC
     LIMIT 300`,
    params,
  );

  const typeCounts = new Map();
  for (const row of typeRows) {
    const type = parseMessageTypeFromRaw(row?.raw_message);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }
  const sortedTypes = Array.from(typeCounts.entries()).sort((left, right) => right[1] - left[1]);
  const topType = sortedTypes[0]?.[0] || null;
  const topTypeCount = Number(sortedTypes[0]?.[1] || 0);

  const topTotal = rows.reduce((acc, row) => acc + Number(row?.total_messages || 0), 0);
  const topShare = totalMessages > 0 ? Number(((topTotal / totalMessages) * 100).toFixed(2)) : 0;

  const rowsWithoutBot = rows.filter((row) => !isSenderFromAnyBotUser(row?.sender_id, botUsers)).slice(0, LIMIT);

  const rowsEnriched = await Promise.all(
    rowsWithoutBot.map(async (row, index) => {
      const total = Number(row?.total_messages || 0);
      const percent = totalMessages > 0 ? Number(((total / totalMessages) * 100).toFixed(2)) : 0;
      const senderId = row?.sender_id || null;
      const displayName = await resolveRankingDisplayName(senderId);
      const avatarUrl = await resolveRankingAvatarUrl(activeSocket, senderId);
      return {
        position: index + 1,
        sender_id: senderId,
        mention_id: senderId,
        display_name: displayName || row?.display_name || senderId || 'Desconhecido',
        avatar_url: avatarUrl,
        total_messages: total,
        percent_of_total: percent,
        last_message: row?.last_message ? new Date(row.last_message).toISOString() : null,
      };
    }),
  );

  return {
    limit: LIMIT,
    sample_limit: SAMPLE_LIMIT,
    total_messages: totalMessages,
    top_share_percent: topShare,
    top_type: topType,
    top_type_count: topTypeCount,
    rows: rowsEnriched,
    updated_at: new Date().toISOString(),
  };
};

const getGlobalRankingSummaryCached = async () => {
  const now = Date.now();
  const hasValue = Boolean(GLOBAL_RANK_CACHE.value);

  if (hasValue && now < GLOBAL_RANK_CACHE.expiresAt) {
    return GLOBAL_RANK_CACHE.value;
  }

  if (!GLOBAL_RANK_CACHE.pending) {
    GLOBAL_RANK_CACHE.pending = withTimeout(buildGlobalRankingSummary(), 5000)
      .then((data) => {
        GLOBAL_RANK_CACHE.value = data;
        GLOBAL_RANK_CACHE.expiresAt = Date.now() + GLOBAL_RANK_REFRESH_SECONDS * 1000;
        return data;
      })
      .finally(() => {
        GLOBAL_RANK_CACHE.pending = null;
      });
  }

  if (hasValue) {
    return GLOBAL_RANK_CACHE.value;
  }

  return GLOBAL_RANK_CACHE.pending;
};

const scheduleGlobalRankingPreload = () => {
  if (globalRankRefreshTimer) return;

  getGlobalRankingSummaryCached().catch((error) => {
    logger.warn('Falha no preload inicial do ranking global.', {
      action: 'global_ranking_preload_init_error',
      error: error?.message,
    });
  });

  globalRankRefreshTimer = setInterval(() => {
    GLOBAL_RANK_CACHE.expiresAt = 0;
    getGlobalRankingSummaryCached().catch((error) => {
      logger.warn('Falha ao atualizar cache do ranking global em background.', {
        action: 'global_ranking_preload_refresh_error',
        error: error?.message,
      });
    });
  }, GLOBAL_RANK_REFRESH_SECONDS * 1000);

  if (typeof globalRankRefreshTimer?.unref === 'function') {
    globalRankRefreshTimer.unref();
  }
};

const handleGlobalRankingSummaryRequest = async (req, res) => {
  const activeSocket = getActiveSocket();
  const botUsers = resolveBotUserCandidates(activeSocket);
  try {
    const rawData = await getGlobalRankingSummaryCached();
    const data = sanitizeRankingPayloadByBot(rawData, botUsers);
    sendJson(req, res, 200, { data, meta: { cache_seconds: GLOBAL_RANK_REFRESH_SECONDS } });
  } catch (error) {
    logger.warn('Falha ao montar resumo do ranking global.', {
      action: 'global_ranking_summary_error',
      error: error?.message,
    });
    if (GLOBAL_RANK_CACHE.value) {
      sendJson(req, res, 200, {
        data: sanitizeRankingPayloadByBot(GLOBAL_RANK_CACHE.value, botUsers),
        meta: { cache_seconds: GLOBAL_RANK_REFRESH_SECONDS, stale: true, error: error?.message || 'fallback_cache' },
      });
      return;
    }
    sendJson(req, res, 503, { error: 'Ranking global indisponível no momento.' });
  }
};

const handleGitHubProjectSummaryRequest = async (req, res) => {
  if (!GITHUB_REPO_INFO) {
    sendJson(req, res, 500, { error: 'Configuracao de repositorio GitHub invalida.' });
    return;
  }

  try {
    const data = await fetchGitHubProjectSummary();
    sendJson(req, res, 200, {
      data,
      meta: {
        repository: GITHUB_REPO_INFO.fullName,
        token_configured: Boolean(GITHUB_TOKEN),
        cache_seconds: GITHUB_PROJECT_CACHE_SECONDS,
      },
    });
  } catch (error) {
    logger.warn('Falha ao consultar resumo do repositorio no GitHub.', {
      action: 'github_project_summary_error',
      repository: GITHUB_REPO_INFO.fullName,
      error: error?.message,
      status_code: error?.statusCode || null,
    });
    sendJson(req, res, 502, { error: 'Falha ao consultar dados do projeto no GitHub.' });
  }
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

  if (segments.length === 1 && segments[0] === 'project-summary') {
    await handleGitHubProjectSummaryRequest(req, res);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'global-ranking-summary') {
    await handleGlobalRankingSummaryRequest(req, res);
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

scheduleGlobalRankingPreload();

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
