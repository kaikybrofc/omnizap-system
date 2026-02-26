import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import axios from 'axios';

import { executeQuery, pool, TABLES } from '../../../database/index.js';
import { getJidUser, normalizeJid, resolveBotJid } from '../../config/baileysConfig.js';
import { getAdminPhone, getAdminRawValue, resolveAdminJid } from '../../config/adminIdentity.js';
import { getActiveSocket } from '../../services/socketState.js';
import { extractUserIdInfo, resolveUserId } from '../../services/lidMapService.js';
import logger from '../../utils/logger/loggerModule.js';
import { getSystemMetrics } from '../../utils/systemMetrics/systemMetricsModule.js';
import {
  listStickerPacksForCatalog,
  findStickerPackByPackKey,
  listStickerPacksByOwner,
  bumpStickerPackVersion,
  findStickerPackByOwnerAndIdentifier,
  softDeleteStickerPack,
  updateStickerPackFields,
} from './stickerPackRepository.js';
import {
  listStickerPackItems,
  countStickerPackItemRefsByStickerId,
  createStickerPackItem,
  getStickerPackItemByStickerId,
  removeStickerPackItemByStickerId,
  removeStickerPackItemsByPackId,
} from './stickerPackItemRepository.js';
import {
  listClassifiedStickerAssetsWithoutPack,
  listStickerAssetsWithoutPack,
  deleteStickerAssetById,
  findStickerAssetsByIds,
} from './stickerAssetRepository.js';
import {
  deleteStickerAssetClassificationByAssetId,
  findStickerClassificationByAssetId,
  listStickerClassificationsByAssetIds,
} from './stickerAssetClassificationRepository.js';
import {
  decoratePackClassificationSummary,
  decorateStickerClassification,
  getPackClassificationSummaryByAssetIds,
} from './stickerClassificationService.js';
import {
  getEmptyStickerPackEngagement,
  getStickerPackEngagementByPackId,
  incrementStickerPackDislike,
  incrementStickerPackLike,
  incrementStickerPackOpen,
  listStickerPackEngagementByPackIds,
} from './stickerPackEngagementRepository.js';
import {
  createStickerPackInteractionEvent,
  listStickerPackInteractionStatsByPackIds,
  listViewerRecentPackIds,
} from './stickerPackInteractionEventRepository.js';
import {
  buildCreatorRanking,
  buildIntentCollections,
  buildPersonalizedRecommendations,
  buildViewerTagAffinity,
  computePackSignals,
} from './stickerPackMarketplaceService.js';
import { getMarketplaceDriftSnapshot } from './stickerMarketplaceDriftService.js';
import { getStickerStorageConfig, readStickerAssetBuffer, saveStickerAssetFromBuffer } from './stickerStorageService.js';
import { convertToWebp } from '../stickerModule/convertToWebp.js';
import { sanitizeText } from './stickerPackUtils.js';
import stickerPackService from './stickerPackServiceRuntime.js';
import { STICKER_PACK_ERROR_CODES, StickerPackError } from './stickerPackErrors.js';

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
const STICKER_CREATE_WEB_PATH = `${STICKER_WEB_PATH}/create`;
const STICKER_DATA_PUBLIC_PATH = normalizeBasePath(process.env.STICKER_DATA_PUBLIC_PATH, '/data');
const STICKER_DATA_PUBLIC_DIR = path.resolve(process.env.STICKER_DATA_PUBLIC_DIR || path.join(process.cwd(), 'data'));
const CATALOG_PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const CATALOG_TEMPLATE_PATH = path.join(CATALOG_PUBLIC_DIR, 'index.html');
const CREATE_PACK_TEMPLATE_PATH = path.join(CATALOG_PUBLIC_DIR, 'stickers', 'create', 'index.html');
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
const PACK_COMMAND_PREFIX = String(process.env.COMMAND_PREFIX || '/').trim() || '/';
const PACK_CREATE_NAME_REGEX = '^[\\s\\S]+$';
const PACK_CREATE_MAX_NAME_LENGTH = 120;
const PACK_CREATE_MAX_PUBLISHER_LENGTH = 120;
const PACK_CREATE_MAX_DESCRIPTION_LENGTH = 1024;
const PACK_CREATE_MAX_ITEMS = Math.max(1, Number(process.env.STICKER_PACK_MAX_ITEMS) || 30);
const PACK_CREATE_MAX_PACKS_PER_OWNER = Math.max(1, Number(process.env.STICKER_PACK_MAX_PACKS_PER_OWNER) || 50);
const PACK_WEB_EDIT_TOKEN_TTL_MS = Math.max(60_000, Number(process.env.STICKER_WEB_EDIT_TOKEN_TTL_MS) || 6 * 60 * 60 * 1000);
const STICKER_WEB_GOOGLE_CLIENT_ID = String(process.env.STICKER_WEB_GOOGLE_CLIENT_ID || '').trim();
const STICKER_WEB_GOOGLE_AUTH_REQUIRED = parseEnvBool(
  process.env.STICKER_WEB_GOOGLE_AUTH_REQUIRED,
  Boolean(STICKER_WEB_GOOGLE_CLIENT_ID),
);
const STICKER_WEB_GOOGLE_SESSION_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.STICKER_WEB_GOOGLE_SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000,
);
const STICKER_CATALOG_ONLY_CLASSIFIED = parseEnvBool(process.env.STICKER_CATALOG_ONLY_CLASSIFIED, true);
const METRICS_ENDPOINT =
  process.env.METRICS_ENDPOINT ||
  `http://127.0.0.1:${process.env.METRICS_PORT || 9102}${process.env.METRICS_PATH || '/metrics'}`;
const METRICS_SUMMARY_TIMEOUT_MS = clampInt(process.env.STICKER_SYSTEM_METRICS_TIMEOUT_MS, 1200, 300, 5000);
const GITHUB_REPOSITORY = String(process.env.GITHUB_REPOSITORY || 'Kaikygr/omnizap-system').trim();
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const GITHUB_PROJECT_CACHE_SECONDS = clampInt(process.env.GITHUB_PROJECT_CACHE_SECONDS, 300, 30, 3600);
const GLOBAL_RANK_REFRESH_SECONDS = clampInt(process.env.GLOBAL_RANK_REFRESH_SECONDS, 600, 60, 3600);
const DATA_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp']);
const { maxStickerBytes: MAX_STICKER_UPLOAD_BYTES } = getStickerStorageConfig();
const MAX_STICKER_SOURCE_UPLOAD_BYTES = Math.max(
  MAX_STICKER_UPLOAD_BYTES,
  Number(process.env.STICKER_WEB_UPLOAD_SOURCE_MAX_BYTES) || 20 * 1024 * 1024,
);
const ALLOWED_WEB_UPLOAD_VIDEO_MIMETYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
]);
const webPackEditTokenMap = new Map();
const webGoogleSessionMap = new Map();
const GOOGLE_WEB_SESSION_COOKIE_NAME = 'omnizap_google_session';
const PACK_WEB_STATUS_VALUES = new Set(['draft', 'uploading', 'processing', 'published', 'failed']);
const PACK_WEB_UPLOAD_STATUS_VALUES = new Set(['pending', 'processing', 'done', 'failed']);
const WEB_UPLOAD_ERROR_MESSAGE_MAX = 255;
const WEB_UPLOAD_MAX_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.STICKER_WEB_UPLOAD_CONCURRENCY) || 3));
const WEB_DRAFT_CLEANUP_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.STICKER_WEB_DRAFT_CLEANUP_TTL_MS) || 24 * 60 * 60 * 1000,
);
const WEB_DRAFT_CLEANUP_RUN_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.STICKER_WEB_DRAFT_CLEANUP_RUN_INTERVAL_MS) || 15 * 60 * 1000,
);
const WEB_UPLOAD_ID_MAX_LENGTH = 120;
let staleDraftCleanupState = {
  running: false,
  lastRunAt: 0,
};

const hasPathPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const isPackPubliclyVisible = (pack) =>
  (pack?.visibility === 'public' || pack?.visibility === 'unlisted') && String(pack?.status || 'published') === 'published';
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

const parseCookies = (req) => {
  const raw = String(req?.headers?.cookie || '');
  if (!raw) return {};
  return raw.split(';').reduce((acc, chunk) => {
    const [k, ...rest] = chunk.split('=');
    const key = String(k || '').trim();
    if (!key) return acc;
    const value = rest.join('=').trim();
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const isRequestSecure = (req) => {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto) return proto === 'https';
  return Boolean(req?.socket?.encrypted);
};

const appendSetCookie = (res, cookieValue) => {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookieValue]);
    return;
  }
  res.setHeader('Set-Cookie', [String(current), cookieValue]);
};

const logPackWebFlow = (level, phase, payload = {}) => {
  const method = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : logger.info.bind(logger);
  method(`Fluxo web de criação/publicação de pack: ${phase}`, {
    action: `sticker_pack_web_${phase}`,
    phase,
    ...payload,
  });
};

const normalizePackWebStatus = (value, fallback = 'draft') => {
  const normalized = String(value || '').trim().toLowerCase();
  return PACK_WEB_STATUS_VALUES.has(normalized) ? normalized : fallback;
};

const normalizePackWebUploadStatus = (value, fallback = 'pending') => {
  const normalized = String(value || '').trim().toLowerCase();
  return PACK_WEB_UPLOAD_STATUS_VALUES.has(normalized) ? normalized : fallback;
};

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

const clampUploadErrorMessage = (message) =>
  String(message || '')
    .trim()
    .slice(0, WEB_UPLOAD_ERROR_MESSAGE_MAX) || null;

const runSqlTransaction = async (handler) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const buildCookieString = (name, value, req, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(String(value ?? ''))}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (isRequestSecure(req)) parts.push('Secure');
  if (Number.isFinite(options.maxAgeSeconds)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  return parts.join('; ');
};

const readJsonBody = async (req, { maxBytes = 64 * 1024 } = {}) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error('Payload excedeu limite permitido.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error('JSON invalido.');
        error.statusCode = 400;
        reject(error);
      }
    });

    req.on('error', (error) => reject(error));
  });

const normalizeWebUploadId = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, WEB_UPLOAD_ID_MAX_LENGTH);

const normalizeStickerHashHex = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '');
  return normalized.length === 64 ? normalized : '';
};

const normalizePackWebUploadRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    pack_id: row.pack_id,
    upload_id: row.upload_id,
    sticker_hash: row.sticker_hash,
    source_mimetype: row.source_mimetype || null,
    upload_status: normalizePackWebUploadStatus(row.upload_status, 'pending'),
    sticker_id: row.sticker_id || null,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    attempt_count: Number(row.attempt_count || 0),
    last_attempt_at: row.last_attempt_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

const listPackWebUploads = async (packId, connection = null) => {
  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.STICKER_PACK_WEB_UPLOAD}
     WHERE pack_id = ?
     ORDER BY updated_at ASC, created_at ASC`,
    [packId],
    connection,
  );
  return rows.map((row) => normalizePackWebUploadRow(row));
};

const findPackWebUploadByUploadId = async (packId, uploadId, connection = null) => {
  if (!packId || !uploadId) return null;
  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.STICKER_PACK_WEB_UPLOAD}
     WHERE pack_id = ? AND upload_id = ?
     LIMIT 1`,
    [packId, uploadId],
    connection,
  );
  return normalizePackWebUploadRow(rows?.[0] || null);
};

const findPackWebUploadByStickerHash = async (packId, stickerHash, connection = null) => {
  if (!packId || !stickerHash) return null;
  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.STICKER_PACK_WEB_UPLOAD}
     WHERE pack_id = ? AND sticker_hash = ?
     LIMIT 1`,
    [packId, stickerHash],
    connection,
  );
  return normalizePackWebUploadRow(rows?.[0] || null);
};

const createPackWebUpload = async (entry, connection = null) => {
  await executeQuery(
    `INSERT INTO ${TABLES.STICKER_PACK_WEB_UPLOAD}
      (id, pack_id, upload_id, sticker_hash, source_mimetype, upload_status, sticker_id, error_code, error_message, attempt_count, last_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.pack_id,
      entry.upload_id,
      entry.sticker_hash,
      entry.source_mimetype ?? null,
      normalizePackWebUploadStatus(entry.upload_status, 'pending'),
      entry.sticker_id ?? null,
      entry.error_code ?? null,
      clampUploadErrorMessage(entry.error_message),
      Math.max(0, Number(entry.attempt_count || 0)),
      entry.last_attempt_at ?? null,
    ],
    connection,
  );
  return findPackWebUploadByUploadId(entry.pack_id, entry.upload_id, connection);
};

const updatePackWebUpload = async (uploadIdPk, fields, connection = null) => {
  const clauses = [];
  const params = [];
  const mappings = {
    upload_status: (value) => normalizePackWebUploadStatus(value, 'pending'),
    sticker_id: (value) => value ?? null,
    error_code: (value) => (value ? String(value).trim().slice(0, 64) : null),
    error_message: (value) => clampUploadErrorMessage(value),
    source_mimetype: (value) => (value ? String(value).trim().slice(0, 64) : null),
    attempt_count: (value) => Math.max(0, Number(value || 0)),
    last_attempt_at: (value) => value ?? null,
  };

  for (const [field, mapValue] of Object.entries(mappings)) {
    if (!(field in fields)) continue;
    clauses.push(`${field} = ?`);
    params.push(mapValue(fields[field]));
  }

  if (!clauses.length) return null;
  clauses.push('updated_at = CURRENT_TIMESTAMP');

  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK_WEB_UPLOAD}
     SET ${clauses.join(', ')}
     WHERE id = ?`,
    [...params, uploadIdPk],
    connection,
  );

  const rows = await executeQuery(
    `SELECT * FROM ${TABLES.STICKER_PACK_WEB_UPLOAD} WHERE id = ? LIMIT 1`,
    [uploadIdPk],
    connection,
  );
  return normalizePackWebUploadRow(rows?.[0] || null);
};

const setStickerPackStatus = async (packId, status, connection = null) => {
  const normalizedStatus = normalizePackWebStatus(status, 'draft');
  await executeQuery(
    `UPDATE ${TABLES.STICKER_PACK}
     SET status = ?,
         version = version + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
    [normalizedStatus, packId],
    connection,
  );
  return normalizedStatus;
};

