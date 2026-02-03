import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import logger from '../../utils/logger/loggerModule.js';
import { downloadMediaMessage, extractMediaDetails } from '../../config/baileysConfig.js';
import {
  createStickerAsset,
  findLatestStickerAssetByOwner,
  findStickerAssetById,
  findStickerAssetBySha256,
  updateStickerAssetStoragePath,
} from './stickerAssetRepository.js';
import { STICKER_PACK_ERROR_CODES, StickerPackError } from './stickerPackErrors.js';
import { normalizeOwnerJid } from './stickerPackUtils.js';

const STORAGE_ROOT = path.resolve(process.env.STICKER_STORAGE_DIR || path.join(process.cwd(), 'data', 'stickers'));
const TEMP_ROOT = path.join(process.cwd(), 'temp', 'sticker-pack-assets');
const DEFAULT_MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_STICKER_BYTES = Math.max(64 * 1024, Number(process.env.STICKER_PACK_MAX_STICKER_BYTES) || DEFAULT_MAX_STICKER_BYTES);
const LAST_STICKER_TTL_MS = Math.max(60_000, Number(process.env.STICKER_PACK_LAST_CACHE_TTL_MS) || 6 * 60 * 60 * 1000);

const lastStickerCache = new Map();

const safeOwnerToken = (ownerJid) => {
  const normalized = normalizeOwnerJid(ownerJid);
  const token = String(normalized || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return token || 'unknown';
};

const buildStoragePath = (ownerJid, sha256) => path.join(STORAGE_ROOT, safeOwnerToken(ownerJid), `${sha256}.webp`);

const fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const isLikelyWebp = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
  return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
};

const detectAnimatedWebp = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return false;
  return buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF'));
};

const parseWebpDimensions = (buffer) => {
  if (!isLikelyWebp(buffer)) return { width: null, height: null };

  const chunk = buffer.subarray(12, 16).toString('ascii');

  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }

  if (chunk === 'VP8 ' && buffer.length >= 30) {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return {
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
    };
  }

  if (chunk === 'VP8L' && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];

    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));

    return {
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
    };
  }

  return { width: null, height: null };
};

const rememberLastSticker = (ownerJid, assetId) => {
  if (!ownerJid || !assetId) return;

  const normalized = normalizeOwnerJid(ownerJid);
  lastStickerCache.set(normalized, {
    assetId,
    expiresAt: Date.now() + LAST_STICKER_TTL_MS,
  });
};

const resolveLastStickerAssetId = (ownerJid) => {
  const normalized = normalizeOwnerJid(ownerJid);
  const entry = lastStickerCache.get(normalized);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    lastStickerCache.delete(normalized);
    return null;
  }

  return entry.assetId;
};

const computeSha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const ensureStorageForAsset = async ({ ownerJid, sha256, buffer }) => {
  const targetPath = buildStoragePath(ownerJid, sha256);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (!(await fileExists(targetPath))) {
    await fs.writeFile(targetPath, buffer);
  }

  return targetPath;
};

const resolveStickerMediaDetails = (messageInfo, { includeQuoted = true } = {}) => {
  const mediaDetails = extractMediaDetails(messageInfo, { includeQuoted });
  if (!mediaDetails || mediaDetails.mediaType !== 'sticker') {
    return null;
  }

  return mediaDetails;
};

