import path from 'node:path';

import logger from '../../utils/logger/loggerModule.js';
import { normalizeOwnerJid } from './stickerPackUtils.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const OBJECT_STORAGE_ENABLED = parseEnvBool(process.env.STICKER_OBJECT_STORAGE_ENABLED, false);
const OBJECT_STORAGE_UPLOAD_ON_WRITE = parseEnvBool(process.env.STICKER_OBJECT_STORAGE_UPLOAD_ON_WRITE, true);
const OBJECT_STORAGE_SIGNED_URL_ENABLED = parseEnvBool(process.env.STICKER_OBJECT_STORAGE_SIGNED_URL_ENABLED, true);
const OBJECT_STORAGE_PROVIDER = String(process.env.STICKER_OBJECT_STORAGE_PROVIDER || 's3').trim().toLowerCase();
const OBJECT_STORAGE_BUCKET = String(process.env.STICKER_OBJECT_STORAGE_BUCKET || '').trim();
const OBJECT_STORAGE_REGION = String(process.env.STICKER_OBJECT_STORAGE_REGION || 'us-east-1').trim() || 'us-east-1';
const OBJECT_STORAGE_ENDPOINT = String(process.env.STICKER_OBJECT_STORAGE_ENDPOINT || '').trim();
const OBJECT_STORAGE_ACCESS_KEY_ID = String(process.env.STICKER_OBJECT_STORAGE_ACCESS_KEY_ID || '').trim();
const OBJECT_STORAGE_SECRET_ACCESS_KEY = String(process.env.STICKER_OBJECT_STORAGE_SECRET_ACCESS_KEY || '').trim();
const OBJECT_STORAGE_FORCE_PATH_STYLE = parseEnvBool(process.env.STICKER_OBJECT_STORAGE_FORCE_PATH_STYLE, true);
const OBJECT_STORAGE_CDN_BASE_URL = String(process.env.STICKER_OBJECT_STORAGE_CDN_BASE_URL || '').trim().replace(/\/+$/, '');
const OBJECT_STORAGE_KEY_PREFIX = String(process.env.STICKER_OBJECT_STORAGE_KEY_PREFIX || 'stickers').trim().replace(/^\/+|\/+$/g, '') || 'stickers';

let sdkLoadState = {
  loaded: false,
  warned: false,
  S3Client: null,
  PutObjectCommand: null,
  GetObjectCommand: null,
  getSignedUrl: null,
};
let s3Client = null;

