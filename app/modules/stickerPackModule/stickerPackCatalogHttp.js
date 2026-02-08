import fs from 'node:fs/promises';
import path from 'node:path';

import logger from '../../utils/logger/loggerModule.js';
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
const DEFAULT_LIST_LIMIT = clampInt(process.env.STICKER_WEB_LIST_LIMIT, 24, 1, 60);
const MAX_LIST_LIMIT = clampInt(process.env.STICKER_WEB_LIST_MAX_LIMIT, 60, 1, 100);
const DEFAULT_ORPHAN_LIST_LIMIT = clampInt(process.env.STICKER_ORPHAN_LIST_LIMIT, 120, 1, 300);
const MAX_ORPHAN_LIST_LIMIT = clampInt(process.env.STICKER_ORPHAN_LIST_MAX_LIMIT, 300, 1, 500);
const DEFAULT_DATA_LIST_LIMIT = clampInt(process.env.STICKER_DATA_LIST_LIMIT, 50, 1, 200);
const MAX_DATA_LIST_LIMIT = clampInt(process.env.STICKER_DATA_LIST_MAX_LIMIT, 200, 1, 500);
const MAX_DATA_SCAN_FILES = clampInt(process.env.STICKER_DATA_SCAN_MAX_FILES, 10000, 100, 50000);
const ASSET_CACHE_SECONDS = clampInt(process.env.STICKER_WEB_ASSET_CACHE_SECONDS, 60 * 10, 0, 60 * 60 * 24 * 7);
const DATA_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp']);

const hasPathPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const isPackPubliclyVisible = (pack) => pack?.visibility === 'public' || pack?.visibility === 'unlisted';
const toIsoOrNull = (value) => (value ? new Date(value).toISOString() : null);

const jsonForInlineScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

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

const buildPackApiUrl = (packKey) => `${STICKER_API_BASE_PATH}/${encodeURIComponent(packKey)}`;
const buildPackWebUrl = (packKey) => `${STICKER_WEB_PATH}/${encodeURIComponent(packKey)}`;
const buildStickerAssetUrl = (packKey, stickerId) =>
  `${STICKER_API_BASE_PATH}/${encodeURIComponent(packKey)}/stickers/${encodeURIComponent(stickerId)}.webp`;
const buildOrphanStickersApiUrl = () => STICKER_ORPHAN_API_PATH;
const buildDataAssetApiBaseUrl = () => `${STICKER_API_BASE_PATH}/data-files`;
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