async function persistStickerAssetFromDetails({ mediaDetails, ownerJid }) {
  const normalizedOwner = normalizeOwnerJid(ownerJid);
  const mediaSize = Number(mediaDetails?.details?.fileLength || mediaDetails?.mediaKey?.fileLength || 0);

  if (mediaSize > MAX_STICKER_BYTES) {
    throw new StickerPackError(
      STICKER_PACK_ERROR_CODES.INVALID_INPUT,
      `Figurinha excede o limite de ${(MAX_STICKER_BYTES / (1024 * 1024)).toFixed(1)} MB.`,
    );
  }

  const tempOwnerDir = path.join(TEMP_ROOT, safeOwnerToken(normalizedOwner));
  await fs.mkdir(tempOwnerDir, { recursive: true });

  let downloadedPath = null;

  try {
    downloadedPath = await downloadMediaMessage(mediaDetails.mediaKey, 'sticker', tempOwnerDir);
    if (!downloadedPath) {
      throw new StickerPackError(
        STICKER_PACK_ERROR_CODES.STORAGE_ERROR,
        'Não foi possível baixar a figurinha para armazenamento.',
      );
    }

    const buffer = await fs.readFile(downloadedPath);
    if (!buffer.length) {
      throw new StickerPackError(STICKER_PACK_ERROR_CODES.STORAGE_ERROR, 'Arquivo da figurinha veio vazio.');
    }

    if (buffer.length > MAX_STICKER_BYTES) {
      throw new StickerPackError(
        STICKER_PACK_ERROR_CODES.INVALID_INPUT,
        `Figurinha excede o limite de ${(MAX_STICKER_BYTES / (1024 * 1024)).toFixed(1)} MB.`,
      );
    }

    if (!isLikelyWebp(buffer)) {
      throw new StickerPackError(
        STICKER_PACK_ERROR_CODES.INVALID_INPUT,
        'A mídia precisa estar no formato WEBP para entrar no pack.',
      );
    }

    const sha256 = computeSha256(buffer);
    const existing = await findStickerAssetBySha256(sha256);

    if (existing) {
      const existingPathOk = existing.storage_path ? await fileExists(existing.storage_path) : false;

      if (!existingPathOk) {
        const fixedPath = await ensureStorageForAsset({ ownerJid: normalizedOwner, sha256, buffer });
        const repaired = await updateStickerAssetStoragePath(existing.id, fixedPath);
        rememberLastSticker(normalizedOwner, repaired.id);
        return repaired;
      }

      rememberLastSticker(normalizedOwner, existing.id);
      return existing;
    }

    const storagePath = await ensureStorageForAsset({ ownerJid: normalizedOwner, sha256, buffer });
    const { width, height } = parseWebpDimensions(buffer);

    try {
      const created = await createStickerAsset({
        id: randomUUID(),
        owner_jid: normalizedOwner,
        sha256,
        mimetype: mediaDetails?.details?.mimetype || 'image/webp',
        is_animated: detectAnimatedWebp(buffer),
        width,
        height,
        size_bytes: buffer.length,
        storage_path: storagePath,
      });

      rememberLastSticker(normalizedOwner, created.id);
      return created;
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        const duplicated = await findStickerAssetBySha256(sha256);
        if (duplicated) {
          rememberLastSticker(normalizedOwner, duplicated.id);
          return duplicated;
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof StickerPackError) {
      throw error;
    }

    logger.error('Falha ao persistir figurinha no storage local.', {
      action: 'sticker_asset_store_failed',
      owner_jid: normalizedOwner,
      error: error.message,
    });
    throw new StickerPackError(
      STICKER_PACK_ERROR_CODES.STORAGE_ERROR,
      'Falha ao salvar figurinha no servidor.',
      error,
    );
  } finally {
    if (downloadedPath) {
      await fs.unlink(downloadedPath).catch(() => {});
    }
  }
}

export async function saveStickerAssetFromMessage({ messageInfo, ownerJid, includeQuoted = true }) {
  const mediaDetails = resolveStickerMediaDetails(messageInfo, { includeQuoted });
  if (!mediaDetails) return null;

  return persistStickerAssetFromDetails({ mediaDetails, ownerJid });
}

export async function captureIncomingStickerAsset({ messageInfo, ownerJid }) {
  return saveStickerAssetFromMessage({ messageInfo, ownerJid, includeQuoted: false });
}

export async function getLastStickerAssetForOwner(ownerJid) {
  const normalizedOwner = normalizeOwnerJid(ownerJid);
  const cachedAssetId = resolveLastStickerAssetId(normalizedOwner);

  if (cachedAssetId) {
    const cachedAsset = await findStickerAssetById(cachedAssetId);
    if (cachedAsset) return cachedAsset;
  }

  const latest = await findLatestStickerAssetByOwner(normalizedOwner);
  if (latest) {
    rememberLastSticker(normalizedOwner, latest.id);
  }
  return latest;
}

export async function resolveStickerAssetForCommand({
  messageInfo,
  ownerJid,
  includeQuoted = true,
  fallbackToLast = true,
}) {
  const mediaDetails = resolveStickerMediaDetails(messageInfo, { includeQuoted });

  if (mediaDetails) {
    return persistStickerAssetFromDetails({ mediaDetails, ownerJid });
  }

  if (!fallbackToLast) {
    return null;
  }

  return getLastStickerAssetForOwner(ownerJid);
}

export async function readStickerAssetBuffer(asset) {
  if (!asset?.storage_path) {
    throw new StickerPackError(STICKER_PACK_ERROR_CODES.STORAGE_ERROR, 'Caminho do sticker não encontrado no storage.');
  }

  try {
    return await fs.readFile(asset.storage_path);
  } catch (error) {
    throw new StickerPackError(
      STICKER_PACK_ERROR_CODES.STORAGE_ERROR,
      `Não foi possível ler a figurinha em disco (${asset.storage_path}).`,
      error,
    );
  }
}

export function getStickerStorageConfig() {
  return {
    storageRoot: STORAGE_ROOT,
    maxStickerBytes: MAX_STICKER_BYTES,
  };
}