const lockStickerPackByPackKey = async (packKey, connection) => {
  const rows = await executeQuery(
    `SELECT *
     FROM ${TABLES.STICKER_PACK}
     WHERE pack_key = ? AND deleted_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [packKey],
    connection,
  );
  return rows?.[0] || null;
};

const getPackConsistencySnapshot = async (packId, coverStickerId = null, connection = null) => {
  const [itemsRow] = await executeQuery(
    `SELECT
       COUNT(*) AS sticker_count,
       SUM(CASE WHEN sticker_id = ? THEN 1 ELSE 0 END) AS cover_matches
     FROM ${TABLES.STICKER_PACK_ITEM}
     WHERE pack_id = ?`,
    [coverStickerId || '', packId],
    connection,
  );

  const [uploadRow] = await executeQuery(
    `SELECT
       COUNT(*) AS total_uploads,
       SUM(CASE WHEN upload_status = 'done' THEN 1 ELSE 0 END) AS done_uploads,
       SUM(CASE WHEN upload_status = 'failed' THEN 1 ELSE 0 END) AS failed_uploads,
       SUM(CASE WHEN upload_status = 'processing' THEN 1 ELSE 0 END) AS processing_uploads,
       SUM(CASE WHEN upload_status = 'pending' THEN 1 ELSE 0 END) AS pending_uploads
     FROM ${TABLES.STICKER_PACK_WEB_UPLOAD}
     WHERE pack_id = ?`,
    [packId],
    connection,
  );

  return {
    sticker_count: Number(itemsRow?.sticker_count || 0),
    cover_set: Boolean(coverStickerId),
    cover_valid: Boolean(coverStickerId) && Number(itemsRow?.cover_matches || 0) > 0,
    total_uploads: Number(uploadRow?.total_uploads || 0),
    done_uploads: Number(uploadRow?.done_uploads || 0),
    failed_uploads: Number(uploadRow?.failed_uploads || 0),
    processing_uploads: Number(uploadRow?.processing_uploads || 0),
    pending_uploads: Number(uploadRow?.pending_uploads || 0),
  };
};

const buildPackPublishStateData = async (pack, { includeUploads = true, connection = null } = {}) => {
  const snapshot = await getPackConsistencySnapshot(pack.id, pack.cover_sticker_id, connection);
  const uploads = includeUploads ? await listPackWebUploads(pack.id, connection) : [];

  return {
    pack_key: pack.pack_key,
    status: normalizePackWebStatus(pack.status, 'draft'),
    visibility: pack.visibility,
    cover_sticker_id: pack.cover_sticker_id || null,
    consistency: {
      sticker_count: snapshot.sticker_count,
      cover_set: snapshot.cover_set,
      cover_valid: snapshot.cover_valid,
      total_uploads: snapshot.total_uploads,
      done_uploads: snapshot.done_uploads,
      failed_uploads: snapshot.failed_uploads,
      processing_uploads: snapshot.processing_uploads,
      pending_uploads: snapshot.pending_uploads,
      can_publish:
        snapshot.sticker_count >= 1 &&
        snapshot.failed_uploads === 0 &&
        snapshot.processing_uploads === 0 &&
        snapshot.pending_uploads === 0 &&
        snapshot.cover_valid,
    },
    uploads: uploads.map((entry) => ({
      upload_id: entry.upload_id,
      sticker_hash: entry.sticker_hash,
      status: entry.upload_status,
      sticker_id: entry.sticker_id || null,
      error_code: entry.error_code || null,
      error_message: entry.error_message || null,
      attempt_count: Number(entry.attempt_count || 0),
      updated_at: toIsoOrNull(entry.updated_at),
    })),
    updated_at: toIsoOrNull(pack.updated_at),
    published: normalizePackWebStatus(pack.status, 'draft') === 'published',
  };
};

const maybeCleanupStaleDraftPacks = async () => {
  if (staleDraftCleanupState.running) return;
  if (Date.now() - staleDraftCleanupState.lastRunAt < WEB_DRAFT_CLEANUP_RUN_INTERVAL_MS) return;

  staleDraftCleanupState.running = true;
  staleDraftCleanupState.lastRunAt = Date.now();

  try {
    const rows = await executeQuery(
      `SELECT p.id, p.pack_key
       FROM ${TABLES.STICKER_PACK} p
       LEFT JOIN ${TABLES.STICKER_PACK_ITEM} i ON i.pack_id = p.id
       WHERE p.deleted_at IS NULL
         AND p.status = 'draft'
         AND p.updated_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
       GROUP BY p.id, p.pack_key
       HAVING COUNT(i.id) = 0
       LIMIT 200`,
      [Math.floor(WEB_DRAFT_CLEANUP_TTL_MS / 1000)],
    );

    if (!rows.length) return;

    await executeQuery(
      `UPDATE ${TABLES.STICKER_PACK}
       SET deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           version = version + 1
       WHERE id IN (${rows.map(() => '?').join(', ')})`,
      rows.map((row) => row.id),
    );

    logPackWebFlow('info', 'cleanup_draft_deleted', {
      deleted_count: rows.length,
      ttl_ms: WEB_DRAFT_CLEANUP_TTL_MS,
    });
  } catch (error) {
    logPackWebFlow('warn', 'cleanup_draft_failed', {
      error: error?.message,
    });
  } finally {
    staleDraftCleanupState.running = false;
  }
};

const triggerStaleDraftCleanup = () => {
  maybeCleanupStaleDraftPacks().catch(() => {});
};

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

const normalizeGoogleSubject = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);

const buildGoogleOwnerJid = (googleSub) => {
  const normalizedSub = normalizeGoogleSubject(googleSub);
  if (!normalizedSub) return '';
  return normalizeJid(`g${normalizedSub}@google.oauth`) || '';
};

const verifyGoogleIdToken = async (idToken) => {
  const token = String(idToken || '').trim();
  if (!token) {
    const error = new Error('Token Google ausente.');
    error.statusCode = 401;
    throw error;
  }

  let response;
  try {
    response = await axios.get(GOOGLE_TOKENINFO_URL, {
      params: { id_token: token },
      timeout: 5000,
      validateStatus: () => true,
    });
  } catch (error) {
    const wrapped = new Error('Falha ao validar login Google.');
    wrapped.statusCode = 502;
    wrapped.cause = error;
    throw wrapped;
  }

  if (response.status < 200 || response.status >= 300) {
    const reason = String(response?.data?.error_description || response?.data?.error || '').trim();
    const error = new Error(reason || 'Token Google inválido.');
    error.statusCode = 401;
    throw error;
  }

  const claims = response?.data && typeof response.data === 'object' ? response.data : {};
  const aud = String(claims.aud || '').trim();
  const iss = String(claims.iss || '').trim();
  const sub = normalizeGoogleSubject(claims.sub);
  const email = String(claims.email || '').trim().toLowerCase();
  const emailVerified = String(claims.email_verified || '').trim().toLowerCase();

  if (STICKER_WEB_GOOGLE_CLIENT_ID && aud !== STICKER_WEB_GOOGLE_CLIENT_ID) {
    const error = new Error('Login Google não pertence a este aplicativo.');
    error.statusCode = 403;
    throw error;
  }
  if (iss && !['accounts.google.com', 'https://accounts.google.com'].includes(iss)) {
    const error = new Error('Emissor do token Google inválido.');
    error.statusCode = 401;
    throw error;
  }
  if (!sub) {
    const error = new Error('Token Google sem identificador de usuário.');
    error.statusCode = 401;
    throw error;
  }
  if (email && emailVerified && !['true', '1'].includes(emailVerified)) {
    const error = new Error('Conta Google sem e-mail verificado.');
    error.statusCode = 403;
    throw error;
  }

  return {
    sub,
    email: email || null,
    name: sanitizeText(claims.name || claims.given_name || '', 120, { allowEmpty: true }) || null,
    picture: String(claims.picture || '').trim() || null,
  };
};

const pruneExpiredGoogleSessions = () => {
  const now = Date.now();
  for (const [token, session] of webGoogleSessionMap.entries()) {
    if (!session || Number(session.expiresAt || 0) <= now) {
      webGoogleSessionMap.delete(token);
    }
  }
};

const createGoogleWebSession = (claims) => {
  pruneExpiredGoogleSessions();
  const token = randomUUID();
  const now = Date.now();
  const session = {
    token,
    sub: claims.sub,
    email: claims.email || null,
    name: claims.name || null,
    picture: claims.picture || null,
    ownerJid: buildGoogleOwnerJid(claims.sub),
    createdAt: now,
    expiresAt: now + STICKER_WEB_GOOGLE_SESSION_TTL_MS,
  };
  webGoogleSessionMap.set(token, session);
  return session;
};

const resolveGoogleWebSessionFromRequest = (req) => {
  pruneExpiredGoogleSessions();
  const cookies = parseCookies(req);
  const sessionToken = String(cookies[GOOGLE_WEB_SESSION_COOKIE_NAME] || '').trim();
  if (!sessionToken) return null;
  const session = webGoogleSessionMap.get(sessionToken);
  if (!session) return null;
  if (Number(session.expiresAt || 0) <= Date.now()) {
    webGoogleSessionMap.delete(sessionToken);
    return null;
  }
  return session;
};

const clearGoogleWebSessionCookie = (req, res) => {
  appendSetCookie(
    res,
    buildCookieString(GOOGLE_WEB_SESSION_COOKIE_NAME, '', req, {
      maxAgeSeconds: 0,
    }),
  );
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

const isPlausibleWhatsAppPhone = (value) => {
  const digits = normalizePhoneDigits(value);
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
};

const toOwnerJid = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) {
    return normalizeJid(raw) || '';
  }
  const digits = normalizePhoneDigits(raw);
  if (!digits) return '';
  return normalizeJid(`${digits}@s.whatsapp.net`) || '';
};

const resolveWebCreateOwnerJid = async (explicitOwner = '') => {
  const explicit = toOwnerJid(explicitOwner);
  if (explicit) return explicit;

  const activeSocket = getActiveSocket();
  const botJid = resolveBotJid(activeSocket?.user?.id);
  const fromSocket = toOwnerJid(botJid);
  if (fromSocket) return fromSocket;

  try {
    const resolvedAdminJid = await resolveAdminJid();
    const fromAdmin = toOwnerJid(resolvedAdminJid);
    if (fromAdmin) return fromAdmin;
  } catch {}

  const adminCandidates = [
    getAdminRawValue(),
    getAdminPhone(),
    process.env.USER_ADMIN,
    process.env.WHATSAPP_SUPPORT_NUMBER,
  ];
  for (const candidate of adminCandidates) {
    const normalized = toOwnerJid(candidate);
    if (normalized) return normalized;
  }

  return '';
};

const saveWebPackEditToken = ({ packId, ownerJid }) => {
  if (!packId || !ownerJid) return null;
  const token = randomUUID();
  webPackEditTokenMap.set(token, {
    packId,
    ownerJid,
    expiresAt: Date.now() + PACK_WEB_EDIT_TOKEN_TTL_MS,
  });
  return token;
};

const resolveWebPackEditToken = (token) => {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  const entry = webPackEditTokenMap.get(normalized);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    webPackEditTokenMap.delete(normalized);
    return null;
  }
  return entry;
};

const decodeStickerBase64Payload = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const dataUrlMatch = raw.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  const base64Value = dataUrlMatch ? dataUrlMatch[2] : raw;
  const mimetype = dataUrlMatch ? String(dataUrlMatch[1] || '').trim().toLowerCase() : 'image/webp';
  const cleaned = base64Value.replace(/\s+/g, '');
  if (!cleaned) return null;

  const buffer = Buffer.from(cleaned, 'base64');
  if (!buffer.length) return null;
  return {
    buffer,
    mimetype,
  };
};

const isLikelyWebpBuffer = (buffer) =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= 16 &&
  buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
  buffer.subarray(8, 12).toString('ascii') === 'WEBP';

const resolveExtensionFromMimetype = (mimetype) => {
  const normalized = String(mimetype || '').trim().toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/avif') return 'avif';
  if (normalized === 'image/heic') return 'heic';
  if (normalized === 'image/heif') return 'heif';
  if (normalized === 'image/bmp') return 'bmp';
  if (normalized === 'image/tiff') return 'tiff';
  if (normalized === 'image/x-icon') return 'ico';
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'video/quicktime') return 'mov';
  if (normalized === 'video/x-m4v') return 'm4v';
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'image/webp') return 'webp';
  return 'bin';
};

const convertUploadMediaToWebp = async ({ ownerJid, buffer, mimetype }) => {
  const normalizedMimetype = String(mimetype || '').trim().toLowerCase() || 'image/webp';
  const isVideo = normalizedMimetype.startsWith('video/');
  const isImage = normalizedMimetype.startsWith('image/');

  if (!isVideo && !isImage) {
    throw new StickerPackError(
      STICKER_PACK_ERROR_CODES.INVALID_INPUT,
      'Formato não suportado. Envie imagem ou vídeo.',
    );
  }

  if (isLikelyWebpBuffer(buffer) && buffer.length <= MAX_STICKER_UPLOAD_BYTES) {
    return { buffer, mimetype: 'image/webp' };
  }

  if (isVideo && !ALLOWED_WEB_UPLOAD_VIDEO_MIMETYPES.has(normalizedMimetype) && normalizedMimetype !== 'video/mp4') {
    throw new StickerPackError(
      STICKER_PACK_ERROR_CODES.INVALID_INPUT,
      'Formato de vídeo não suportado. Use mp4/webm/mov/m4v.',
    );
  }

  const uniqueId = randomUUID();
  const inputPath = path.join(
    process.cwd(),
    'temp',
    'stickers',
    'web-create',
    `${uniqueId}.${resolveExtensionFromMimetype(normalizedMimetype)}`,
  );

  await fs.mkdir(path.dirname(inputPath), { recursive: true });
  await fs.writeFile(inputPath, buffer);

  const conversionProfiles = isVideo
    ? [
        { videoMaxDurationSeconds: 8, videoFps: 10, videoQuality: 55, videoCompressionLevel: 6 },
        { videoMaxDurationSeconds: 6, videoFps: 9, videoQuality: 50, videoCompressionLevel: 6 },
        { videoMaxDurationSeconds: 4, videoFps: 8, videoQuality: 44, videoCompressionLevel: 6 },
        { videoMaxDurationSeconds: 3, videoFps: 8, videoQuality: 38, videoCompressionLevel: 6 },
        { videoMaxDurationSeconds: 2, videoFps: 7, videoQuality: 34, videoCompressionLevel: 6 },
        { videoMaxDurationSeconds: 1, videoFps: 6, videoQuality: 30, videoCompressionLevel: 6 },
      ]
    : [{ stretch: true }, { stretch: false }];

  let lastError = null;
  try {
    for (const profile of conversionProfiles) {
      let outputPath = null;
      try {
        outputPath = await convertToWebp(inputPath, isVideo ? 'video' : 'image', ownerJid, randomUUID(), {
          ...profile,
          maxOutputSizeBytes: MAX_STICKER_UPLOAD_BYTES,
        });
        const converted = await fs.readFile(outputPath);
        if (!isLikelyWebpBuffer(converted) || converted.length > MAX_STICKER_UPLOAD_BYTES) {
          throw new Error('WEBP convertido excedeu o limite final.');
        }
        return { buffer: converted, mimetype: 'image/webp' };
      } catch (error) {
        lastError = error;
      } finally {
        if (outputPath) {
          await fs.unlink(outputPath).catch(() => {});
        }
      }
    }
  } finally {
    await fs.unlink(inputPath).catch(() => {});
  }

  throw new StickerPackError(
    STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    `Não foi possível converter a mídia para sticker no limite de ${Math.round(MAX_STICKER_UPLOAD_BYTES / 1024)}KB.`,
    lastError,
  );
};

const resolveSupportAdminPhone = async () => {
  const adminRaw = String(getAdminRawValue() || '').trim();

  if (adminRaw) {
    try {
      const resolvedFromLidMap = await resolveUserId(extractUserIdInfo(adminRaw));
      const resolvedPhoneFromLidMap = isPlausibleWhatsAppPhone(getJidUser(resolvedFromLidMap || ''));
      if (resolvedPhoneFromLidMap) return resolvedPhoneFromLidMap;
    } catch {}
  }

  try {
    const resolvedAdminJid = await resolveAdminJid();
    const resolvedPhone = isPlausibleWhatsAppPhone(getJidUser(resolvedAdminJid || ''));
    if (resolvedPhone) return resolvedPhone;
  } catch {}

  const rawPhone = isPlausibleWhatsAppPhone(getJidUser(adminRaw) || adminRaw);
  if (rawPhone) return rawPhone;

  const adminPhone = isPlausibleWhatsAppPhone(getAdminPhone() || '');
  if (adminPhone) return adminPhone;

  const candidates = [process.env.WHATSAPP_SUPPORT_NUMBER, process.env.OWNER_NUMBER, process.env.USER_ADMIN];

  for (const candidate of candidates) {
    const digits = isPlausibleWhatsAppPhone(getJidUser(candidate || '') || candidate);
    if (digits) return digits;
  }

  return '';
};

const buildSupportInfo = async () => {
  const phone = await resolveSupportAdminPhone();
  if (!phone) return null;
  const text = String(process.env.STICKER_SUPPORT_WHATSAPP_TEXT || 'Olá! Preciso de suporte no catálogo OmniZap.').trim();
  return {
    phone,
    text,
    url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
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

const PACK_TAG_MARKER_REGEX = /\[pack-tags:([^\]]+)\]/i;
const normalizePackTag = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const mergeUniqueTags = (...groups) => {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const entry of Array.isArray(group) ? group : []) {
      const normalized = normalizePackTag(entry);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(normalized);
    }
  }
  return merged;
};

const parsePackDescriptionMetadata = (description) => {
  const raw = String(description || '').trim();
  if (!raw) return { cleanDescription: null, tags: [] };

  const marker = raw.match(PACK_TAG_MARKER_REGEX);
  const markerTags = marker?.[1]
    ? marker[1]
        .split(',')
        .map((entry) => normalizePackTag(entry))
        .filter(Boolean)
    : [];
  const cleanDescription = raw.replace(PACK_TAG_MARKER_REGEX, '').trim() || null;

  return {
    cleanDescription,
    tags: mergeUniqueTags(markerTags).slice(0, 8),
  };
};

const buildPackDescriptionWithTags = (description, tags = []) => {
  const cleanDescription = sanitizeText(description || '', PACK_CREATE_MAX_DESCRIPTION_LENGTH, { allowEmpty: true }) || '';
  const normalizedTags = mergeUniqueTags(tags).slice(0, 8);
  const marker = normalizedTags.length ? `[pack-tags:${normalizedTags.join(',')}]` : '';
  const combined = `${marker}${marker && cleanDescription ? ' ' : ''}${cleanDescription}`.trim();
  return combined || null;
};

const mapPackSummary = (pack, engagement = null, signals = null) => {
  const safeEngagement = engagement || getEmptyStickerPackEngagement();
  const metadata = parsePackDescriptionMetadata(pack.description);
  return {
    id: pack.id,
    pack_key: pack.pack_key,
    name: pack.name,
    publisher: pack.publisher,
    description: metadata.cleanDescription,
    visibility: pack.visibility,
    status: normalizePackWebStatus(pack.status, 'published'),
    sticker_count: Number(pack.sticker_count || 0),
    cover_sticker_id: pack.cover_sticker_id || null,
    cover_url: pack.cover_sticker_id ? buildStickerAssetUrl(pack.pack_key, pack.cover_sticker_id) : null,
    api_url: buildPackApiUrl(pack.pack_key),
    web_url: buildPackWebUrl(pack.pack_key),
    whatsapp: buildPackWhatsAppInfo(pack),
    created_at: toIsoOrNull(pack.created_at),
    updated_at: toIsoOrNull(pack.updated_at),
    engagement: {
      open_count: Number(safeEngagement.open_count || 0),
      like_count: Number(safeEngagement.like_count || 0),
      dislike_count: Number(safeEngagement.dislike_count || 0),
      score:
        Number(safeEngagement.score || 0) ||
        Number(safeEngagement.like_count || 0) - Number(safeEngagement.dislike_count || 0),
      updated_at: toIsoOrNull(safeEngagement.updated_at),
    },
    signals: signals || null,
    manual_tags: metadata.tags,
  };
};

const mapPackDetails = (
  pack,
  items,
  { byAssetClassification = new Map(), packClassification = null, engagement = null, signals = null } = {},
) => {
  const coverStickerId = pack.cover_sticker_id || items[0]?.sticker_id || null;
  const metadata = parsePackDescriptionMetadata(pack.description);
  const decoratedClassification = decoratePackClassificationSummary(packClassification);
  const mergedTags = mergeUniqueTags(decoratedClassification?.tags || [], metadata.tags);

  return {
    ...mapPackSummary({
      ...pack,
      description: metadata.cleanDescription,
      cover_sticker_id: coverStickerId,
      sticker_count: items.length,
    }, engagement, signals),
    items: items.map((item) => ({
      // `tags` facilita renderização direta no front sem precisar reprocessar score.
      id: item.id,
      sticker_id: item.sticker_id,
      position: Number(item.position || 0),
      emojis: Array.isArray(item.emojis) ? item.emojis : [],
      accessibility_label: item.accessibility_label || null,
      created_at: toIsoOrNull(item.created_at),
      asset_url: buildStickerAssetUrl(pack.pack_key, item.sticker_id),
      tags: decorateStickerClassification(byAssetClassification.get(item.sticker_id) || null)?.tags || [],
      asset: item.asset
        ? {
            id: item.asset.id,
            mimetype: item.asset.mimetype || 'image/webp',
            is_animated: Boolean(item.asset.is_animated),
            width: item.asset.width !== null && item.asset.width !== undefined ? Number(item.asset.width) : null,
            height: item.asset.height !== null && item.asset.height !== undefined ? Number(item.asset.height) : null,
            size_bytes:
              item.asset.size_bytes !== null && item.asset.size_bytes !== undefined ? Number(item.asset.size_bytes) : 0,
            classification: decorateStickerClassification(byAssetClassification.get(item.sticker_id) || null),
          }
        : null,
    })),
    classification: {
      ...(decoratedClassification || {}),
      tags: mergedTags,
    },
    tags: mergedTags,
  };
};

const mapOrphanStickerAsset = (asset, classification = null) => ({
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
  classification: decorateStickerClassification(classification || null),
  tags: decorateStickerClassification(classification || null)?.tags || [],
});

const toSummaryEntry = (entry) => ({
  ...mapPackSummary(entry.pack, entry.engagement, entry.signals),
  classification: entry.packClassification,
  tags: mergeUniqueTags(entry.packClassification?.tags || [], parsePackDescriptionMetadata(entry.pack?.description).tags),
});

const classifyPackIntent = (entry) => {
  if (entry?.signals?.trending_now) return 'crescendo_agora';
  if (entry?.signals?.pack_score >= 0.65) return 'em_alta';
  if (Number(entry?.engagement?.like_count || 0) >= 12) return 'mais_curtidos';
  return 'novos';
};

const normalizeViewerKey = (raw) =>
  String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:@-]+/g, '')
    .slice(0, 120);

const resolveActorKeysFromRequest = (req, url) => {
  const queryViewer = normalizeViewerKey(url.searchParams.get('viewer_key'));
  const headerViewer = normalizeViewerKey(req.headers['x-viewer-key']);
  const querySession = normalizeViewerKey(url.searchParams.get('session_key'));
  const headerSession = normalizeViewerKey(req.headers['x-session-key']);
  const actorKey = queryViewer || headerViewer || null;
  const sessionKey = querySession || headerSession || null;
  return {
    actorKey,
    sessionKey,
    source: normalizeViewerKey(req.headers['x-client-source']) || 'web',
  };
};

const hydrateMarketplaceEntries = async (packs, { includeItems = true, driftSnapshot = null } = {}) => {
  const packIds = packs.map((pack) => pack.id);
  const engagementByPackId = await listStickerPackEngagementByPackIds(packIds);
  const interactionStatsByPackId = await listStickerPackInteractionStatsByPackIds(packIds);

  const entries = [];
  const packClassificationById = new Map();

  for (const pack of packs) {
    const items = includeItems ? await listStickerPackItems(pack.id) : [];
    const stickerIds = items.map((item) => item.sticker_id);
    const [packClassification, itemClassifications] = await Promise.all([
      getPackClassificationSummaryByAssetIds(stickerIds),
      stickerIds.length ? listStickerClassificationsByAssetIds(stickerIds) : Promise.resolve([]),
    ]);
    const byAssetClassification = new Map(itemClassifications.map((classification) => [classification.asset_id, classification]));
    const orderedClassifications = stickerIds.map((stickerId) => byAssetClassification.get(stickerId)).filter(Boolean);
    const engagement = engagementByPackId.get(pack.id) || getEmptyStickerPackEngagement();
    const interactionStats = interactionStatsByPackId.get(pack.id) || null;
    const packMetadata = parsePackDescriptionMetadata(pack.description);
    const decoratedClassification = decoratePackClassificationSummary(packClassification);
    const mergedPackTags = mergeUniqueTags(decoratedClassification?.tags || [], packMetadata.tags);
    const signals = computePackSignals({
      pack: { ...pack, items },
      engagement,
      packClassification,
      itemClassifications: orderedClassifications,
      interactionStats,
      scoringWeights: driftSnapshot?.weights || null,
    });

    const entry = {
      pack,
      items,
      engagement,
      packClassification: {
        ...(decoratedClassification || {}),
        tags: mergedPackTags,
      },
      signals,
      interactionStats,
    };
    entries.push(entry);
    packClassificationById.set(pack.id, entry.packClassification);
  }

  return { entries, packClassificationById };
};

const isStickerClassified = (classification) => {
  if (!classification || typeof classification !== 'object') return false;
  if (classification.category) return true;
  if (classification.is_nsfw) return true;
  if (classification.all_scores && Object.keys(classification.all_scores).length > 0) return true;
  return false;
};

const isPackClassified = (classificationSummary) =>
  Boolean(classificationSummary && Number(classificationSummary.classified_items || 0) > 0);

const normalizeCategoryToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const parseCategoryFilters = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];

  const parts = raw
    .split(',')
    .map((part) => normalizeCategoryToken(part))
    .filter(Boolean);

  return Array.from(new Set(parts)).slice(0, 20);
};

const hasAnyCategory = (tags, categories) => {
  if (!Array.isArray(categories) || !categories.length) return true;
  const normalized = new Set((Array.isArray(tags) ? tags : []).map((entry) => normalizeCategoryToken(entry)));
  return categories.some((category) => normalized.has(category));
};

const resolveClassificationTags = (classification) => decorateStickerClassification(classification || null)?.tags || [];

const listClassifiedOrphanAssetsByCategories = async ({ search = '', categories = [], limit = 120, offset = 0 }) => {
  const safeLimit = Math.max(1, Math.min(MAX_ORPHAN_LIST_LIMIT, Number(limit) || DEFAULT_ORPHAN_LIST_LIMIT));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const normalizedCategories = Array.isArray(categories) ? categories.filter(Boolean) : [];
  const scanBatchSize = Math.max(safeLimit, 180);

  let cursorOffset = 0;
  let matchedCount = 0;
  const pageAssets = [];

  while (true) {
    const { assets, hasMore } = await listClassifiedStickerAssetsWithoutPack({
      search,
      limit: scanBatchSize,
      offset: cursorOffset,
    });

    if (!assets.length) break;

    const classifications = await listStickerClassificationsByAssetIds(assets.map((asset) => asset.id));
    const byAssetId = new Map(classifications.map((entry) => [entry.asset_id, entry]));

    for (const asset of assets) {
      const tags = resolveClassificationTags(byAssetId.get(asset.id));
      if (!hasAnyCategory(tags, normalizedCategories)) continue;

      const currentIndex = matchedCount;
      matchedCount += 1;

      if (currentIndex >= safeOffset && pageAssets.length < safeLimit) {
        pageAssets.push(asset);
      }
    }

    cursorOffset += assets.length;
    if (!hasMore) break;
  }

  return {
    assets: pageAssets,
    total: matchedCount,
    hasMore: safeOffset + safeLimit < matchedCount,
  };
};

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

const renderCreatePackHtml = async () => {
  const template = await fs.readFile(CREATE_PACK_TEMPLATE_PATH, 'utf8');
  const replacements = {
    __STICKER_WEB_PATH__: escapeHtmlAttribute(STICKER_WEB_PATH),
    __STICKER_CREATE_WEB_PATH__: escapeHtmlAttribute(STICKER_CREATE_WEB_PATH),
    __STICKER_API_BASE_PATH__: escapeHtmlAttribute(STICKER_API_BASE_PATH),
    __PACK_COMMAND_PREFIX__: escapeHtmlAttribute(PACK_COMMAND_PREFIX),
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
  const categories = parseCategoryFilters(url.searchParams.get('categories'));
  const intent = sanitizeText(url.searchParams.get('intent') || '', 32, { allowEmpty: true }) || '';
  const includeSensitive = parseEnvBool(url.searchParams.get('include_sensitive'), true);
  const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000);
  const normalizedIntent = normalizeCategoryToken(intent).replace(/-/g, '_');
  const batchLimit = Math.max(limit, Math.min(MAX_LIST_LIMIT, 24));
  const maxPagesToScan = 8;
  const seenPackIds = new Set();
  const collectedEntries = [];
  const driftSnapshot = await getMarketplaceDriftSnapshot();
  let sourceHasMore = true;
  let cursorOffset = offset;
  let pagesScanned = 0;

  while (collectedEntries.length < limit && sourceHasMore && pagesScanned < maxPagesToScan) {
    pagesScanned += 1;
    const { packs, hasMore } = await listStickerPacksForCatalog({
      visibility,
      search: q,
      limit: batchLimit,
      offset: cursorOffset,
    });
    sourceHasMore = hasMore;
    cursorOffset += batchLimit;
    if (!packs.length) break;

    const { entries } = await hydrateMarketplaceEntries(packs, { driftSnapshot });
    const entriesClassified = STICKER_CATALOG_ONLY_CLASSIFIED
      ? entries.filter((entry) => isPackClassified(entry.packClassification))
      : entries;
    const entriesByCategory = categories.length
      ? entriesClassified.filter((entry) => hasAnyCategory(entry.packClassification?.tags || [], categories))
      : entriesClassified;
    const entriesBySensitivity = includeSensitive
      ? entriesByCategory
      : entriesByCategory.filter((entry) => entry.signals?.nsfw_level === 'safe');
    const entriesByIntent = intent
      ? entriesBySensitivity.filter((entry) => classifyPackIntent(entry) === normalizedIntent)
      : entriesBySensitivity;
    const sortedEntries = [...entriesByIntent].sort((left, right) => {
      const leftScore = Number(left.signals?.ranking_score || 0);
      const rightScore = Number(right.signals?.ranking_score || 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return Date.parse(right.pack.updated_at || 0) - Date.parse(left.pack.updated_at || 0);
    });

    for (const entry of sortedEntries) {
      if (!entry?.pack?.id) continue;
      if (seenPackIds.has(entry.pack.id)) continue;
      seenPackIds.add(entry.pack.id);
      collectedEntries.push(entry);
      if (collectedEntries.length >= limit) break;
    }
  }

  sendJson(req, res, 200, {
    data: collectedEntries.map((entry) => toSummaryEntry(entry)),
    pagination: {
      limit,
      offset,
      has_more: sourceHasMore,
      next_offset: sourceHasMore ? cursorOffset : null,
    },
    filters: {
      q,
      visibility,
      categories,
      intent: intent || null,
      include_sensitive: includeSensitive,
    },
  });
};

const handleIntentCollectionsRequest = async (req, res, url) => {
  const visibility = normalizeCatalogVisibility(url.searchParams.get('visibility'));
  const q = sanitizeText(url.searchParams.get('q') || '', 120, { allowEmpty: true }) || '';
  const categories = parseCategoryFilters(url.searchParams.get('categories'));
  const limit = clampInt(url.searchParams.get('limit'), 18, 4, 50);

  const { packs } = await listStickerPacksForCatalog({
    visibility,
    search: q,
    limit: Math.max(limit * 3, 40),
    offset: 0,
  });
  const driftSnapshot = await getMarketplaceDriftSnapshot();
  const { entries } = await hydrateMarketplaceEntries(packs, { driftSnapshot });
  const entriesClassified = STICKER_CATALOG_ONLY_CLASSIFIED
    ? entries.filter((entry) => isPackClassified(entry.packClassification))
    : entries;
  const entriesByCategory = categories.length
    ? entriesClassified.filter((entry) => hasAnyCategory(entry.packClassification?.tags || [], categories))
    : entriesClassified;
  const intents = buildIntentCollections(entriesByCategory, { limit });

  sendJson(req, res, 200, {
    data: {
      em_alta: intents.em_alta.map((entry) => toSummaryEntry(entry)),
      novos: intents.novos.map((entry) => toSummaryEntry(entry)),
      crescendo_agora: intents.crescendo_agora.map((entry) => toSummaryEntry(entry)),
      mais_curtidos: intents.mais_curtidos.map((entry) => toSummaryEntry(entry)),
      melhor_avaliados: intents.melhor_avaliados.map((entry) => toSummaryEntry(entry)),
    },
    filters: {
      visibility,
      q,
      categories,
      limit,
    },
  });
};

const handleMarketplaceStatsRequest = async (req, res, url) => {
  const visibility = normalizeCatalogVisibility(url.searchParams.get('visibility'));
  const visibilityValues =
    visibility === 'all'
      ? ['public', 'unlisted']
      : visibility === 'unlisted'
        ? ['unlisted']
        : ['public'];
  const placeholders = visibilityValues.map(() => '?').join(', ');

  const [packStatsRow] = await executeQuery(
    `SELECT
       COUNT(DISTINCT p.id) AS packs_total,
       COUNT(i.sticker_id) AS stickers_total,
       COUNT(DISTINCT p.publisher) AS creators_total
     FROM sticker_pack p
     LEFT JOIN sticker_pack_item i ON i.pack_id = p.id
     WHERE p.deleted_at IS NULL
       AND p.status = 'published'
       AND p.visibility IN (${placeholders})`,
    visibilityValues,
  );

  const [downloadsRow] = await executeQuery(
    `SELECT COALESCE(SUM(e.open_count), 0) AS downloads_total
     FROM sticker_pack_engagement e
     INNER JOIN sticker_pack p ON p.id = e.pack_id
     WHERE p.deleted_at IS NULL
       AND p.status = 'published'
       AND p.visibility IN (${placeholders})`,
    visibilityValues,
  );

  sendJson(req, res, 200, {
    data: {
      packs_total: Number(packStatsRow?.packs_total || 0),
      stickers_total: Number(packStatsRow?.stickers_total || 0),
      creators_total: Number(packStatsRow?.creators_total || 0),
      downloads_total: Number(downloadsRow?.downloads_total || 0),
    },
    filters: {
      visibility,
    },
  });
};

const handleCreatePackConfigRequest = async (req, res) => {
  triggerStaleDraftCleanup();
  sendJson(req, res, 200, {
    data: {
      command_prefix: PACK_COMMAND_PREFIX,
      limits: {
        pack_name_max_length: PACK_CREATE_MAX_NAME_LENGTH,
        publisher_max_length: PACK_CREATE_MAX_PUBLISHER_LENGTH,
        description_max_length: PACK_CREATE_MAX_DESCRIPTION_LENGTH,
        stickers_per_pack: PACK_CREATE_MAX_ITEMS,
        packs_per_owner: PACK_CREATE_MAX_PACKS_PER_OWNER,
        sticker_upload_max_bytes: MAX_STICKER_UPLOAD_BYTES,
        sticker_upload_source_max_bytes: MAX_STICKER_SOURCE_UPLOAD_BYTES,
      },
      rules: {
        pack_name_regex: PACK_CREATE_NAME_REGEX,
        pack_name_hint: 'Nome livre (espaços e emojis são permitidos).',
        visibility_values: ['public', 'unlisted', 'private'],
        owner_phone_required: !STICKER_WEB_GOOGLE_AUTH_REQUIRED,
        owner_phone_hint: STICKER_WEB_GOOGLE_AUTH_REQUIRED
          ? 'Login Google obrigatório para criar packs nesta página.'
          : 'Informe o número de celular com DDD para vincular o pack ao criador.',
        suggested_tags: ['anime', 'meme', 'game', 'texto', 'nsfw', 'dark', 'cartoon', 'foto-real', 'cyberpunk'],
      },
      auth: {
        google: {
          enabled: Boolean(STICKER_WEB_GOOGLE_CLIENT_ID),
          required: Boolean(STICKER_WEB_GOOGLE_AUTH_REQUIRED),
          client_id: STICKER_WEB_GOOGLE_CLIENT_ID || null,
          session_ttl_ms: STICKER_WEB_GOOGLE_SESSION_TTL_MS,
        },
      },
      examples: {
        create: `${PACK_COMMAND_PREFIX}pack create meupack | publisher="Seu Nome" | desc="Descrição"`,
        add_sticker: `${PACK_COMMAND_PREFIX}pack add <pack>`,
        set_description: `${PACK_COMMAND_PREFIX}pack setdesc <pack> "Nova descrição"`,
      },
      links: {
        stickers: `${STICKER_WEB_PATH}/`,
        create: `${STICKER_CREATE_WEB_PATH}/`,
        api_base: STICKER_API_BASE_PATH,
        create_api: `${STICKER_API_BASE_PATH}/create`,
        google_auth_session_api: `${STICKER_API_BASE_PATH}/auth/google/session`,
        upload_api_template: `${STICKER_API_BASE_PATH}/:pack_key/stickers-upload`,
        finalize_api_template: `${STICKER_API_BASE_PATH}/:pack_key/finalize`,
        publish_state_api_template: `${STICKER_API_BASE_PATH}/:pack_key/publish-state`,
      },
      publish_flow: {
        statuses: ['draft', 'uploading', 'processing', 'published', 'failed'],
        upload_queue_concurrency: WEB_UPLOAD_MAX_CONCURRENCY,
        finalize_required: true,
      },
    },
  });
};

const handleGoogleAuthSessionRequest = async (req, res) => {
  if (!STICKER_WEB_GOOGLE_CLIENT_ID) {
    sendJson(req, res, 404, { error: 'Login Google desabilitado.' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const session = resolveGoogleWebSessionFromRequest(req);
    sendJson(req, res, 200, {
      data: session
        ? {
            authenticated: true,
            provider: 'google',
            user: {
              sub: session.sub,
              email: session.email,
              name: session.name,
              picture: session.picture,
            },
            expires_at: toIsoOrNull(session.expiresAt),
          }
        : {
            authenticated: false,
            provider: 'google',
            user: null,
            expires_at: null,
          },
    });
    return;
  }

  if (req.method === 'DELETE') {
    const cookies = parseCookies(req);
    const token = String(cookies[GOOGLE_WEB_SESSION_COOKIE_NAME] || '').trim();
    if (token) webGoogleSessionMap.delete(token);
    clearGoogleWebSessionCookie(req, res);
    sendJson(req, res, 200, { data: { cleared: true } });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }

  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  try {
    const claims = await verifyGoogleIdToken(payload?.google_id_token || payload?.id_token);
    const session = createGoogleWebSession(claims);
    if (!session.ownerJid) {
      sendJson(req, res, 400, { error: 'Nao foi possivel vincular a conta Google.' });
      return;
    }

    appendSetCookie(
      res,
      buildCookieString(GOOGLE_WEB_SESSION_COOKIE_NAME, session.token, req, {
        maxAgeSeconds: Math.floor(STICKER_WEB_GOOGLE_SESSION_TTL_MS / 1000),
      }),
    );
    sendJson(req, res, 200, {
      data: {
        authenticated: true,
        provider: 'google',
        user: {
          sub: session.sub,
          email: session.email,
          name: session.name,
          picture: session.picture,
        },
        expires_at: toIsoOrNull(session.expiresAt),
      },
    });
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 401), {
      error: error?.message || 'Login Google inválido.',
      code: STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
    });
  }
};

const mapGoogleSessionResponseData = (session) =>
  session
    ? {
        authenticated: true,
        provider: 'google',
        user: {
          sub: session.sub,
          email: session.email,
          name: session.name,
          picture: session.picture,
        },
        expires_at: toIsoOrNull(session.expiresAt),
      }
    : {
        authenticated: false,
        provider: 'google',
        user: null,
        expires_at: null,
      };

const handleMyProfileRequest = async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }

  const session = resolveGoogleWebSessionFromRequest(req);
  const authGoogle = {
    enabled: Boolean(STICKER_WEB_GOOGLE_CLIENT_ID),
    required: Boolean(STICKER_WEB_GOOGLE_AUTH_REQUIRED),
    client_id: STICKER_WEB_GOOGLE_CLIENT_ID || null,
  };

  if (!session?.ownerJid) {
    sendJson(req, res, 200, {
      data: {
        auth: { google: authGoogle },
        session: mapGoogleSessionResponseData(null),
        owner_jid: null,
        packs: [],
        stats: {
          total: 0,
          published: 0,
          drafts: 0,
          private: 0,
          unlisted: 0,
          public: 0,
        },
      },
    });
    return;
  }

  const packs = await listStickerPacksByOwner(session.ownerJid, { limit: 200, offset: 0 });
  const engagementByPackId = await listStickerPackEngagementByPackIds(packs.map((pack) => pack.id));

  const mappedPacks = packs.map((pack) => {
    const safeSummary = mapPackSummary(pack, engagementByPackId.get(pack.id) || null, null);
    const publicVisible = isPackPubliclyVisible(pack);
    return {
      ...safeSummary,
      is_publicly_visible: publicVisible,
      cover_url: publicVisible ? safeSummary.cover_url : null,
    };
  });

  const stats = mappedPacks.reduce(
    (acc, pack) => {
      acc.total += 1;
      const status = String(pack.status || '').toLowerCase();
      const visibility = String(pack.visibility || '').toLowerCase();
      if (status === 'published') acc.published += 1;
      if (status === 'draft') acc.drafts += 1;
      if (visibility === 'private') acc.private += 1;
      if (visibility === 'unlisted') acc.unlisted += 1;
      if (visibility === 'public') acc.public += 1;
      return acc;
    },
    { total: 0, published: 0, drafts: 0, private: 0, unlisted: 0, public: 0 },
  );

  sendJson(req, res, 200, {
    data: {
      auth: { google: authGoogle },
      session: mapGoogleSessionResponseData(session),
      owner_jid: session.ownerJid,
      packs: mappedPacks,
      stats,
    },
  });
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const invalidateStickerCatalogDerivedCaches = () => {
  GLOBAL_RANK_CACHE.expiresAt = 0;
  GLOBAL_RANK_CACHE.value = null;
  GLOBAL_RANK_CACHE.pending = null;
};

const sendManagedMutationStatus = (req, res, status, extra = {}, statusCode = 200) => {
  sendJson(req, res, statusCode, {
    data: {
      success: true,
      status,
      ...extra,
    },
  });
};

const sendManagedPackMutationStatus = async (req, res, status, pack, extra = {}, statusCode = 200) => {
  if (!pack) {
    sendManagedMutationStatus(req, res, status, extra, statusCode);
    return;
  }
  const managed = await buildManagedPackResponseData(pack);
  sendJson(req, res, statusCode, {
    data: {
      success: true,
      status,
      ...extra,
      ...managed,
    },
  });
};

const cleanupOrphanStickerAssets = async (assetIds, { reason = 'manage_mutation' } = {}) => {
  const normalizedIds = Array.from(new Set((Array.isArray(assetIds) ? assetIds : []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!normalizedIds.length) return { checked: 0, deleted: 0, skipped: 0, errors: 0 };

  const assets = await findStickerAssetsByIds(normalizedIds).catch(() => []);
  const byId = new Map((Array.isArray(assets) ? assets : []).map((asset) => [asset.id, asset]));
  const summary = { checked: 0, deleted: 0, skipped: 0, errors: 0 };

  for (const assetId of normalizedIds) {
    summary.checked += 1;
    try {
      const result = await runSqlTransaction(async (connection) => {
        const refs = await countStickerPackItemRefsByStickerId(assetId, connection);
        if (refs > 0) return { deleted: false, refs, alreadyGone: false };
        await deleteStickerAssetClassificationByAssetId(assetId, connection);
        const deletedRows = await deleteStickerAssetById(assetId, connection);
        return { deleted: deletedRows > 0, refs, alreadyGone: deletedRows === 0 };
      });

      if (!result.deleted) {
        summary.skipped += 1;
        continue;
      }

      summary.deleted += 1;
      const asset = byId.get(assetId);
      if (asset?.storage_path) {
        await fs.unlink(asset.storage_path).catch((error) => {
          if (error?.code === 'ENOENT') return;
          logger.warn('Falha ao remover arquivo físico de sticker órfão.', {
            action: 'sticker_orphan_asset_file_delete_failed',
            asset_id: assetId,
            storage_path: asset.storage_path,
            reason,
            error: error?.message,
          });
        });
      }
    } catch (error) {
      summary.errors += 1;
      logger.warn('Falha ao limpar asset órfão após mutação de pack.', {
        action: 'sticker_orphan_asset_cleanup_failed',
        asset_id: assetId,
        reason,
        error: error?.message,
      });
    }
  }

  return summary;
};

const deleteManagedPackWithCleanup = async ({ ownerJid, identifier, fallbackPack = null }) => {
  const transactionResult = await runSqlTransaction(async (connection) => {
    const pack =
      (await findStickerPackByOwnerAndIdentifier(ownerJid, fallbackPack?.id || identifier, { connection })) ||
      (fallbackPack?.pack_key && fallbackPack?.pack_key !== identifier
        ? await findStickerPackByOwnerAndIdentifier(ownerJid, identifier, { connection })
        : null);

    if (!pack) {
      return {
        missing: true,
        deletedPack: null,
        removedStickerIds: [],
        removedCount: 0,
      };
    }

    const items = await listStickerPackItems(pack.id, connection);
    const removedStickerIds = items.map((item) => item?.sticker_id).filter(Boolean);
    await removeStickerPackItemsByPackId(pack.id, connection);
    const deletedPack = await softDeleteStickerPack(pack.id, connection);

    return {
      missing: false,
      deletedPack,
      removedStickerIds,
      removedCount: items.length,
    };
  });

  if (!transactionResult.missing && transactionResult.removedStickerIds.length) {
    await cleanupOrphanStickerAssets(transactionResult.removedStickerIds, { reason: 'delete_pack' });
  }

  invalidateStickerCatalogDerivedCaches();
  return transactionResult;
};

const mapStickerPackWebManageError = (error) => {
  if (!(error instanceof StickerPackError)) {
    return {
      statusCode: 500,
      code: STICKER_PACK_ERROR_CODES.INTERNAL_ERROR,
      message: error?.message || 'Falha interna ao gerenciar pack.',
    };
  }

  if (error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
    return { statusCode: 404, code: error.code, message: error.message || 'Pack nao encontrado.' };
  }
  if (error.code === STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND) {
    return { statusCode: 404, code: error.code, message: error.message || 'Sticker nao encontrado.' };
  }
  if (error.code === STICKER_PACK_ERROR_CODES.NOT_ALLOWED) {
    return { statusCode: 403, code: error.code, message: error.message || 'Operacao nao permitida.' };
  }
  if (error.code === STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED) {
    return { statusCode: 429, code: error.code, message: error.message || 'Limite de packs atingido.' };
  }
  if (error.code === STICKER_PACK_ERROR_CODES.INVALID_INPUT) {
    return { statusCode: 400, code: error.code, message: error.message || 'Dados invalidos.' };
  }
  return { statusCode: 400, code: error.code, message: error.message || 'Falha ao gerenciar pack.' };
};

const requireGoogleWebSessionForManagement = (req, res) => {
  const session = resolveGoogleWebSessionFromRequest(req);
  if (!session?.ownerJid) {
    sendJson(req, res, 401, {
      error: 'Login Google obrigatorio para gerenciar packs.',
      code: STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
    });
    return null;
  }
  return session;
};

const loadOwnedPackForWebManagement = async (req, res, packKey, { allowMissing = false } = {}) => {
  const session = requireGoogleWebSessionForManagement(req, res);
  if (!session) return null;

  const normalizedPackKey = sanitizeText(packKey, 160, { allowEmpty: false });
  if (!normalizedPackKey) {
    sendJson(req, res, 400, {
      error: 'pack_key invalido.',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return null;
  }

  try {
    const pack = await stickerPackService.getPackInfo({
      ownerJid: session.ownerJid,
      identifier: normalizedPackKey,
    });
    return { session, packKey: normalizedPackKey, pack };
  } catch (error) {
    if (allowMissing && error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
      return { session, packKey: normalizedPackKey, pack: null, missing: true };
    }
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, {
      error: mapped.message,
      code: mapped.code,
    });
    return null;
  }
};

const buildManagedPackAnalytics = async (pack) => {
  const engagement = await getStickerPackEngagementByPackId(pack.id);
  const interactionStatsByPack = await listStickerPackInteractionStatsByPackIds([pack.id]);
  const interaction = interactionStatsByPack.get(pack.id) || {
    open_horizon: 0,
    open_baseline: 0,
    like_horizon: 0,
    like_baseline: 0,
    dislike_horizon: 0,
    dislike_baseline: 0,
  };
  return {
    downloads: Number(engagement?.open_count || 0),
    likes: Number(engagement?.like_count || 0),
    dislikes: Number(engagement?.dislike_count || 0),
    score:
      Number(engagement?.score || 0) ||
      Number(engagement?.like_count || 0) - Number(engagement?.dislike_count || 0),
    engagement: {
      open_count: Number(engagement?.open_count || 0),
      like_count: Number(engagement?.like_count || 0),
      dislike_count: Number(engagement?.dislike_count || 0),
      updated_at: toIsoOrNull(engagement?.updated_at || null),
    },
    interaction_window: {
      open_horizon: Number(interaction.open_horizon || 0),
      open_baseline: Number(interaction.open_baseline || 0),
      like_horizon: Number(interaction.like_horizon || 0),
      like_baseline: Number(interaction.like_baseline || 0),
      dislike_horizon: Number(interaction.dislike_horizon || 0),
      dislike_baseline: Number(interaction.dislike_baseline || 0),
    },
  };
};

const buildManagedPackResponseData = async (pack) => {
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const stickerIds = items.map((item) => item.sticker_id).filter(Boolean);

  const [classifications, packClassification, analytics, publishState] = await Promise.all([
    stickerIds.length ? listStickerClassificationsByAssetIds(stickerIds) : Promise.resolve([]),
    pack?.classification || (stickerIds.length ? getPackClassificationSummaryByAssetIds(stickerIds).catch(() => null) : null),
    buildManagedPackAnalytics(pack),
    buildPackPublishStateData(pack, { includeUploads: true }),
  ]);

  const byAssetClassification = new Map((Array.isArray(classifications) ? classifications : []).map((entry) => [entry.asset_id, entry]));

  return {
    pack: mapPackDetails(pack, items, {
      byAssetClassification,
      packClassification: packClassification || null,
      engagement: analytics.engagement,
      signals: null,
    }),
    publish_state: publishState,
    analytics,
  };
};

const sendManagedPackResponse = async (req, res, pack) => {
  const data = await buildManagedPackResponseData(pack);
  sendJson(req, res, 200, { data });
};

const parseTagListInput = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',');
  return [];
};

const handleManagedPackRequest = async (req, res, packKey) => {
  if (!['GET', 'HEAD', 'PATCH', 'DELETE'].includes(req.method || '')) {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }

  const isMutableMethod = req.method === 'PATCH' || req.method === 'DELETE';
  const context = await loadOwnedPackForWebManagement(req, res, packKey, { allowMissing: isMutableMethod });
  if (!context) return;
  const { session, packKey: normalizedPackKey } = context;

  if (req.method === 'GET' || req.method === 'HEAD') {
    await sendManagedPackResponse(req, res, context.pack);
    return;
  }

  if (req.method === 'DELETE') {
    if (context.missing || !context.pack) {
      sendManagedMutationStatus(req, res, 'already_deleted', {
        deleted: false,
        pack_key: normalizedPackKey,
      });
      return;
    }

    try {
      const result = await deleteManagedPackWithCleanup({
        ownerJid: session.ownerJid,
        identifier: normalizedPackKey,
        fallbackPack: context.pack,
      });
      if (result?.missing) {
        sendManagedMutationStatus(req, res, 'already_deleted', {
          deleted: false,
          pack_key: normalizedPackKey,
        });
        return;
      }

      sendManagedMutationStatus(req, res, 'deleted', {
        deleted: true,
        pack_key: result?.deletedPack?.pack_key || normalizedPackKey,
        id: result?.deletedPack?.id || context.pack?.id || null,
        deleted_at: toIsoOrNull(result?.deletedPack?.deleted_at || new Date()),
        removed_sticker_count: Number(result?.removedCount || 0),
      });
    } catch (error) {
      const mapped = mapStickerPackWebManageError(error);
      sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
    }
    return;
  }

  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  try {
    if (context.missing || !context.pack) {
      sendManagedMutationStatus(req, res, 'already_deleted', {
        updated: false,
        pack_key: normalizedPackKey,
      });
      return;
    }

    let updatedPack = context.pack;
    let changed = false;

    if (hasOwn(payload, 'name')) {
      const nextName = sanitizeText(payload?.name, PACK_CREATE_MAX_NAME_LENGTH, { allowEmpty: false });
      const currentName = sanitizeText(updatedPack?.name, PACK_CREATE_MAX_NAME_LENGTH, { allowEmpty: false });
      if (!nextName) {
        updatedPack = await stickerPackService.renamePack({
          ownerJid: session.ownerJid,
          identifier: normalizedPackKey,
          name: payload.name,
        });
      } else if (nextName !== currentName) {
        updatedPack = await stickerPackService.renamePack({
          ownerJid: session.ownerJid,
          identifier: normalizedPackKey,
          name: payload.name,
        });
        changed = true;
      }
    }

    if (hasOwn(payload, 'publisher')) {
      const nextPublisher = sanitizeText(payload?.publisher, PACK_CREATE_MAX_PUBLISHER_LENGTH, { allowEmpty: false });
      const currentPublisher = sanitizeText(updatedPack?.publisher, PACK_CREATE_MAX_PUBLISHER_LENGTH, { allowEmpty: false });
      if (!nextPublisher) {
        updatedPack = await stickerPackService.setPackPublisher({
          ownerJid: session.ownerJid,
          identifier: normalizedPackKey,
          publisher: payload.publisher,
        });
      } else if (nextPublisher !== currentPublisher) {
        updatedPack = await stickerPackService.setPackPublisher({
          ownerJid: session.ownerJid,
          identifier: normalizedPackKey,
          publisher: payload.publisher,
        });
        changed = true;
      }
    }

    if (hasOwn(payload, 'visibility')) {
      const nextVisibility = String(payload?.visibility || '').trim().toLowerCase();
      const currentVisibility = String(updatedPack?.visibility || '').trim().toLowerCase();
      if (!nextVisibility) {
        updatedPack = await stickerPackService.setPackVisibility({
          ownerJid: session.ownerJid,
          identifier: normalizedPackKey,
          visibility: payload.visibility,
        });
      } else if (nextVisibility !== currentVisibility) {
        updatedPack = await stickerPackService.setPackVisibility({
          ownerJid: session.ownerJid,
          identifier: normalizedPackKey,
          visibility: payload.visibility,
        });
        changed = true;
      }
    }

    if (hasOwn(payload, 'description') || hasOwn(payload, 'tags')) {
      const currentMeta = parsePackDescriptionMetadata(updatedPack?.description);
      const nextDescription = hasOwn(payload, 'description') ? String(payload?.description || '') : String(currentMeta.cleanDescription || '');
      const nextTags = hasOwn(payload, 'tags') ? parseTagListInput(payload?.tags) : currentMeta.tags;
      const descriptionWithTags = buildPackDescriptionWithTags(nextDescription, nextTags);
      const currentDescriptionWithTags = buildPackDescriptionWithTags(currentMeta.cleanDescription || '', currentMeta.tags);
      if (String(descriptionWithTags || '') !== String(currentDescriptionWithTags || '')) {
        updatedPack = await stickerPackService.setPackDescription({
          ownerJid: session.ownerJid,
          identifier: normalizedPackKey,
          description: descriptionWithTags || '',
        });
        changed = true;
      }
    }

    if (changed) invalidateStickerCatalogDerivedCaches();
    await sendManagedPackMutationStatus(req, res, changed ? 'updated' : 'unchanged', updatedPack, {
      updated: changed,
      pack_key: normalizedPackKey,
    });
  } catch (error) {
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
      sendManagedMutationStatus(req, res, 'already_deleted', {
        updated: false,
        pack_key: normalizedPackKey,
      });
      return;
    }
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleManagedPackCloneRequest = async (req, res, packKey) => {
  if (req.method !== 'POST') {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }
  const context = await loadOwnedPackForWebManagement(req, res, packKey);
  if (!context) return;

  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  const baseName = sanitizeText(context.pack?.name || 'Pack', PACK_CREATE_MAX_NAME_LENGTH, { allowEmpty: false }) || 'Pack';
  const requestedName = sanitizeText(payload?.new_name || '', PACK_CREATE_MAX_NAME_LENGTH, { allowEmpty: true });
  const newName = requestedName || `${baseName} (copia)`;

  try {
    const cloned = await stickerPackService.clonePack({
      ownerJid: context.session.ownerJid,
      identifier: context.packKey,
      newName,
    });
    invalidateStickerCatalogDerivedCaches();
    sendJson(req, res, 201, {
      data: {
        pack: mapPackSummary(cloned),
      },
    });
  } catch (error) {
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleManagedPackCoverRequest = async (req, res, packKey) => {
  if (req.method !== 'POST') {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }
  const context = await loadOwnedPackForWebManagement(req, res, packKey, { allowMissing: true });
  if (!context) return;
  if (context.missing || !context.pack) {
    sendManagedMutationStatus(req, res, 'already_deleted', { pack_key: context.packKey || String(packKey || '') });
    return;
  }

  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  try {
    const updated = await stickerPackService.setPackCover({
      ownerJid: context.session.ownerJid,
      identifier: context.packKey,
      stickerId: payload?.sticker_id,
    });
    invalidateStickerCatalogDerivedCaches();
    await sendManagedPackMutationStatus(req, res, 'updated', updated, { pack_key: context.packKey });
  } catch (error) {
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
      sendManagedMutationStatus(req, res, 'already_deleted', { pack_key: context.packKey });
      return;
    }
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND) {
      const fresh = await stickerPackService
        .getPackInfo({ ownerJid: context.session.ownerJid, identifier: context.packKey })
        .catch(() => context.pack);
      await sendManagedPackMutationStatus(req, res, 'already_deleted', fresh, {
        pack_key: context.packKey,
        sticker_id: sanitizeText(payload?.sticker_id, 36, { allowEmpty: true }) || null,
      });
      return;
    }
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleManagedPackReorderRequest = async (req, res, packKey) => {
  if (req.method !== 'POST') {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }
  const context = await loadOwnedPackForWebManagement(req, res, packKey, { allowMissing: true });
  if (!context) return;
  if (context.missing || !context.pack) {
    sendManagedMutationStatus(req, res, 'already_deleted', { pack_key: context.packKey || String(packKey || '') });
    return;
  }

  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  const requestedOrderIds = Array.isArray(payload?.order_sticker_ids) ? payload.order_sticker_ids : [];
  const currentItems = Array.isArray(context.pack?.items) ? context.pack.items : [];
  if (currentItems.length < 2) {
    await sendManagedPackMutationStatus(req, res, 'noop', context.pack, {
      pack_key: context.packKey,
      reason: 'pack_has_less_than_two_stickers',
    });
    return;
  }
  if (!requestedOrderIds.length) {
    await sendManagedPackMutationStatus(req, res, 'noop', context.pack, {
      pack_key: context.packKey,
      reason: 'empty_order_payload',
    });
    return;
  }

  try {
    const updated = await stickerPackService.reorderPackItems({
      ownerJid: context.session.ownerJid,
      identifier: context.packKey,
      orderStickerIds: requestedOrderIds,
    });
    invalidateStickerCatalogDerivedCaches();
    await sendManagedPackMutationStatus(req, res, 'updated', updated, { pack_key: context.packKey });
  } catch (error) {
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
      sendManagedMutationStatus(req, res, 'already_deleted', { pack_key: context.packKey });
      return;
    }
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.INVALID_INPUT) {
      const fresh = await stickerPackService
        .getPackInfo({ ownerJid: context.session.ownerJid, identifier: context.packKey })
        .catch(() => context.pack);
      await sendManagedPackMutationStatus(req, res, 'noop', fresh, {
        pack_key: context.packKey,
        reason: 'invalid_or_stale_order',
      });
      return;
    }
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleManagedPackStickerDeleteRequest = async (req, res, packKey, stickerId) => {
  if (req.method !== 'DELETE') {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }
  const context = await loadOwnedPackForWebManagement(req, res, packKey, { allowMissing: true });
  if (!context) return;
  if (context.missing || !context.pack) {
    sendManagedMutationStatus(req, res, 'already_deleted', {
      pack_key: context.packKey || String(packKey || ''),
      sticker_id: sanitizeText(stickerId, 36, { allowEmpty: true }) || null,
    });
    return;
  }

  try {
    const result = await stickerPackService.removeStickerFromPack({
      ownerJid: context.session.ownerJid,
      identifier: context.packKey,
      selector: stickerId,
    });
    invalidateStickerCatalogDerivedCaches();
    const removedStickerId = result?.removed?.sticker_id || sanitizeText(stickerId, 36, { allowEmpty: true }) || null;
    if (removedStickerId) {
      await cleanupOrphanStickerAssets([removedStickerId], { reason: 'remove_sticker' });
    }
    await sendManagedPackMutationStatus(req, res, 'updated', result?.pack || context.pack, {
      pack_key: context.packKey,
      removed_sticker_id: removedStickerId,
    });
  } catch (error) {
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
      sendManagedMutationStatus(req, res, 'already_deleted', {
        pack_key: context.packKey,
        sticker_id: sanitizeText(stickerId, 36, { allowEmpty: true }) || null,
      });
      return;
    }
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.STICKER_NOT_FOUND) {
      const fresh = await stickerPackService
        .getPackInfo({ ownerJid: context.session.ownerJid, identifier: context.packKey })
        .catch(() => context.pack);
      await sendManagedPackMutationStatus(req, res, 'already_deleted', fresh, {
        pack_key: context.packKey,
        sticker_id: sanitizeText(stickerId, 36, { allowEmpty: true }) || null,
      });
      return;
    }
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleManagedPackStickerCreateRequest = async (req, res, packKey) => {
  if (req.method !== 'POST') {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }
  const context = await loadOwnedPackForWebManagement(req, res, packKey, { allowMissing: true });
  if (!context) return;
  if (context.missing || !context.pack) {
    sendManagedMutationStatus(req, res, 'already_deleted', { pack_key: context.packKey || String(packKey || '') });
    return;
  }

  let payload = {};
  try {
    payload = await readJsonBody(req, {
      maxBytes: Math.max(256 * 1024, Math.round(MAX_STICKER_SOURCE_UPLOAD_BYTES * 1.6)),
    });
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  const decoded = decodeStickerBase64Payload(payload?.sticker_base64 || payload?.sticker_data_url || '');
  if (!decoded?.buffer) {
    sendJson(req, res, 400, {
      error: 'Envie sticker_base64 ou sticker_data_url.',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }
  if (decoded.buffer.length > MAX_STICKER_SOURCE_UPLOAD_BYTES) {
    sendJson(req, res, 400, {
      error: `Arquivo excede limite de ${Math.round(MAX_STICKER_SOURCE_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  let uploadedAssetId = '';
  try {
    const normalizedUpload = await convertUploadMediaToWebp({
      ownerJid: context.session.ownerJid,
      buffer: decoded.buffer,
      mimetype: decoded.mimetype || 'image/webp',
    });
    const asset = await saveStickerAssetFromBuffer({
      ownerJid: context.session.ownerJid,
      buffer: normalizedUpload.buffer,
      mimetype: normalizedUpload.mimetype || 'image/webp',
    });
    uploadedAssetId = String(asset?.id || '').trim();

    let updatedPack = await stickerPackService.addStickerToPack({
      ownerJid: context.session.ownerJid,
      identifier: context.packKey,
      asset: { id: uploadedAssetId },
      emojis: [],
      accessibilityLabel: null,
    });

    if (payload?.set_cover === true) {
      updatedPack = await stickerPackService.setPackCover({
        ownerJid: context.session.ownerJid,
        identifier: context.packKey,
        stickerId: uploadedAssetId,
      });
    }

    invalidateStickerCatalogDerivedCaches();

    sendJson(req, res, 201, {
      data: {
        success: true,
        status: 'updated',
        added_sticker_id: uploadedAssetId,
        ...(await buildManagedPackResponseData(updatedPack)),
      },
    });
  } catch (error) {
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
      sendManagedMutationStatus(req, res, 'already_deleted', { pack_key: context.packKey });
      return;
    }
    if (uploadedAssetId) {
      await cleanupOrphanStickerAssets([uploadedAssetId], { reason: 'add_sticker_error_recovery' }).catch(() => {});
    }
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleManagedPackStickerReplaceRequest = async (req, res, packKey, stickerId) => {
  if (req.method !== 'POST') {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }
  const context = await loadOwnedPackForWebManagement(req, res, packKey, { allowMissing: true });
  if (!context) return;
  if (context.missing || !context.pack) {
    sendManagedMutationStatus(req, res, 'already_deleted', {
      pack_key: context.packKey || String(packKey || ''),
      sticker_id: sanitizeText(stickerId, 36, { allowEmpty: true }) || null,
    });
    return;
  }

  let payload = {};
  try {
    payload = await readJsonBody(req, {
      maxBytes: Math.max(256 * 1024, Math.round(MAX_STICKER_SOURCE_UPLOAD_BYTES * 1.6)),
    });
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  const decoded = decodeStickerBase64Payload(payload?.sticker_base64 || payload?.sticker_data_url || '');
  if (!decoded?.buffer) {
    sendJson(req, res, 400, {
      error: 'Envie sticker_base64 ou sticker_data_url.',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }
  if (decoded.buffer.length > MAX_STICKER_SOURCE_UPLOAD_BYTES) {
    sendJson(req, res, 400, {
      error: `Arquivo excede limite de ${Math.round(MAX_STICKER_SOURCE_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  const normalizedStickerId = sanitizeText(stickerId, 36, { allowEmpty: false });
  if (!normalizedStickerId) {
    sendJson(req, res, 400, { error: 'sticker_id invalido.', code: STICKER_PACK_ERROR_CODES.INVALID_INPUT });
    return;
  }

  let uploadedAssetId = '';
  try {
    const originalPack = await stickerPackService.getPackInfo({
      ownerJid: context.session.ownerJid,
      identifier: context.packKey,
    });
    const originalItems = Array.isArray(originalPack?.items) ? originalPack.items : [];
    const oldItem = originalItems.find((item) => item?.sticker_id === normalizedStickerId);
    if (!oldItem) {
      await sendManagedPackMutationStatus(req, res, 'already_deleted', originalPack, {
        pack_key: context.packKey,
        sticker_id: normalizedStickerId,
      });
      return;
    }

    const normalizedUpload = await convertUploadMediaToWebp({
      ownerJid: context.session.ownerJid,
      buffer: decoded.buffer,
      mimetype: decoded.mimetype || 'image/webp',
    });
    const asset = await saveStickerAssetFromBuffer({
      ownerJid: context.session.ownerJid,
      buffer: normalizedUpload.buffer,
      mimetype: normalizedUpload.mimetype || 'image/webp',
    });
    uploadedAssetId = String(asset?.id || '').trim();

    if (uploadedAssetId && uploadedAssetId === normalizedStickerId) {
      await sendManagedPackMutationStatus(req, res, 'unchanged', originalPack, {
        pack_key: context.packKey,
        replaced_sticker_id: normalizedStickerId,
        new_sticker_id: uploadedAssetId,
      });
      return;
    }

    const swapResult = await runSqlTransaction(async (connection) => {
      const packRow = await findStickerPackByOwnerAndIdentifier(context.session.ownerJid, context.packKey, { connection });
      if (!packRow) return { status: 'pack_missing' };

      const liveOldItem = await getStickerPackItemByStickerId(packRow.id, normalizedStickerId, connection);
      if (!liveOldItem) return { status: 'old_sticker_missing' };

      const duplicateTarget = uploadedAssetId ? await getStickerPackItemByStickerId(packRow.id, uploadedAssetId, connection) : null;
      if (duplicateTarget) {
        return { status: 'duplicate_target' };
      }

      const removed = await removeStickerPackItemByStickerId(packRow.id, normalizedStickerId, connection);
      if (!removed) return { status: 'old_sticker_missing' };

      await createStickerPackItem(
        {
          id: randomUUID(),
          pack_id: packRow.id,
          sticker_id: uploadedAssetId,
          position: Number(removed.position || liveOldItem.position || oldItem.position || 1),
          emojis: Array.isArray(liveOldItem.emojis) ? liveOldItem.emojis : Array.isArray(oldItem.emojis) ? oldItem.emojis : [],
          accessibility_label: liveOldItem.accessibility_label ?? oldItem.accessibility_label ?? null,
        },
        connection,
      );

      if (String(packRow.cover_sticker_id || '') === normalizedStickerId) {
        await updateStickerPackFields(
          packRow.id,
          {
            cover_sticker_id: uploadedAssetId,
          },
          connection,
        );
      } else {
        await bumpStickerPackVersion(packRow.id, connection);
      }

      return { status: 'updated', pack_id: packRow.id };
    });

    if (swapResult?.status === 'pack_missing') {
      await cleanupOrphanStickerAssets(uploadedAssetId ? [uploadedAssetId] : [], { reason: 'replace_sticker_pack_missing' });
      sendManagedMutationStatus(req, res, 'already_deleted', {
        pack_key: context.packKey,
        sticker_id: normalizedStickerId,
      });
      return;
    }

    if (swapResult?.status === 'old_sticker_missing') {
      const fresh = await stickerPackService
        .getPackInfo({ ownerJid: context.session.ownerJid, identifier: context.packKey })
        .catch(() => originalPack);
      await cleanupOrphanStickerAssets(uploadedAssetId ? [uploadedAssetId] : [], { reason: 'replace_sticker_old_missing' });
      await sendManagedPackMutationStatus(req, res, 'already_deleted', fresh, {
        pack_key: context.packKey,
        sticker_id: normalizedStickerId,
      });
      return;
    }

    if (swapResult?.status === 'duplicate_target') {
      const fresh = await stickerPackService
        .getPackInfo({ ownerJid: context.session.ownerJid, identifier: context.packKey })
        .catch(() => originalPack);
      await sendManagedPackMutationStatus(req, res, 'noop', fresh, {
        pack_key: context.packKey,
        reason: 'duplicate_target_sticker',
        sticker_id: normalizedStickerId,
        new_sticker_id: uploadedAssetId || null,
      });
      return;
    }

    invalidateStickerCatalogDerivedCaches();
    const finalPack = await stickerPackService.getPackInfo({
      ownerJid: context.session.ownerJid,
      identifier: context.packKey,
    });
    await cleanupOrphanStickerAssets([normalizedStickerId], { reason: 'replace_sticker_old_cleanup' });
    sendJson(req, res, 200, {
      data: {
        success: true,
        status: 'updated',
        replaced_sticker_id: normalizedStickerId,
        new_sticker_id: uploadedAssetId || null,
        ...(await buildManagedPackResponseData(finalPack)),
      },
    });
  } catch (error) {
    if (error instanceof StickerPackError && error.code === STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND) {
      sendManagedMutationStatus(req, res, 'already_deleted', {
        pack_key: context.packKey,
        sticker_id: normalizedStickerId,
      });
      return;
    }
    if (uploadedAssetId) {
      await cleanupOrphanStickerAssets([uploadedAssetId], { reason: 'replace_sticker_error_recovery' }).catch(() => {});
    }
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleManagedPackAnalyticsRequest = async (req, res, packKey) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
    return;
  }
  const context = await loadOwnedPackForWebManagement(req, res, packKey);
  if (!context) return;

  try {
    const analytics = await buildManagedPackAnalytics(context.pack);
    const publishState = await buildPackPublishStateData(context.pack, { includeUploads: true });
    sendJson(req, res, 200, {
      data: {
        pack_key: context.packKey,
        analytics,
        publish_state: publishState,
      },
    });
  } catch (error) {
    const mapped = mapStickerPackWebManageError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const normalizeCreatePackName = (value) =>
  sanitizeText(value, PACK_CREATE_MAX_NAME_LENGTH, { allowEmpty: true }) || '';

const mapStickerPackCreateError = (error) => {
  if (!(error instanceof StickerPackError)) {
    return {
      statusCode: 500,
      code: STICKER_PACK_ERROR_CODES.INTERNAL_ERROR,
      message: 'Falha interna ao criar pack.',
    };
  }

  if (error.code === STICKER_PACK_ERROR_CODES.INVALID_INPUT) {
    return {
      statusCode: 400,
      code: error.code,
      message: error.message || 'Dados de entrada inválidos para criar pack.',
    };
  }

  if (error.code === STICKER_PACK_ERROR_CODES.PACK_LIMIT_REACHED) {
    return {
      statusCode: 429,
      code: error.code,
      message: error.message || 'Limite de packs atingido para este usuário.',
    };
  }

  return {
    statusCode: 400,
    code: error.code,
    message: error.message || 'Não foi possível criar o pack.',
  };
};

const handleCreatePackRequest = async (req, res) => {
  triggerStaleDraftCleanup();
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 400);
    sendJson(req, res, statusCode, { error: error?.message || 'Body inválido.' });
    return;
  }

  const name = normalizeCreatePackName(payload?.name);
  if (!name) {
    sendJson(req, res, 400, {
      error: 'Nome inválido. Informe um nome de pack (espaços e emojis são permitidos).',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  const publisher = sanitizeText(payload?.publisher || 'OmniZap Creator', PACK_CREATE_MAX_PUBLISHER_LENGTH, { allowEmpty: false });
  const description = sanitizeText(payload?.description || '', PACK_CREATE_MAX_DESCRIPTION_LENGTH, { allowEmpty: true });
  const manualTags = mergeUniqueTags(Array.isArray(payload?.tags) ? payload.tags : []).slice(0, 8);
  const persistedDescription = buildPackDescriptionWithTags(description, manualTags);
  const visibility = String(payload?.visibility || 'public').trim().toLowerCase();
  const explicitOwnerJid = toOwnerJid(payload?.owner_jid);
  const googleSession = resolveGoogleWebSessionFromRequest(req);
  let googleCreator = null;

  if (googleSession) {
    googleCreator = {
      ownerJid: googleSession.ownerJid,
      sub: googleSession.sub,
      email: googleSession.email,
      name: googleSession.name,
      picture: googleSession.picture,
    };
  } else if (STICKER_WEB_GOOGLE_AUTH_REQUIRED || payload?.google_id_token) {
    try {
      const googleClaims = await verifyGoogleIdToken(payload?.google_id_token);
      const googleOwnerJid = buildGoogleOwnerJid(googleClaims.sub);
      if (!googleOwnerJid) {
        sendJson(req, res, 400, {
          error: 'Não foi possível vincular a conta Google ao criador.',
          code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
        });
        return;
      }
      googleCreator = {
        ownerJid: googleOwnerJid,
        ...googleClaims,
      };
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 401), {
        error: error?.message || 'Login Google inválido.',
        code: STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
      });
      return;
    }
  }

  if (STICKER_WEB_GOOGLE_AUTH_REQUIRED && !googleCreator) {
    sendJson(req, res, 400, {
      error: 'Faça login com Google para criar packs nesta página.',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  const ownerJid = googleCreator?.ownerJid || explicitOwnerJid;

  if (!ownerJid) {
    sendJson(req, res, 400, {
      error: STICKER_WEB_GOOGLE_AUTH_REQUIRED
        ? 'Faça login com Google para criar packs nesta página.'
        : 'Não foi possível resolver owner_jid para criar o pack.',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  try {
    logPackWebFlow('info', 'create_pack_start', {
      owner_jid: ownerJid,
      google_sub: googleCreator?.sub || null,
      requested_visibility: visibility,
      name,
    });
    const created = await stickerPackService.createPack({
      ownerJid,
      name,
      publisher,
      description: persistedDescription,
      visibility,
      status: 'draft',
    });
    const editToken = saveWebPackEditToken({ packId: created.id, ownerJid });
    logPackWebFlow('info', 'create_pack_success', {
      owner_jid: ownerJid,
      pack_id: created.id,
      pack_key: created.pack_key,
      status: created.status || 'draft',
      visibility: created.visibility,
    });

    sendJson(req, res, 201, {
      data: mapPackSummary(created),
      meta: {
        owner_jid: ownerJid,
        edit_token: editToken,
        edit_token_expires_in_ms: PACK_WEB_EDIT_TOKEN_TTL_MS,
        google_auth: googleCreator
          ? {
              provider: 'google',
              email: googleCreator.email,
              name: googleCreator.name,
              sub: googleCreator.sub,
            }
          : null,
        limits: {
          stickers_per_pack: PACK_CREATE_MAX_ITEMS,
          packs_per_owner: PACK_CREATE_MAX_PACKS_PER_OWNER,
        },
      },
    });
  } catch (error) {
    const mapped = mapStickerPackCreateError(error);
    logPackWebFlow('warn', 'create_pack_failed', {
      owner_jid: ownerJid,
      google_sub: googleCreator?.sub || null,
      name,
      visibility,
      error: error?.message,
      error_code: error?.code,
    });
    logger.warn('Falha ao criar pack via API web.', {
      action: 'sticker_catalog_create_pack_failed',
      owner_jid: ownerJid,
      google_sub: googleCreator?.sub || null,
      name,
      visibility,
      error: error?.message,
      error_code: error?.code,
    });
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
  }
};

const handleUploadStickerToPackRequest = async (req, res, packKey) => {
  triggerStaleDraftCleanup();
  const pack = await findStickerPackByPackKey(packKey);
  if (!pack) {
    sendJson(req, res, 404, { error: 'Pack nao encontrado.', code: STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND });
    return;
  }

  let payload = {};
  try {
    payload = await readJsonBody(req, {
      maxBytes: Math.max(256 * 1024, Math.round(MAX_STICKER_SOURCE_UPLOAD_BYTES * 1.6)),
    });
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  const editToken = resolveWebPackEditToken(payload?.edit_token);
  if (!editToken || editToken.packId !== pack.id || editToken.ownerJid !== pack.owner_jid) {
    sendJson(req, res, 403, {
      error: 'Token de edição inválido para este pack.',
      code: STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
    });
    return;
  }

  const decoded = decodeStickerBase64Payload(payload?.sticker_base64 || payload?.sticker_data_url || '');
  if (!decoded?.buffer) {
    sendJson(req, res, 400, {
      error: 'Envie sticker_base64 ou sticker_data_url no payload.',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  if (decoded.buffer.length > MAX_STICKER_SOURCE_UPLOAD_BYTES) {
    sendJson(req, res, 400, {
      error: `Arquivo excede limite de ${Math.round(MAX_STICKER_SOURCE_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  const computedStickerHash = sha256Hex(decoded.buffer);
  const payloadStickerHash = normalizeStickerHashHex(payload?.sticker_hash);
  if (payloadStickerHash && payloadStickerHash !== computedStickerHash) {
    sendJson(req, res, 400, {
      error: 'sticker_hash nao corresponde ao arquivo enviado.',
      code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    });
    return;
  }

  const uploadId = normalizeWebUploadId(payload?.upload_id) || `h-${computedStickerHash.slice(0, 24)}`;
  const stickerHash = payloadStickerHash || computedStickerHash;

  logPackWebFlow('info', 'upload_start', {
    pack_key: pack.pack_key,
    pack_id: pack.id,
    owner_jid: pack.owner_jid,
    upload_id: uploadId,
    sticker_hash: stickerHash,
    source_bytes: decoded.buffer.length,
    source_mimetype: decoded.mimetype || 'image/webp',
  });

  let reservedUpload = null;
  let idempotentDoneResponse = null;
  let packStatusForResponse = normalizePackWebStatus(pack.status, 'draft');

  try {
    await runSqlTransaction(async (connection) => {
      const lockedPackRow = await lockStickerPackByPackKey(pack.pack_key, connection);
      if (!lockedPackRow) {
        throw new StickerPackError(STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND, 'Pack nao encontrado.');
      }
      if (String(lockedPackRow.id) !== String(pack.id) || String(lockedPackRow.owner_jid) !== String(pack.owner_jid)) {
        throw new StickerPackError(STICKER_PACK_ERROR_CODES.NOT_ALLOWED, 'Pack inválido para edição.');
      }

      let existingUpload = await findPackWebUploadByUploadId(pack.id, uploadId, connection);
      if (existingUpload && existingUpload.sticker_hash !== stickerHash) {
        throw new StickerPackError(
          STICKER_PACK_ERROR_CODES.INVALID_INPUT,
          'upload_id já foi usado para outro arquivo neste pack.',
        );
      }

      if (!existingUpload) {
        existingUpload = await findPackWebUploadByStickerHash(pack.id, stickerHash, connection);
      }

      const currentPackStatus = normalizePackWebStatus(lockedPackRow.status, 'draft');
      if (existingUpload?.upload_status === 'done' && existingUpload.sticker_id) {
        const snapshot = await getPackConsistencySnapshot(pack.id, lockedPackRow.cover_sticker_id, connection);
        idempotentDoneResponse = {
          data: {
            pack_key: pack.pack_key,
            sticker_id: existingUpload.sticker_id,
            sticker_count: snapshot.sticker_count,
            asset_url: buildStickerAssetUrl(pack.pack_key, existingUpload.sticker_id),
            idempotent: true,
            upload_id: existingUpload.upload_id,
            sticker_hash: existingUpload.sticker_hash,
            pack_status: currentPackStatus,
          },
        };
        return;
      }

      if (currentPackStatus === 'published') {
        throw new StickerPackError(
          STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
          'Pack já foi publicado. Crie um novo pack para enviar novos stickers.',
        );
      }

      if (currentPackStatus === 'processing') {
        throw new StickerPackError(
          STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
          'Pack está em finalização. Aguarde e tente novamente.',
        );
      }

      if (!existingUpload) {
        reservedUpload = await createPackWebUpload(
          {
            id: randomUUID(),
            pack_id: pack.id,
            upload_id: uploadId,
            sticker_hash: stickerHash,
            source_mimetype: decoded.mimetype || 'image/webp',
            upload_status: 'processing',
            attempt_count: 1,
            last_attempt_at: new Date(),
          },
          connection,
        );
      } else {
        reservedUpload = await updatePackWebUpload(
          existingUpload.id,
          {
            upload_status: 'processing',
            source_mimetype: decoded.mimetype || existingUpload.source_mimetype || 'image/webp',
            error_code: null,
            error_message: null,
            attempt_count: Math.max(1, Number(existingUpload.attempt_count || 0) + 1),
            last_attempt_at: new Date(),
          },
          connection,
        );
      }

      packStatusForResponse = currentPackStatus === 'failed' ? 'uploading' : 'uploading';
      if (currentPackStatus !== 'uploading') {
        await setStickerPackStatus(pack.id, 'uploading', connection);
        packStatusForResponse = 'uploading';
      }
    });

    if (idempotentDoneResponse) {
      logPackWebFlow('info', 'upload_success', {
        pack_key: pack.pack_key,
        pack_id: pack.id,
        owner_jid: pack.owner_jid,
        upload_id: uploadId,
        sticker_hash: stickerHash,
        idempotent: true,
      });
      sendJson(req, res, 200, idempotentDoneResponse);
      return;
    }

    const normalizedUpload = await convertUploadMediaToWebp({
      ownerJid: pack.owner_jid,
      buffer: decoded.buffer,
      mimetype: decoded.mimetype || 'image/webp',
    });
    const asset = await saveStickerAssetFromBuffer({
      ownerJid: pack.owner_jid,
      buffer: normalizedUpload.buffer,
      mimetype: normalizedUpload.mimetype || 'image/webp',
    });

    let updatedPack;
    try {
      updatedPack = await stickerPackService.addStickerToPack({
        ownerJid: pack.owner_jid,
        identifier: pack.pack_key,
        asset: { id: asset.id },
        emojis: [],
        accessibilityLabel: null,
      });
    } catch (error) {
      if (error?.code !== STICKER_PACK_ERROR_CODES.DUPLICATE_STICKER) {
        throw error;
      }
      updatedPack = await stickerPackService.getPackInfo({
        ownerJid: pack.owner_jid,
        identifier: pack.pack_key,
      });
    }

    if (payload?.set_cover === true) {
      updatedPack = await stickerPackService.setPackCover({
        ownerJid: pack.owner_jid,
        identifier: pack.pack_key,
        stickerId: asset.id,
      });
    }

    let responseStickerCount = Number(updatedPack?.sticker_count || 0);
    await runSqlTransaction(async (connection) => {
      const lockedPackRow = await lockStickerPackByPackKey(pack.pack_key, connection);
      if (!lockedPackRow) {
        throw new StickerPackError(STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND, 'Pack nao encontrado.');
      }

      const uploadRow =
        (reservedUpload?.id &&
          normalizePackWebUploadRow(
            (
              await executeQuery(
                `SELECT * FROM ${TABLES.STICKER_PACK_WEB_UPLOAD} WHERE id = ? LIMIT 1`,
                [reservedUpload.id],
                connection,
              )
            )?.[0],
          )) ||
        (await findPackWebUploadByUploadId(pack.id, uploadId, connection)) ||
        (await findPackWebUploadByStickerHash(pack.id, stickerHash, connection));

      if (!uploadRow) {
        throw new StickerPackError(STICKER_PACK_ERROR_CODES.INTERNAL_ERROR, 'Registro de upload não encontrado para finalizar.');
      }

      await updatePackWebUpload(
        uploadRow.id,
        {
          upload_status: 'done',
          sticker_id: asset.id,
          error_code: null,
          error_message: null,
          source_mimetype: decoded.mimetype || 'image/webp',
        },
        connection,
      );

      if (normalizePackWebStatus(lockedPackRow.status, 'draft') !== 'published') {
        await setStickerPackStatus(pack.id, 'uploading', connection);
        packStatusForResponse = 'uploading';
      } else {
        packStatusForResponse = 'published';
      }

      const snapshot = await getPackConsistencySnapshot(
        pack.id,
        payload?.set_cover === true ? asset.id : lockedPackRow.cover_sticker_id,
        connection,
      );
      responseStickerCount = snapshot.sticker_count;
    });

    logPackWebFlow('info', 'upload_success', {
      pack_key: pack.pack_key,
      pack_id: pack.id,
      owner_jid: pack.owner_jid,
      upload_id: uploadId,
      sticker_hash: stickerHash,
      sticker_id: asset.id,
      pack_status: packStatusForResponse,
    });

    sendJson(req, res, 201, {
      data: {
        pack_key: pack.pack_key,
        sticker_id: asset.id,
        sticker_count: responseStickerCount,
        asset_url: buildStickerAssetUrl(pack.pack_key, asset.id),
        upload_id: uploadId,
        sticker_hash: stickerHash,
        idempotent: false,
        pack_status: packStatusForResponse,
      },
    });
  } catch (error) {
    if (reservedUpload?.id) {
      await runSqlTransaction(async (connection) => {
        const currentUpload =
          (await findPackWebUploadByUploadId(pack.id, uploadId, connection)) ||
          (await findPackWebUploadByStickerHash(pack.id, stickerHash, connection));
        if (currentUpload) {
          await updatePackWebUpload(
            currentUpload.id,
            {
              upload_status: 'failed',
              error_code: String(error?.code || 'UPLOAD_FAILED').slice(0, 64),
              error_message: error?.message || 'Falha no upload do sticker.',
              source_mimetype: decoded?.mimetype || currentUpload.source_mimetype || 'image/webp',
            },
            connection,
          );
        }
        await setStickerPackStatus(pack.id, 'draft', connection);
      }).catch((updateError) => {
        logPackWebFlow('warn', 'upload_failed_mark_failed', {
          pack_key: pack.pack_key,
          pack_id: pack.id,
          upload_id: uploadId,
          sticker_hash: stickerHash,
          original_error: error?.message,
          update_error: updateError?.message,
        });
      });
    }

    logPackWebFlow('warn', 'upload_failed', {
      pack_key: pack.pack_key,
      pack_id: pack.id,
      owner_jid: pack.owner_jid,
      upload_id: uploadId,
      sticker_hash: stickerHash,
      error: error?.message,
      error_code: error?.code,
    });
    const mapped = mapStickerPackCreateError(error);
    sendJson(req, res, mapped.statusCode, {
      error: mapped.message,
      code: mapped.code,
    });
  }
};

const handlePackPublishStateRequest = async (req, res, packKey, url = null) => {
  const pack = await findStickerPackByPackKey(packKey);
  if (!pack) {
    sendJson(req, res, 404, { error: 'Pack nao encontrado.', code: STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND });
    return;
  }

  let payload = {};
  if (req.method === 'POST') {
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
      return;
    }
  }

  const editTokenValue =
    (req.method === 'GET' || req.method === 'HEAD' ? String(url?.searchParams?.get('edit_token') || '') : '') ||
    String(payload?.edit_token || '');
  const editToken = resolveWebPackEditToken(editTokenValue);
  if (!editToken || editToken.packId !== pack.id || editToken.ownerJid !== pack.owner_jid) {
    sendJson(req, res, 403, {
      error: 'Token de edição inválido para este pack.',
      code: STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
    });
    return;
  }

  const packState = await buildPackPublishStateData(pack, { includeUploads: true });
  sendJson(req, res, 200, {
    data: packState,
    pack: mapPackSummary({ ...pack, sticker_count: packState.consistency.sticker_count }),
  });
};

const handleFinalizePackRequest = async (req, res, packKey) => {
  triggerStaleDraftCleanup();

  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, Number(error?.statusCode || 400), { error: error?.message || 'Body inválido.' });
    return;
  }

  const pack = await findStickerPackByPackKey(packKey);
  if (!pack) {
    sendJson(req, res, 404, { error: 'Pack nao encontrado.', code: STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND });
    return;
  }

  const editToken = resolveWebPackEditToken(payload?.edit_token);
  if (!editToken || editToken.packId !== pack.id || editToken.ownerJid !== pack.owner_jid) {
    sendJson(req, res, 403, {
      error: 'Token de edição inválido para este pack.',
      code: STICKER_PACK_ERROR_CODES.NOT_ALLOWED,
    });
    return;
  }

  logPackWebFlow('info', 'finalize_start', {
    pack_key: pack.pack_key,
    pack_id: pack.id,
    owner_jid: pack.owner_jid,
  });

  let finalizeResult = {
    canPublish: false,
    packStatus: normalizePackWebStatus(pack.status, 'draft'),
    reason: 'unknown',
  };

  try {
    await runSqlTransaction(async (connection) => {
      const lockedPackRow = await lockStickerPackByPackKey(pack.pack_key, connection);
      if (!lockedPackRow) {
        throw new StickerPackError(STICKER_PACK_ERROR_CODES.PACK_NOT_FOUND, 'Pack nao encontrado.');
      }

      const currentStatus = normalizePackWebStatus(lockedPackRow.status, 'draft');
      if (currentStatus === 'published') {
        finalizeResult = {
          canPublish: true,
          packStatus: 'published',
          reason: 'already_published',
        };
        return;
      }

      await setStickerPackStatus(pack.id, 'processing', connection);

      const snapshot = await getPackConsistencySnapshot(pack.id, lockedPackRow.cover_sticker_id, connection);
      const canPublish =
        snapshot.sticker_count >= 1 &&
        snapshot.failed_uploads === 0 &&
        snapshot.processing_uploads === 0 &&
        snapshot.pending_uploads === 0 &&
        snapshot.cover_valid;

      if (canPublish) {
        await setStickerPackStatus(pack.id, 'published', connection);
        finalizeResult = {
          canPublish: true,
          packStatus: 'published',
          reason: 'published',
        };
        return;
      }

      await setStickerPackStatus(pack.id, 'draft', connection);
      finalizeResult = {
        canPublish: false,
        packStatus: 'draft',
        reason:
          snapshot.failed_uploads > 0
            ? 'failed_uploads'
            : snapshot.processing_uploads > 0
              ? 'uploads_processing'
              : snapshot.pending_uploads > 0
                ? 'uploads_pending'
                : !snapshot.cover_valid
                  ? 'cover_missing'
                  : snapshot.sticker_count < 1
                    ? 'not_enough_stickers'
                    : 'inconsistent',
      };
    });
  } catch (error) {
    await runSqlTransaction(async (connection) => {
      const lockedPackRow = await lockStickerPackByPackKey(pack.pack_key, connection).catch(() => null);
      if (lockedPackRow) {
        await setStickerPackStatus(pack.id, 'failed', connection);
      }
    }).catch(() => null);

    logPackWebFlow('error', 'finalize_failed', {
      pack_key: pack.pack_key,
      pack_id: pack.id,
      owner_jid: pack.owner_jid,
      error: error?.message,
      error_code: error?.code,
    });

    const mapped = mapStickerPackCreateError(error);
    sendJson(req, res, mapped.statusCode, { error: mapped.message, code: mapped.code });
    return;
  }

  const freshPack = (await findStickerPackByPackKey(pack.pack_key)) || pack;
  const packState = await buildPackPublishStateData(freshPack, { includeUploads: true });

  if (finalizeResult.canPublish) {
    logPackWebFlow('info', 'finalize_success', {
      pack_key: pack.pack_key,
      pack_id: pack.id,
      owner_jid: pack.owner_jid,
      pack_status: 'published',
      sticker_count: packState?.consistency?.sticker_count || 0,
    });

    sendJson(req, res, 200, {
      data: {
        pack: mapPackSummary({ ...freshPack, sticker_count: packState.consistency.sticker_count }),
        publish_state: packState,
      },
    });
    return;
  }

  logPackWebFlow('warn', 'finalize_failed', {
    pack_key: pack.pack_key,
    pack_id: pack.id,
    owner_jid: pack.owner_jid,
    reason: finalizeResult.reason,
    pack_status: finalizeResult.packStatus,
    consistency: packState.consistency,
  });

  sendJson(req, res, 409, {
    error: 'Pack ainda não está consistente para publicação.',
    code: STICKER_PACK_ERROR_CODES.INVALID_INPUT,
    data: {
      pack: mapPackSummary({ ...freshPack, sticker_count: packState.consistency.sticker_count }),
      publish_state: packState,
      reason: finalizeResult.reason,
    },
  });
};

const handleCreatorRankingRequest = async (req, res, url) => {
  const visibility = normalizeCatalogVisibility(url.searchParams.get('visibility'));
  const q = sanitizeText(url.searchParams.get('q') || '', 120, { allowEmpty: true }) || '';
  const limit = clampInt(url.searchParams.get('limit'), 50, 5, 200);

  const { packs } = await listStickerPacksForCatalog({
    visibility,
    search: q,
    limit: 120,
    offset: 0,
  });
  const driftSnapshot = await getMarketplaceDriftSnapshot();
  const { entries } = await hydrateMarketplaceEntries(packs, { driftSnapshot });
  const ranking = buildCreatorRanking(
    STICKER_CATALOG_ONLY_CLASSIFIED ? entries.filter((entry) => isPackClassified(entry.packClassification)) : entries,
    { limit },
  );

  sendJson(req, res, 200, {
    data: ranking.map((creator) => ({
      publisher: creator.publisher,
      verified: Boolean(creator.verified),
      badges: creator.verified ? ['verified_creator'] : [],
      stats: {
        packs_count: Number(creator.packs_count || 0),
        total_likes: Number(creator.total_likes || 0),
        total_opens: Number(creator.total_opens || 0),
        avg_pack_score: Number(creator.avg_pack_score || 0),
      },
      top_pack: creator.top_pack ? toSummaryEntry(creator.top_pack) : null,
    })),
    filters: {
      visibility,
      q,
      limit,
    },
  });
};

const handleRecommendationsRequest = async (req, res, url) => {
  const visibility = normalizeCatalogVisibility(url.searchParams.get('visibility'));
  const q = sanitizeText(url.searchParams.get('q') || '', 120, { allowEmpty: true }) || '';
  const categories = parseCategoryFilters(url.searchParams.get('categories'));
  const limit = clampInt(url.searchParams.get('limit'), 18, 4, 50);
  const viewerKey = normalizeViewerKey(url.searchParams.get('viewer_key'));

  const { packs } = await listStickerPacksForCatalog({
    visibility,
    search: q,
    limit: Math.max(limit * 4, 80),
    offset: 0,
  });
  const driftSnapshot = await getMarketplaceDriftSnapshot();
  const { entries, packClassificationById } = await hydrateMarketplaceEntries(packs, { driftSnapshot });
  const entriesClassified = STICKER_CATALOG_ONLY_CLASSIFIED
    ? entries.filter((entry) => isPackClassified(entry.packClassification))
    : entries;
  const entriesByCategory = categories.length
    ? entriesClassified.filter((entry) => hasAnyCategory(entry.packClassification?.tags || [], categories))
    : entriesClassified;

  const viewerRecentPackIds = viewerKey ? await listViewerRecentPackIds(viewerKey, { days: 45, limit: 160 }) : [];
  const viewerAffinity = buildViewerTagAffinity({
    viewerEntries: viewerRecentPackIds,
    packClassificationById,
  });
  const personalized = buildPersonalizedRecommendations({
    entries: entriesByCategory,
    viewerAffinity,
    excludePackIds: new Set(viewerRecentPackIds.map((entry) => entry.pack_id)),
    limit,
  });
  const fallback = buildIntentCollections(entriesByCategory, { limit }).em_alta;
  const result = personalized.length ? personalized : fallback;

  sendJson(req, res, 200, {
    data: result.map((entry) => toSummaryEntry(entry)),
    meta: {
      personalized: Boolean(personalized.length),
      viewer_key_present: Boolean(viewerKey),
      inferred_affinity_tags: Array.from(viewerAffinity.entries())
        .sort((left, right) => Number(right[1]) - Number(left[1]))
        .slice(0, 8)
        .map(([tag]) => tag),
    },
    filters: {
      visibility,
      q,
      categories,
      limit,
    },
  });
};

const handleOrphanStickerListRequest = async (req, res, url) => {
  const q = sanitizeText(url.searchParams.get('q') || '', 140, { allowEmpty: true }) || '';
  const categories = parseCategoryFilters(url.searchParams.get('categories'));
  const limit = clampInt(url.searchParams.get('limit'), DEFAULT_ORPHAN_LIST_LIMIT, 1, MAX_ORPHAN_LIST_LIMIT);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);

  const { assets, hasMore, total } = categories.length
    ? await listClassifiedOrphanAssetsByCategories({ search: q, categories, limit, offset })
    : await (
        STICKER_CATALOG_ONLY_CLASSIFIED ? listClassifiedStickerAssetsWithoutPack : listStickerAssetsWithoutPack
      )({
        search: q,
        limit,
        offset,
      });
  const classifications = await listStickerClassificationsByAssetIds(assets.map((asset) => asset.id));
  const byAssetId = new Map(classifications.map((entry) => [entry.asset_id, entry]));
  const filteredAssets = STICKER_CATALOG_ONLY_CLASSIFIED
    ? assets.filter((asset) => isStickerClassified(byAssetId.get(asset.id)))
    : assets;
  const filteredByCategories = categories.length
    ? filteredAssets.filter((asset) => hasAnyCategory(resolveClassificationTags(byAssetId.get(asset.id)), categories))
    : filteredAssets;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  sendJson(req, res, 200, {
    data: filteredByCategories.map((asset) => mapOrphanStickerAsset(asset, byAssetId.get(asset.id) || null)),
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
      categories,
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

const handleSupportInfoRequest = async (req, res) => {
  const data = await buildSupportInfo();
  if (!data) {
    sendJson(req, res, 404, { error: 'Contato de suporte indisponível.' });
    return;
  }
  sendJson(req, res, 200, { data });
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

const handleDetailsRequest = async (req, res, packKey, url) => {
  const normalizedPackKey = sanitizeText(packKey, 160, { allowEmpty: false });
  const categories = parseCategoryFilters(url.searchParams.get('categories'));
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
  const stickerIds = items.map((item) => item.sticker_id);
  const [classifications, packClassification, engagement] = await Promise.all([
    listStickerClassificationsByAssetIds(stickerIds),
    getPackClassificationSummaryByAssetIds(stickerIds),
    getStickerPackEngagementByPackId(pack.id),
  ]);
  const interactionStatsByPack = await listStickerPackInteractionStatsByPackIds([pack.id]);
  const driftSnapshot = await getMarketplaceDriftSnapshot();
  const byAssetClassification = new Map(classifications.map((entry) => [entry.asset_id, entry]));
  const orderedClassifications = stickerIds.map((stickerId) => byAssetClassification.get(stickerId)).filter(Boolean);
  const signals = computePackSignals({
    pack: { ...pack, items },
    engagement,
    packClassification,
    itemClassifications: orderedClassifications,
    interactionStats: interactionStatsByPack.get(pack.id) || null,
    scoringWeights: driftSnapshot.weights,
  });
  const visibleItems = STICKER_CATALOG_ONLY_CLASSIFIED
    ? items.filter((item) => isStickerClassified(byAssetClassification.get(item.sticker_id)))
    : items;
  const visibleItemsByCategories = categories.length
    ? visibleItems.filter((item) => hasAnyCategory(resolveClassificationTags(byAssetClassification.get(item.sticker_id)), categories))
    : visibleItems;

  if (STICKER_CATALOG_ONLY_CLASSIFIED && !isPackClassified(packClassification)) {
    sendJson(req, res, 404, { error: 'Pack nao encontrado.' });
    return;
  }

  sendJson(req, res, 200, {
    data: mapPackDetails(pack, visibleItemsByCategories, { byAssetClassification, packClassification, engagement, signals }),
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
    const classification = await findStickerClassificationByAssetId(normalizedStickerId).catch(() => null);
    if (STICKER_CATALOG_ONLY_CLASSIFIED && !isStickerClassified(classification)) {
      sendJson(req, res, 404, { error: 'Sticker nao encontrado.' });
      return;
    }
    if (classification) {
      const decorated = decorateStickerClassification(classification);
      res.setHeader('X-Sticker-Category', String(decorated?.category || 'unknown'));
      res.setHeader('X-Sticker-NSFW', decorated?.is_nsfw ? '1' : '0');
      if (Array.isArray(decorated?.tags) && decorated.tags.length) {
        res.setHeader('X-Sticker-Tags', decorated.tags.join(','));
      }
    }
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

const findPublicPackByKey = async (rawPackKey) => {
  const normalizedPackKey = sanitizeText(rawPackKey, 160, { allowEmpty: false });
  if (!normalizedPackKey) return null;
  const pack = await findStickerPackByPackKey(normalizedPackKey);
  if (!pack || !isPackPubliclyVisible(pack)) return null;
  return pack;
};

const handlePackInteractionRequest = async (req, res, packKey, interaction, url) => {
  const pack = await findPublicPackByKey(packKey);
  if (!pack) {
    sendJson(req, res, 404, { error: 'Pack nao encontrado.' });
    return;
  }

  let engagement = getEmptyStickerPackEngagement();
  if (interaction === 'open') {
    engagement = await incrementStickerPackOpen(pack.id);
  } else if (interaction === 'like') {
    engagement = await incrementStickerPackLike(pack.id);
  } else if (interaction === 'dislike') {
    engagement = await incrementStickerPackDislike(pack.id);
  } else {
    sendJson(req, res, 400, { error: 'Interacao invalida.' });
    return;
  }

  const actor = resolveActorKeysFromRequest(req, url);
  await createStickerPackInteractionEvent({
    packId: pack.id,
    interaction,
    actorKey: actor.actorKey,
    sessionKey: actor.sessionKey,
    source: actor.source,
  }).catch(() => null);

  sendJson(req, res, 200, {
    data: {
      pack_key: pack.pack_key,
      interaction,
      engagement: {
        open_count: Number(engagement.open_count || 0),
        like_count: Number(engagement.like_count || 0),
        dislike_count: Number(engagement.dislike_count || 0),
        score: Number(engagement.score || 0),
        updated_at: toIsoOrNull(engagement.updated_at),
      },
    },
  });
};

const handleCatalogApiRequest = async (req, res, pathname, url) => {
  if (pathname === `${STICKER_API_BASE_PATH}/create`) {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleCreatePackRequest(req, res);
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/auth/google/session`) {
    await handleGoogleAuthSessionRequest(req, res);
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/me`) {
    await handleMyProfileRequest(req, res);
    return true;
  }

  if (pathname === STICKER_API_BASE_PATH) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleListRequest(req, res, url);
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/intents`) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleIntentCollectionsRequest(req, res, url);
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/creators`) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleCreatorRankingRequest(req, res, url);
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/recommendations`) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleRecommendationsRequest(req, res, url);
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/stats`) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleMarketplaceStatsRequest(req, res, url);
    return true;
  }

  if (pathname === `${STICKER_API_BASE_PATH}/create-config`) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleCreatePackConfigRequest(req, res);
    return true;
  }

  if (pathname === STICKER_ORPHAN_API_PATH) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
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
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleDataFileListRequest(req, res, url);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'system-summary') {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleSystemSummaryRequest(req, res);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'project-summary') {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleGitHubProjectSummaryRequest(req, res);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'global-ranking-summary') {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleGlobalRankingSummaryRequest(req, res);
    return true;
  }

  if (segments.length === 1 && segments[0] === 'support') {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleSupportInfoRequest(req, res);
    return true;
  }

  if (segments.length === 1) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleDetailsRequest(req, res, segments[0], url);
    return true;
  }

  if (segments.length === 2 && ['open', 'like', 'dislike'].includes(segments[1])) {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handlePackInteractionRequest(req, res, segments[0], segments[1], url);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'manage') {
    await handleManagedPackRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'clone') {
    await handleManagedPackCloneRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'cover') {
    await handleManagedPackCoverRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'reorder') {
    await handleManagedPackReorderRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'analytics') {
    await handleManagedPackAnalyticsRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'stickers') {
    await handleManagedPackStickerCreateRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 4 && segments[1] === 'manage' && segments[2] === 'stickers') {
    await handleManagedPackStickerDeleteRequest(req, res, segments[0], segments[3]);
    return true;
  }

  if (segments.length === 5 && segments[1] === 'manage' && segments[2] === 'stickers' && segments[4] === 'replace') {
    await handleManagedPackStickerReplaceRequest(req, res, segments[0], segments[3]);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'publish-state') {
    if (!['GET', 'HEAD', 'POST'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handlePackPublishStateRequest(req, res, segments[0], url);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'finalize') {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleFinalizePackRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 2 && segments[1] === 'stickers-upload') {
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleUploadStickerToPackRequest(req, res, segments[0]);
    return true;
  }

  if (segments.length === 3 && segments[1] === 'stickers') {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      sendJson(req, res, 405, { error: 'Metodo nao permitido.' });
      return true;
    }
    await handleAssetRequest(req, res, segments[0], segments[2]);
    return true;
  }

  sendJson(req, res, 404, { error: 'Rota de sticker pack nao encontrada.' });
  return true;
};

const handleCatalogPageRequest = async (req, res, pathname) => {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalizedPath === STICKER_CREATE_WEB_PATH) {
    try {
      const html = await renderCreatePackHtml();
      sendText(req, res, 200, html, 'text/html; charset=utf-8');
      return;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        sendJson(req, res, 404, { error: 'Template da criacao de packs nao encontrado.' });
        return;
      }
      logger.error('Falha ao renderizar pagina de criacao de packs.', {
        action: 'sticker_catalog_create_page_render_failed',
        path: pathname,
        error: error?.message,
      });
      sendJson(req, res, 500, { error: 'Falha interna ao renderizar criacao de packs.' });
      return;
    }
  }

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
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return false;

  if (hasPathPrefix(pathname, STICKER_DATA_PUBLIC_PATH)) {
    if (!['GET', 'HEAD'].includes(req.method || '')) return false;
    return handlePublicDataAssetRequest(req, res, pathname);
  }

  if (hasPathPrefix(pathname, STICKER_WEB_PATH)) {
    if (!['GET', 'HEAD'].includes(req.method || '')) return false;
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
