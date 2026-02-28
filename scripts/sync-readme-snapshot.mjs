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

const readmePath = path.resolve(projectRoot, process.env.README_SNAPSHOT_TARGET_PATH || 'README.md');
const siteOrigin = String(process.env.SITE_ORIGIN || 'https://omnizap.shop')
  .trim()
  .replace(/\/+$/, '');
const sourceUrl = String(process.env.README_SNAPSHOT_SOURCE_URL || `${siteOrigin}/api/sticker-packs/readme-markdown`).trim();
const timeoutMs = Math.max(1000, Number(process.env.README_SNAPSHOT_TIMEOUT_MS) || 15000);

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const fetchWithTimeout = async (url, timeout) => {
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
    return content;
  } finally {
    clearTimeout(timer);
  }
};

const syncReadmeSnapshot = async () => {
  const markdown = await fetchWithTimeout(sourceUrl, timeoutMs);
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

  await fs.writeFile(readmePath, nextReadme, 'utf8');
  console.log(`[readme-sync] README atualizado com snapshot de ${sourceUrl}`);
};

syncReadmeSnapshot().catch((error) => {
  console.error(`[readme-sync] Falha: ${error?.message || error}`);
  process.exit(1);
});
