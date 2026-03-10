import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeBasePath, sendAsset, sendJson } from '../../http/httpRequestUtils.js';
import logger from '#logger';

const STICKER_DATA_PUBLIC_PATH = normalizeBasePath(process.env.STICKER_DATA_PUBLIC_PATH, '/data');
const STICKER_DATA_PUBLIC_DIR = path.resolve(process.env.STICKER_DATA_PUBLIC_DIR || path.join(process.cwd(), 'data'));
const MAX_DATA_SCAN_FILES = Number(process.env.STICKER_DATA_SCAN_MAX_FILES || 10000);
const DATA_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp']);

const normalizeRelativePath = (value) =>
  String(value || '')
    .split(path.sep)
    .join('/')
    .replace(/^\/+/, '');

const isAllowedDataImageFile = (filePath) => DATA_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const isInsideDataPublicRoot = (targetPath) => targetPath === STICKER_DATA_PUBLIC_DIR || targetPath.startsWith(`${STICKER_DATA_PUBLIC_DIR}${path.sep}`);

const buildDataAssetUrl = (relativePath) =>
  `${STICKER_DATA_PUBLIC_PATH}/${String(relativePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;

export const toPublicDataUrlFromStoragePath = (storagePath) => {
  if (!storagePath) return null;
  const absolutePath = path.resolve(String(storagePath));
  if (!isInsideDataPublicRoot(absolutePath)) return null;

  const relativePath = normalizeRelativePath(path.relative(STICKER_DATA_PUBLIC_DIR, absolutePath));
  if (!relativePath || relativePath.startsWith('..')) return null;
  return buildDataAssetUrl(relativePath);
};

export const toImageMimeType = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.avif') return 'image/avif';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/webp';
};

export const listDataImageFiles = async () => {
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

export const handlePublicDataAssetRequest = async (req, res, pathname) => {
  const suffix = pathname.slice(STICKER_DATA_PUBLIC_PATH.length).replace(/^\/+/, '');
  if (!suffix) {
    sendJson(req, res, 400, {
      error: 'Informe o caminho do arquivo. Exemplo: /data/stickers/arquivo.webp',
    });
    return true;
  }

  const decodedSegments = suffix
    .split('/')
    .filter(Boolean)
    .map((segment) => {
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
    return false;
  }
};