const renderCatalogHtml = ({ initialPackKey }) => {
  const clientConfig = {
    apiBasePath: STICKER_API_BASE_PATH,
    orphanApiPath: buildOrphanStickersApiUrl(),
    webPath: STICKER_WEB_PATH,
    dataPublicPath: STICKER_DATA_PUBLIC_PATH,
    initialPackKey: initialPackKey || null,
    defaultLimit: DEFAULT_LIST_LIMIT,
    defaultOrphanLimit: DEFAULT_ORPHAN_LIST_LIMIT,
  };

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OmniZap Sticker Packs</title>
  <meta name="description" content="Catalogo web de packs de figurinhas do OmniZap." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f7efe4;
      --ink: #14110e;
      --muted: #554d45;
      --card: #fffaf4;
      --stroke: #ddc7aa;
      --accent: #d55f2a;
      --accent-dark: #8e360f;
      --accent-soft: #f3b181;
      --ok: #007a59;
      --shadow: rgba(56, 26, 10, 0.12);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Bricolage Grotesque", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 10% 15%, rgba(213, 95, 42, 0.14), transparent 34%),
        radial-gradient(circle at 85% 0%, rgba(0, 122, 89, 0.16), transparent 28%),
        linear-gradient(135deg, #fff4e5 0%, var(--bg) 48%, #e9f4ee 100%);
    }

    .page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 28px 18px 48px;
    }

    .hero {
      border: 1px solid var(--stroke);
      border-radius: 20px;
      padding: 26px 24px;
      background: linear-gradient(120deg, rgba(255, 250, 244, 0.96), rgba(255, 236, 215, 0.9));
      box-shadow: 0 18px 46px var(--shadow);
      animation: rise 420ms ease-out;
    }

    .kicker {
      margin: 0 0 12px;
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent-dark);
      font-weight: 700;
    }

    .title {
      margin: 0 0 10px;
      font-family: "Instrument Serif", serif;
      font-weight: 400;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1.02;
      max-width: 18ch;
    }

    .subtitle {
      margin: 0;
      max-width: 60ch;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.45;
    }

    .toolbar {
      margin-top: 18px;
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 10px;
    }

    .input,
    .select,
    .button {
      border-radius: 12px;
      border: 1px solid var(--stroke);
      min-height: 42px;
      font: inherit;
    }

    .input,
    .select {
      background: #fff;
      padding: 0 12px;
    }

    .button {
      border-color: transparent;
      background: linear-gradient(120deg, var(--accent), #eb864f);
      color: #fff;
      font-weight: 700;
      padding: 0 16px;
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease;
      box-shadow: 0 10px 24px rgba(213, 95, 42, 0.28);
    }

    .button:hover {
      transform: translateY(-1px);
    }

    .status {
      margin: 16px 2px 0;
      font-size: 13px;
      color: var(--muted);
      min-height: 18px;
    }

    .grid {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 14px;
    }

    .section-title {
      margin: 28px 0 8px;
      font-family: "Instrument Serif", serif;
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.05;
    }

    .orphan-grid {
      margin-top: 8px;
    }

    .orphan-item {
      border: 1px solid var(--stroke);
      border-radius: 12px;
      padding: 8px;
      background: #fff;
      display: grid;
      gap: 6px;
    }

    .orphan-item img {
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: contain;
      border-radius: 8px;
      background: #f6f6f6;
      display: block;
    }

    .orphan-meta {
      margin: 0;
      font-size: 11px;
      color: var(--muted);
      line-height: 1.35;
      word-break: break-word;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      border: 1px solid var(--stroke);
      border-radius: 16px;
      background: var(--card);
      padding: 10px;
      cursor: pointer;
      transition: transform 190ms ease, box-shadow 190ms ease, border-color 190ms ease;
      animation: rise 420ms ease-out;
    }

    .card:hover {
      transform: translateY(-2px);
      border-color: #cca074;
      box-shadow: 0 12px 22px var(--shadow);
    }

    .thumb-wrap {
      border-radius: 12px;
      overflow: hidden;
      background: linear-gradient(130deg, #fee2c8, #dbf0e6);
      aspect-ratio: 1 / 1;
      display: grid;
      place-items: center;
    }

    .thumb {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      background: rgba(255, 255, 255, 0.75);
    }

    .thumb-fallback {
      color: var(--muted);
      font-size: 12px;
      text-align: center;
      padding: 10px;
      line-height: 1.4;
    }

    .card h3 {
      margin: 0;
      font-size: 15px;
      line-height: 1.2;
      font-weight: 700;
      word-break: break-word;
    }

    .meta {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .load-more {
      margin: 20px auto 0;
      display: block;
    }

    .panel {
      position: fixed;
      inset: auto 0 0 0;
      max-height: 86vh;
      transform: translateY(102%);
      transition: transform 260ms ease;
      background: rgba(255, 250, 243, 0.98);
      border-top: 1px solid var(--stroke);
      box-shadow: 0 -22px 38px rgba(30, 20, 10, 0.2);
      overflow: auto;
      z-index: 20;
    }

    .panel.open {
      transform: translateY(0%);
    }

    .panel-inner {
      max-width: 1100px;
      margin: 0 auto;
      padding: 16px 18px 24px;
    }

    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }

    .panel-title {
      margin: 0;
      font-family: "Instrument Serif", serif;
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      line-height: 1.02;
    }

    .panel-sub {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #fff;
      border: 1px solid var(--stroke);
      font-size: 12px;
      color: var(--muted);
    }

    .close {
      background: #fff;
      color: var(--accent-dark);
      border: 1px solid var(--stroke);
      border-radius: 10px;
      min-width: 40px;
      min-height: 40px;
      cursor: pointer;
      font-weight: 700;
    }

    .stickers {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }

    .sticker {
      border: 1px solid var(--stroke);
      border-radius: 12px;
      padding: 8px;
      background: #fff;
    }

    .sticker img {
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: contain;
      display: block;
      border-radius: 8px;
      background: #f6f6f6;
    }

    .copy {
      margin-top: 14px;
      border: 1px solid var(--stroke);
      background: #fff;
      border-radius: 10px;
      padding: 8px 12px;
      color: var(--ink);
      cursor: pointer;
      font-weight: 600;
    }

    .error {
      color: #9f2222;
      font-size: 14px;
      margin-top: 10px;
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 700px) {
      .toolbar {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <p class="kicker">OmniZap / Sticker Catalog</p>
      <h1 class="title">Explore packs de figurinhas em uma pagina web.</h1>
      <p class="subtitle">
        Catalogo publico com busca, filtros e visualizacao completa dos packs. Clique em qualquer card para abrir os stickers.
      </p>
      <form id="search-form" class="toolbar">
        <input id="search-input" class="input" type="search" placeholder="Buscar por nome, publisher ou pack id" autocomplete="off" />
        <select id="visibility-input" class="select">
          <option value="public">Publicos</option>
          <option value="unlisted">Nao listados</option>
          <option value="all">Publicos + nao listados</option>
        </select>
        <button class="button" type="submit">Pesquisar</button>
      </form>
      <div id="status" class="status"></div>
    </section>

    <section>
      <div id="grid" class="grid"></div>
      <button id="load-more" class="button load-more" hidden>Carregar mais</button>
    </section>

    <section>
      <h2 class="section-title">Figurinhas Sem Pack</h2>
      <div id="orphan-status" class="status"></div>
      <div id="orphan-grid" class="stickers orphan-grid"></div>
      <button id="orphan-load-more" class="button load-more" hidden>Carregar mais figurinhas</button>
    </section>
  </main>

  <aside id="panel" class="panel" aria-hidden="true">
    <div class="panel-inner">
      <div class="panel-head">
        <div>
          <h2 id="panel-title" class="panel-title">Pack</h2>
          <p id="panel-subtitle" class="panel-sub"></p>
          <span id="panel-chip" class="chip"></span>
        </div>
        <button id="panel-close" class="close" type="button">X</button>
      </div>
      <button id="copy-link" class="copy" type="button">Copiar link do pack</button>
      <div id="panel-error" class="error" hidden></div>
      <div id="stickers" class="stickers"></div>
    </div>
  </aside>

  <script>
    const CONFIG = ${jsonForInlineScript(clientConfig)};
    const state = {
      q: '',
      visibility: 'public',
      packs: {
        offset: 0,
        limit: CONFIG.defaultLimit,
        hasMore: true,
        loading: false,
        items: [],
      },
      orphan: {
        offset: 0,
        limit: CONFIG.defaultOrphanLimit,
        hasMore: true,
        loading: false,
        items: [],
      },
      selectedPack: null,
    };

    const els = {
      form: document.getElementById('search-form'),
      search: document.getElementById('search-input'),
      visibility: document.getElementById('visibility-input'),
      status: document.getElementById('status'),
      grid: document.getElementById('grid'),
      more: document.getElementById('load-more'),
      orphanStatus: document.getElementById('orphan-status'),
      orphanGrid: document.getElementById('orphan-grid'),
      orphanMore: document.getElementById('orphan-load-more'),
      panel: document.getElementById('panel'),
      panelTitle: document.getElementById('panel-title'),
      panelSub: document.getElementById('panel-subtitle'),
      panelChip: document.getElementById('panel-chip'),
      panelError: document.getElementById('panel-error'),
      panelClose: document.getElementById('panel-close'),
      copy: document.getElementById('copy-link'),
      stickers: document.getElementById('stickers'),
    };

    const toApi = (path, searchParams) => {
      const url = new URL(path, window.location.origin);
      if (searchParams) {
        Object.entries(searchParams).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
          }
        });
      }
      return url.toString();
    };

    const setStatus = (text) => {
      els.status.textContent = text || '';
    };

    const setOrphanStatus = (text) => {
      els.orphanStatus.textContent = text || '';
    };

    const fetchJson = async (url) => {
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = (data && data.error) || 'Falha ao carregar dados.';
        throw new Error(message);
      }
      return data;
    };

    const clearPanelError = () => {
      els.panelError.hidden = true;
      els.panelError.textContent = '';
    };

    const setThumbFallback = (thumbWrap) => {
      thumbWrap.textContent = '';
      const fallback = document.createElement('div');
      fallback.className = 'thumb-fallback';
      fallback.textContent = 'Sem capa disponivel';
      thumbWrap.appendChild(fallback);
    };

    const appendMetaLine = (container, leftText, rightText) => {
      const left = document.createElement('span');
      left.textContent = leftText;
      const right = document.createElement('span');
      right.textContent = rightText;
      container.append(left, right);
    };

    const shortStickerId = (value) => {
      const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '');
      return normalized.slice(0, 5) || '-----';
    };

    const renderCard = (pack) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.setAttribute('aria-label', 'Abrir pack ' + pack.name);

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'thumb-wrap';

      if (pack.cover_url) {
        const image = document.createElement('img');
        image.className = 'thumb';
        image.loading = 'lazy';
        image.alt = 'Capa do pack ' + pack.name;
        image.src = pack.cover_url;
        image.addEventListener('error', () => {
          setThumbFallback(thumbWrap);
        });
        thumbWrap.appendChild(image);
      } else {
        setThumbFallback(thumbWrap);
      }

      const title = document.createElement('h3');
      title.textContent = pack.name;

      const metaTop = document.createElement('p');
      metaTop.className = 'meta';
      appendMetaLine(metaTop, pack.publisher, pack.sticker_count + ' itens');

      const metaBottom = document.createElement('p');
      metaBottom.className = 'meta';
      appendMetaLine(metaBottom, pack.visibility, pack.pack_key);

      card.append(thumbWrap, title, metaTop, metaBottom);
      card.addEventListener('click', () => openPack(pack.pack_key, { pushState: true }));
      return card;
    };

    const renderGrid = () => {
      els.grid.innerHTML = '';
      state.packs.items.forEach((pack) => {
        els.grid.appendChild(renderCard(pack));
      });
    };

    const renderOrphanSticker = (sticker) => {
      const wrapper = document.createElement('article');
      wrapper.className = 'orphan-item';

      if (sticker.url) {
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = 'Sticker sem pack ' + sticker.id;
        image.src = sticker.url;
        wrapper.appendChild(image);
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'thumb-fallback';
        fallback.textContent = 'Arquivo nao acessivel';
        wrapper.appendChild(fallback);
      }

      const meta = document.createElement('p');
      meta.className = 'orphan-meta';
      meta.textContent = 'ID: ' + shortStickerId(sticker.id);
      meta.title = sticker.id || '';
      wrapper.appendChild(meta);
      return wrapper;
    };

    const renderOrphanGrid = () => {
      els.orphanGrid.innerHTML = '';
      state.orphan.items.forEach((sticker) => {
        els.orphanGrid.appendChild(renderOrphanSticker(sticker));
      });
    };

    const updateMoreButton = () => {
      els.more.hidden = !state.packs.hasMore;
      els.more.disabled = state.packs.loading;
      els.more.textContent = state.packs.loading ? 'Carregando...' : 'Carregar mais';
    };

    const updateOrphanMoreButton = () => {
      els.orphanMore.hidden = !state.orphan.hasMore;
      els.orphanMore.disabled = state.orphan.loading;
      els.orphanMore.textContent = state.orphan.loading ? 'Carregando...' : 'Carregar mais figurinhas';
    };

    const listPacks = async ({ reset = false } = {}) => {
      if (state.packs.loading) return;
      state.packs.loading = true;
      updateMoreButton();
      setStatus(reset ? 'Buscando packs...' : 'Carregando mais packs...');

      if (reset) {
        state.packs.offset = 0;
        state.packs.items = [];
      }

      try {
        const payload = await fetchJson(
          toApi(CONFIG.apiBasePath, {
            q: state.q,
            visibility: state.visibility,
            limit: state.packs.limit,
            offset: state.packs.offset,
          }),
        );

        const packs = Array.isArray(payload.data) ? payload.data : [];
        state.packs.items = reset ? packs : state.packs.items.concat(packs);
        state.packs.offset = (payload.pagination && payload.pagination.next_offset) || state.packs.items.length;
        state.packs.hasMore = Boolean(payload.pagination && payload.pagination.has_more);

        renderGrid();

        if (!state.packs.items.length) {
          setStatus('Nenhum pack encontrado com os filtros atuais.');
        } else {
          setStatus(state.packs.items.length + ' pack(s) carregado(s).');
        }
      } catch (error) {
        setStatus(error.message || 'Nao foi possivel listar os packs agora.');
      } finally {
        state.packs.loading = false;
        updateMoreButton();
      }
    };

    const listOrphanStickers = async ({ reset = false, loadAll = false } = {}) => {
      if (state.orphan.loading) return;
      state.orphan.loading = true;
      updateOrphanMoreButton();
      setOrphanStatus(reset ? 'Buscando figurinhas sem pack...' : 'Carregando mais figurinhas sem pack...');

      if (reset) {
        state.orphan.offset = 0;
        state.orphan.items = [];
      }

      try {
        do {
          const payload = await fetchJson(
            toApi(CONFIG.orphanApiPath, {
              q: state.q,
              limit: state.orphan.limit,
              offset: state.orphan.offset,
            }),
          );

          const stickers = Array.isArray(payload.data) ? payload.data : [];
          state.orphan.items = state.orphan.items.concat(stickers);
          state.orphan.offset = (payload.pagination && payload.pagination.next_offset) || state.orphan.items.length;
          state.orphan.hasMore = Boolean(payload.pagination && payload.pagination.has_more);

          renderOrphanGrid();

          if (!loadAll) break;
        } while (state.orphan.hasMore);

        if (!state.orphan.items.length) {
          setOrphanStatus('Nenhuma figurinha sem pack encontrada.');
        } else {
          setOrphanStatus(state.orphan.items.length + ' figurinha(s) sem pack carregada(s).');
        }
      } catch (error) {
        setOrphanStatus(error.message || 'Nao foi possivel listar figurinhas sem pack.');
      } finally {
        state.orphan.loading = false;
        updateOrphanMoreButton();
      }
    };

    const closePanel = ({ replaceState = false } = {}) => {
      state.selectedPack = null;
      els.panel.classList.remove('open');
      els.panel.setAttribute('aria-hidden', 'true');
      els.stickers.innerHTML = '';
      clearPanelError();
      if (replaceState) {
        history.replaceState({}, '', CONFIG.webPath);
      }
    };

    const renderPack = (pack) => {
      els.panelTitle.textContent = pack.name || 'Pack';
      els.panelSub.textContent = (pack.publisher || '-') + ' | ' + (pack.description || 'Sem descricao');
      els.panelChip.textContent = pack.sticker_count + ' itens | ' + pack.visibility + ' | ' + pack.pack_key;
      els.stickers.innerHTML = '';

      const items = Array.isArray(pack.items) ? pack.items : [];
      if (!items.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Este pack nao possui stickers disponiveis.';
        els.stickers.appendChild(empty);
      } else {
        items.forEach((item) => {
          const wrapper = document.createElement('div');
          wrapper.className = 'sticker';

          const image = document.createElement('img');
          image.loading = 'lazy';
          image.alt = item.accessibility_label || ('Sticker #' + item.position);
          image.src = item.asset_url;
          wrapper.appendChild(image);
          els.stickers.appendChild(wrapper);
        });
      }

      els.panel.classList.add('open');
      els.panel.setAttribute('aria-hidden', 'false');
    };

    const openPack = async (packKey, { pushState = false } = {}) => {
      const sanitizedKey = String(packKey || '').trim();
      if (!sanitizedKey) return;

      clearPanelError();
      els.panelTitle.textContent = 'Carregando...';
      els.panelSub.textContent = '';
      els.panelChip.textContent = '';
      els.stickers.innerHTML = '';
      els.panel.classList.add('open');
      els.panel.setAttribute('aria-hidden', 'false');

      try {
        const payload = await fetchJson(toApi(CONFIG.apiBasePath + '/' + encodeURIComponent(sanitizedKey)));
        state.selectedPack = payload.data || null;
        if (!state.selectedPack) {
          throw new Error('Pack nao encontrado.');
        }

        renderPack(state.selectedPack);
        if (pushState) {
          history.pushState({}, '', CONFIG.webPath + '/' + encodeURIComponent(sanitizedKey));
        }
      } catch (error) {
        els.panelError.hidden = false;
        els.panelError.textContent = error.message || 'Nao foi possivel abrir este pack.';
      }
    };

    els.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.q = els.search.value.trim();
      state.visibility = els.visibility.value;
      await Promise.all([listPacks({ reset: true }), listOrphanStickers({ reset: true, loadAll: true })]);
    });

    els.more.addEventListener('click', async () => {
      await listPacks({ reset: false });
    });

    els.orphanMore.addEventListener('click', async () => {
      await listOrphanStickers({ reset: false, loadAll: true });
    });

    els.panelClose.addEventListener('click', () => closePanel({ replaceState: true }));

    els.copy.addEventListener('click', async () => {
      if (!state.selectedPack) return;
      const url = window.location.origin + CONFIG.webPath + '/' + encodeURIComponent(state.selectedPack.pack_key);
      try {
        await navigator.clipboard.writeText(url);
        els.copy.textContent = 'Link copiado';
        setTimeout(() => {
          els.copy.textContent = 'Copiar link do pack';
        }, 1800);
      } catch {
        els.copy.textContent = 'Falha ao copiar';
      }
    });

    window.addEventListener('popstate', () => {
      const path = window.location.pathname;
      if (!path.startsWith(CONFIG.webPath + '/')) {
        closePanel();
        return;
      }
      let key = '';
      try {
        key = decodeURIComponent(path.slice((CONFIG.webPath + '/').length).split('/')[0] || '');
      } catch {
        key = '';
      }
      if (key) {
        openPack(key, { pushState: false });
      }
    });

    (async () => {
      await Promise.all([listPacks({ reset: true }), listOrphanStickers({ reset: true, loadAll: true })]);
      if (CONFIG.initialPackKey) {
        openPack(CONFIG.initialPackKey, { pushState: false });
      }
    })();
  </script>
</body>
</html>`;
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

  const { assets, hasMore } = await listStickerAssetsWithoutPack({
    search: q,
    limit,
    offset,
  });

  sendJson(req, res, 200, {
    data: assets.map((asset) => mapOrphanStickerAsset(asset)),
    pagination: {
      limit,
      offset,
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

const handleCatalogPageRequest = (req, res, pathname) => {
  const initialPackKey = extractPackKeyFromWebPath(pathname);
  const html = renderCatalogHtml({ initialPackKey });
  sendText(req, res, 200, html, 'text/html; charset=utf-8');
};

export const isStickerCatalogEnabled = () => STICKER_CATALOG_ENABLED;
export const getStickerCatalogConfig = () => ({
  enabled: STICKER_CATALOG_ENABLED,
  webPath: STICKER_WEB_PATH,
  apiBasePath: STICKER_API_BASE_PATH,
  orphanApiPath: STICKER_ORPHAN_API_PATH,
  dataPublicPath: STICKER_DATA_PUBLIC_PATH,
  dataPublicDir: STICKER_DATA_PUBLIC_DIR,
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
    handleCatalogPageRequest(req, res, pathname);
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
