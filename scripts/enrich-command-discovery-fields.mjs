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

const ensureStringArray = (value) => (Array.isArray(value) ? value.map((item) => String(item || '')).filter(Boolean) : []);

const unique = (values = []) => {
  const output = [];
  for (const value of values) {
    const safe = String(value || '').trim();
    if (!safe || output.includes(safe)) continue;
    output.push(safe);
  }
  return output;
};

const cloneLimitProfile = (profile = {}) => ({
  comum: {
    max: Number(profile?.comum?.max ?? 12),
    janela_ms: Number(profile?.comum?.janela_ms ?? 300000),
    escopo: String(profile?.comum?.escopo || 'usuario').trim() || 'usuario',
  },
  premium: {
    max: Number(profile?.premium?.max ?? 36),
    janela_ms: Number(profile?.premium?.janela_ms ?? 300000),
    escopo: String(profile?.premium?.escopo || 'usuario').trim() || 'usuario',
  },
});

const LIMIT_PROFILES_BY_CATEGORY = {
  admin: {
    comum: { max: 25, janela_ms: 60000, escopo: 'usuario' },
    premium: { max: 120, janela_ms: 60000, escopo: 'usuario' },
  },
  ia: {
    comum: { max: 8, janela_ms: 300000, escopo: 'usuario' },
    premium: { max: 40, janela_ms: 300000, escopo: 'usuario' },
  },
  midia: {
    comum: { max: 4, janela_ms: 600000, escopo: 'usuario' },
    premium: { max: 15, janela_ms: 600000, escopo: 'usuario' },
  },
  figurinhas: {
    comum: { max: 12, janela_ms: 300000, escopo: 'usuario' },
    premium: { max: 45, janela_ms: 300000, escopo: 'usuario' },
  },
  jogos: {
    comum: { max: 20, janela_ms: 300000, escopo: 'usuario' },
    premium: { max: 75, janela_ms: 300000, escopo: 'usuario' },
  },
  estatisticas: {
    comum: { max: 25, janela_ms: 60000, escopo: 'usuario' },
    premium: { max: 120, janela_ms: 60000, escopo: 'usuario' },
  },
  menu: {
    comum: { max: 40, janela_ms: 60000, escopo: 'usuario' },
    premium: { max: 160, janela_ms: 60000, escopo: 'usuario' },
  },
  sistema: {
    comum: { max: 40, janela_ms: 60000, escopo: 'usuario' },
    premium: { max: 160, janela_ms: 60000, escopo: 'usuario' },
  },
  usuario: {
    comum: { max: 30, janela_ms: 60000, escopo: 'usuario' },
    premium: { max: 120, janela_ms: 60000, escopo: 'usuario' },
  },
  anime: {
    comum: { max: 10, janela_ms: 300000, escopo: 'usuario' },
    premium: { max: 35, janela_ms: 300000, escopo: 'usuario' },
  },
  default: {
    comum: { max: 12, janela_ms: 300000, escopo: 'usuario' },
    premium: { max: 48, janela_ms: 300000, escopo: 'usuario' },
  },
};

const PREMIUM_ONLY_EXACT_COMMANDS = new Set(['wpnsfw', 'playvid', 'catimg']);

const normalizeCategory = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeCommand = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const resolveDefaultAccessProfile = (command) => {
  const category = normalizeCategory(command?.categoria);
  const commandName = normalizeCommand(command?.name);
  const profile = LIMIT_PROFILES_BY_CATEGORY[category] || LIMIT_PROFILES_BY_CATEGORY.default;
  const premiumOnly = PREMIUM_ONLY_EXACT_COMMANDS.has(commandName) || /nsfw/.test(commandName || '');

  return {
    premiumOnly,
    limits: cloneLimitProfile(profile),
  };
};

const sanitizeLimitEntry = (entry, fallback = {}) => {
  const max = Number(entry?.max ?? fallback?.max ?? 12);
  const janelaMs = Number(entry?.janela_ms ?? fallback?.janela_ms ?? 300000);
  const escopo = String(entry?.escopo || fallback?.escopo || 'usuario').trim() || 'usuario';
  return {
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : Number(fallback?.max ?? 12),
    janela_ms: Number.isFinite(janelaMs) && janelaMs > 0 ? Math.floor(janelaMs) : Number(fallback?.janela_ms ?? 300000),
    escopo,
  };
};

const ensureAccessAndLimits = (command) => {
  const defaults = resolveDefaultAccessProfile(command);

  const existingAccess = command?.acesso && typeof command.acesso === 'object' && !Array.isArray(command.acesso) ? command.acesso : {};
  const existingLimits = command?.limite_uso_por_plano && typeof command.limite_uso_por_plano === 'object' && !Array.isArray(command.limite_uso_por_plano) ? command.limite_uso_por_plano : {};

  const somentePremium = typeof existingAccess.somente_premium === 'boolean' ? existingAccess.somente_premium : defaults.premiumOnly;
  const planosPermitidosInput = Array.isArray(existingAccess.planos_permitidos)
    ? existingAccess.planos_permitidos.map((item) =>
        String(item || '')
          .trim()
          .toLowerCase(),
      )
    : somentePremium
      ? ['premium']
      : ['comum', 'premium'];
  const planosPermitidos = unique(planosPermitidosInput.filter(Boolean));
  if (somentePremium && !planosPermitidos.includes('premium')) {
    planosPermitidos.push('premium');
  }
  if (somentePremium) {
    const idx = planosPermitidos.indexOf('comum');
    if (idx >= 0) planosPermitidos.splice(idx, 1);
  }

  const comum = sanitizeLimitEntry(existingLimits.comum, defaults.limits.comum);
  const premium = sanitizeLimitEntry(existingLimits.premium, defaults.limits.premium);
  if (premium.max <= comum.max) {
    premium.max = Math.max(comum.max + 1, Math.floor(comum.max * 2));
  }

  return {
    acesso: {
      somente_premium: somentePremium,
      planos_permitidos: planosPermitidos,
    },
    limite_uso_por_plano: {
      comum,
      premium,
    },
  };
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

  const accessAndLimits = ensureAccessAndLimits(next);
  next.acesso = accessAndLimits.acesso;
  next.limite_uso_por_plano = accessAndLimits.limite_uso_por_plano;

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
