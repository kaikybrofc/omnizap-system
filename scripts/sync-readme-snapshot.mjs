#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const START_MARKER = '<!-- README_SNAPSHOT:START -->';
const END_MARKER = '<!-- README_SNAPSHOT:END -->';
const DEFAULT_README_TARGET = 'README.md';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 500_000;

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLocalHostname = (hostname) => ['localhost', '127.0.0.1', '::1'].includes(String(hostname || '').toLowerCase());
const toPositiveInt = (value, fallback, min = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
};
const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};
const ensurePathWithinRoot = (rootPath, targetPath) => {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Caminho fora do projeto não permitido: ${targetPath}`);
  }
};

const readmePath = path.resolve(projectRoot, process.env.README_SNAPSHOT_TARGET_PATH || DEFAULT_README_TARGET);
ensurePathWithinRoot(projectRoot, readmePath);

const siteOrigin = String(process.env.SITE_ORIGIN || 'https://omnizap.shop')
  .trim()
  .replace(/\/+$/, '');
const sourceUrlRaw = String(process.env.README_SNAPSHOT_SOURCE_URL || `${siteOrigin}/api/readme-markdown`).trim();
const timeoutMs = Math.max(1000, toPositiveInt(process.env.README_SNAPSHOT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000));
const maxBytes = Math.max(1024, toPositiveInt(process.env.README_SNAPSHOT_MAX_BYTES, DEFAULT_MAX_BYTES, 1024));
const allowExternalSource = toBool(process.env.README_SNAPSHOT_ALLOW_EXTERNAL_SOURCE, false);

const resolveSourceUrl = (candidateUrl, trustedSiteOrigin, allowExternal) => {
  let trusted;
  let source;
  try {
    trusted = new URL(trustedSiteOrigin);
    source = new URL(candidateUrl);
  } catch {
    throw new Error('SITE_ORIGIN ou README_SNAPSHOT_SOURCE_URL inválido.');
  }

  if (source.protocol !== 'https:' && !isLocalHostname(source.hostname)) {
    throw new Error(`README_SNAPSHOT_SOURCE_URL deve usar HTTPS (ou localhost): ${source.origin}`);
  }

  if (!allowExternal && source.origin !== trusted.origin) {
    throw new Error(`README_SNAPSHOT_SOURCE_URL fora do domínio confiável (${trusted.origin}). Defina README_SNAPSHOT_ALLOW_EXTERNAL_SOURCE=1 para liberar.`);
  }

  return source.toString();
};

const sourceUrl = resolveSourceUrl(sourceUrlRaw, siteOrigin, allowExternalSource);

const fetchWithTimeout = async (url, timeout, maxContentBytes) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'omnizap-readme-sync/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ao buscar snapshot`);
    }
    const content = String(await response.text()).trim();
    if (!content) {
      throw new Error('Snapshot markdown vazio');
    }
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > maxContentBytes) {
      throw new Error(`Snapshot excede limite de ${maxContentBytes} bytes.`);
    }
    if (content.includes(START_MARKER) || content.includes(END_MARKER)) {
      throw new Error('Snapshot não pode conter os marcadores START/END.');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
};

const syncReadmeSnapshot = async () => {
  const markdown = await fetchWithTimeout(sourceUrl, timeoutMs, maxBytes);
  const readme = await fs.readFile(readmePath, 'utf8');

  const blockRegex = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`, 'm');
  if (!blockRegex.test(readme)) {
    throw new Error(`Marcadores não encontrados em ${path.relative(projectRoot, readmePath)} (${START_MARKER} ... ${END_MARKER})`);
  }

  const replacement = `${START_MARKER}\n${markdown}\n${END_MARKER}`;
  const nextReadme = readme.replace(blockRegex, replacement);

  if (nextReadme === readme) {
    console.log('[readme-sync] Snapshot já está atualizado.');
    return;
  }

  const tempPath = `${readmePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    // lgtm[js/http-to-file-access]
    await fs.writeFile(tempPath, nextReadme, 'utf8');
    await fs.rename(tempPath, readmePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  console.log(`[readme-sync] README atualizado com snapshot de ${sourceUrl}`);
};

syncReadmeSnapshot().catch((error) => {
  console.error(`[readme-sync] Falha: ${error?.message || error}`);
  process.exit(1);
});
