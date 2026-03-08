#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const modulesRoot = path.join(repoRoot, 'app', 'modules');

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s/_.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ensureStringArray = (value) =>
  Array.isArray(value) ? value.map((item) => String(item || '')).filter(Boolean) : [];

const unique = (values = []) => {
  const output = [];
  for (const value of values) {
    const safe = String(value || '').trim();
    if (!safe || output.includes(safe)) continue;
    output.push(safe);
  }
  return output;
};

const buildDefaultCapabilityKeywords = (command) => {
  const name = String(command?.name || '').trim();
  const aliases = ensureStringArray(command?.aliases);
  const category = String(command?.categoria || '').trim();
  const local = ensureStringArray(command?.local_de_uso);
  const base = [name, ...aliases];
  if (category) base.push(category);
  base.push(...local);
  return unique(base);
};

const buildDefaultFaqPatterns = (command) => {
  const name = String(command?.name || '').trim();
  if (!name) return [];
  return unique([`como usar ${name}`, `o que faz ${name}`, `comando ${name}`]);
};

const buildDefaultUserPhrasings = (command) => {
  const name = String(command?.name || '').trim();
  const description = normalizeText(command?.descricao || '');
  const phrasings = [];

  if (name) {
    phrasings.push(`quero usar ${name}`);
    phrasings.push(`me ajuda com ${name}`);
  }
  if (description) {
    const words = description.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      phrasings.push(words.slice(0, Math.min(4, words.length)).join(' '));
    }
  }

  return unique(phrasings);
};

const listModuleConfigPaths = async () => {
  const moduleDirs = await fs.readdir(modulesRoot, { withFileTypes: true });
  const output = [];
  for (const moduleDir of moduleDirs) {
    if (!moduleDir.isDirectory()) continue;
    const configPath = path.join(modulesRoot, moduleDir.name, 'commandConfig.json');
    try {
      await fs.access(configPath);
      output.push(configPath);
    } catch {
      // ignore
    }
  }
  return output.sort();
};

const enrichCommand = (command) => {
  const next = { ...(command || {}) };
  if (!Array.isArray(next.capability_keywords)) {
    next.capability_keywords = buildDefaultCapabilityKeywords(next);
  } else {
    next.capability_keywords = unique(next.capability_keywords);
  }

  if (!Array.isArray(next.faq_patterns)) {
    next.faq_patterns = buildDefaultFaqPatterns(next);
  } else {
    next.faq_patterns = unique(next.faq_patterns);
  }

  if (!Array.isArray(next.user_phrasings)) {
    next.user_phrasings = buildDefaultUserPhrasings(next);
  } else {
    next.user_phrasings = unique(next.user_phrasings);
  }

  if (!Number.isFinite(Number(next.suggestion_priority))) {
    next.suggestion_priority = 100;
  } else {
    next.suggestion_priority = Math.max(1, Math.floor(Number(next.suggestion_priority)));
  }

  return next;
};

const main = async () => {
  const configPaths = await listModuleConfigPaths();
  let updatedFiles = 0;

  for (const configPath of configPaths) {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const commands = Array.isArray(parsed?.commands) ? parsed.commands : [];

    const enrichedCommands = commands.map((command) => enrichCommand(command));
    const updatedConfig = {
      ...parsed,
      commands: enrichedCommands,
    };

    const serialized = `${JSON.stringify(updatedConfig, null, 2)}\n`;
    if (serialized !== raw) {
      await fs.writeFile(configPath, serialized, 'utf8');
      updatedFiles += 1;
      console.log(`updated: ${path.relative(repoRoot, configPath)}`);
    }
  }

  console.log(`total_updated_files: ${updatedFiles}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