const safeOwnerToken = (ownerJid) => {
  const normalized = normalizeOwnerJid(ownerJid);
  const token = String(normalized || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return token || 'unknown';
};

const encodePathSegments = (value) =>
  String(value || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const parseS3StoragePath = (storagePath) => {
  const raw = String(storagePath || '').trim();
  if (!raw.startsWith('s3://')) return null;
  const withoutScheme = raw.slice('s3://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex < 0) return null;
  const bucket = withoutScheme.slice(0, slashIndex).trim();
  const key = withoutScheme.slice(slashIndex + 1).trim();
  if (!bucket || !key) return null;
  return { bucket, key };
};

const resolveStickerObjectKey = (asset) => {
  const fromStoragePath = parseS3StoragePath(asset?.storage_path);
  if (fromStoragePath?.key) return fromStoragePath.key;
  const ownerToken = safeOwnerToken(asset?.owner_jid || 'unknown');
  const sha256 = String(asset?.sha256 || '').trim().toLowerCase();
  if (!sha256) return '';
  return `${OBJECT_STORAGE_KEY_PREFIX}/${ownerToken}/${sha256}.webp`;
};

const loadAwsSdk = async () => {
  if (sdkLoadState.loaded) return sdkLoadState;
  try {
    const [{ S3Client, PutObjectCommand, GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    sdkLoadState = {
      loaded: true,
      warned: false,
      S3Client,
      PutObjectCommand,
      GetObjectCommand,
      getSignedUrl,
    };
  } catch (error) {
    if (!sdkLoadState.warned) {
      sdkLoadState.warned = true;
      logger.warn('SDK AWS não disponível para object storage. Mantendo fallback local.', {
        action: 'sticker_object_storage_sdk_unavailable',
        error: error?.message,
      });
    }
    sdkLoadState = {
      ...sdkLoadState,
      loaded: true,
    };
  }
  return sdkLoadState;
};

const getS3Client = async () => {
  if (!OBJECT_STORAGE_ENABLED || OBJECT_STORAGE_PROVIDER !== 's3') return null;
  if (!OBJECT_STORAGE_BUCKET) return null;
  if (s3Client) return s3Client;

  const sdk = await loadAwsSdk();
  if (!sdk?.S3Client) return null;

  s3Client = new sdk.S3Client({
    region: OBJECT_STORAGE_REGION,
    endpoint: OBJECT_STORAGE_ENDPOINT || undefined,
    forcePathStyle: OBJECT_STORAGE_FORCE_PATH_STYLE,
    credentials:
      OBJECT_STORAGE_ACCESS_KEY_ID && OBJECT_STORAGE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: OBJECT_STORAGE_ACCESS_KEY_ID,
            secretAccessKey: OBJECT_STORAGE_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return s3Client;
};

const streamToBuffer = async (body) => {
  if (!body) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body?.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }
  if (typeof body?.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  if (typeof body?.on === 'function') {
    const chunks = [];
    return await new Promise((resolve, reject) => {
      body.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      body.on('end', () => resolve(Buffer.concat(chunks)));
      body.on('error', reject);
    });
  }
  return null;
};

export const isStickerObjectStorageEnabled = () =>
  Boolean(OBJECT_STORAGE_ENABLED && OBJECT_STORAGE_PROVIDER === 's3' && OBJECT_STORAGE_BUCKET);

export const uploadStickerToObjectStorage = async ({
  ownerJid,
  sha256,
  buffer,
  mimetype = 'image/webp',
} = {}) => {
  if (!OBJECT_STORAGE_UPLOAD_ON_WRITE || !Buffer.isBuffer(buffer) || !buffer.length) {
    return { uploaded: false, key: null };
  }
  if (!isStickerObjectStorageEnabled()) {
    return { uploaded: false, key: null };
  }

  const key = `${OBJECT_STORAGE_KEY_PREFIX}/${safeOwnerToken(ownerJid)}/${String(sha256 || '').trim().toLowerCase()}.webp`;
  if (!key || key.endsWith('/.webp')) return { uploaded: false, key: null };

  try {
    const client = await getS3Client();
    const sdk = await loadAwsSdk();
    if (!client || !sdk?.PutObjectCommand) return { uploaded: false, key: null };

    await client.send(
      new sdk.PutObjectCommand({
        Bucket: OBJECT_STORAGE_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimetype || 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return { uploaded: true, key };
  } catch (error) {
    logger.warn('Falha ao enviar sticker para object storage.', {
      action: 'sticker_object_storage_upload_failed',
      owner_jid: ownerJid || null,
      error: error?.message,
    });
    return { uploaded: false, key: null };
  }
};

export const getStickerObjectStorageUrl = async (
  asset,
  {
    secure = true,
    expiresInSeconds = 300,
  } = {},
) => {
  if (!isStickerObjectStorageEnabled()) return null;

  const key = resolveStickerObjectKey(asset);
  if (!key) return null;

  if (OBJECT_STORAGE_CDN_BASE_URL) {
    if (!secure) {
      return `${OBJECT_STORAGE_CDN_BASE_URL}/${encodePathSegments(key)}`;
    }
    if (!OBJECT_STORAGE_SIGNED_URL_ENABLED) {
      return `${OBJECT_STORAGE_CDN_BASE_URL}/${encodePathSegments(key)}`;
    }
  }

  if (!secure || !OBJECT_STORAGE_SIGNED_URL_ENABLED) {
    if (OBJECT_STORAGE_CDN_BASE_URL) {
      return `${OBJECT_STORAGE_CDN_BASE_URL}/${encodePathSegments(key)}`;
    }
    if (OBJECT_STORAGE_ENDPOINT) {
      const base = OBJECT_STORAGE_ENDPOINT.replace(/\/+$/, '');
      return `${base}/${encodeURIComponent(OBJECT_STORAGE_BUCKET)}/${encodePathSegments(key)}`;
    }
    return null;
  }

  const client = await getS3Client();
  const sdk = await loadAwsSdk();
  if (!client || !sdk?.GetObjectCommand || typeof sdk?.getSignedUrl !== 'function') return null;

  try {
    const command = new sdk.GetObjectCommand({
      Bucket: OBJECT_STORAGE_BUCKET,
      Key: key,
    });
    return await sdk.getSignedUrl(client, command, {
      expiresIn: Math.max(30, Math.min(3600 * 6, Number(expiresInSeconds) || 300)),
    });
  } catch (error) {
    logger.warn('Falha ao gerar URL segura do object storage.', {
      action: 'sticker_object_storage_signed_url_failed',
      key,
      error: error?.message,
    });
    return null;
  }
};

export const readStickerFromObjectStorage = async (asset) => {
  if (!isStickerObjectStorageEnabled()) return null;
  const key = resolveStickerObjectKey(asset);
  if (!key) return null;

  try {
    const client = await getS3Client();
    const sdk = await loadAwsSdk();
    if (!client || !sdk?.GetObjectCommand) return null;

    const response = await client.send(
      new sdk.GetObjectCommand({
        Bucket: OBJECT_STORAGE_BUCKET,
        Key: key,
      }),
    );
    return await streamToBuffer(response?.Body);
  } catch (error) {
    logger.warn('Falha ao ler sticker no object storage.', {
      action: 'sticker_object_storage_read_failed',
      storage_path: asset?.storage_path || null,
      error: error?.message,
    });
    return null;
  }
};

export const toStickerStoragePath = ({ localPath, ownerJid, sha256 }) => {
  const normalizedLocalPath = path.resolve(String(localPath || ''));
  if (!isStickerObjectStorageEnabled()) return normalizedLocalPath;
  if (!OBJECT_STORAGE_UPLOAD_ON_WRITE) return normalizedLocalPath;
  const key = `${OBJECT_STORAGE_KEY_PREFIX}/${safeOwnerToken(ownerJid)}/${String(sha256 || '').trim().toLowerCase()}.webp`;
  if (!key || key.endsWith('/.webp')) return normalizedLocalPath;
  return `s3://${OBJECT_STORAGE_BUCKET}/${key}`;
};
