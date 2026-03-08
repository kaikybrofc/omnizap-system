#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const modulesRoot = path.join(repoRoot, 'app', 'modules');
const outputPath = path.join(repoRoot, 'public', 'comandos', 'commands-catalog.json');

const CATEGORY_META = {
  admin: { label: 'Moderacao e Admin', icon: '🛡️' },
  figurinhas: { label: 'Figurinhas', icon: '🎨' },
  midia: { label: 'Midia', icon: '🎵' },
  ia: { label: 'Inteligencia Artificial', icon: '🤖' },
  anime: { label: 'Anime e Imagens', icon: '🖼️' },
  jogos: { label: 'Jogos e Diversao', icon: '🎮' },
  estatisticas: { label: 'Estatisticas', icon: '📊' },
  menu: { label: 'Menu e Navegacao', icon: '📚' },
  sistema: { label: 'Sistema', icon: '🧰' },
  usuario: { label: 'Perfil de Usuario', icon: '👤' },
};

const CATEGORY_ORDER = [
  'admin',
  'figurinhas',
  'midia',
  'ia',
  'jogos',
  'estatisticas',
  'anime',
  'usuario',
  'menu',
  'sistema',
];

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const ensureArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const unique = (values = []) => {
  const out = [];
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw || out.includes(raw)) continue;
    out.push(raw);
  }
  return out;
};

const normalizeCategoryKey = (value) => normalizeText(value).replace(/\s+/g, '_') || 'outros';

const resolveCategoryMeta = (key) => {
  const meta = CATEGORY_META[key] || null;
  if (meta) return meta;

  const label = key
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
  return { label, icon: '🧩' };
};

const listModuleConfigs = async () => {
  const dirs = await fs.readdir(modulesRoot, { withFileTypes: true });
  const configs = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const moduleDir = path.join(modulesRoot, dir.name);
    const configPath = path.join(moduleDir, 'commandConfig.json');
    try {
      await fs.access(configPath);
      configs.push({ moduleDirName: dir.name, configPath });
    } catch {
      // ignore modules sem commandConfig
    }
  }

  return configs.sort((left, right) => left.moduleDirName.localeCompare(right.moduleDirName));
};

const sanitizeCommand = ({ command, moduleDirName, moduleName }) => {
  const commandName = String(command?.name || '').trim();
  if (!commandName) return null;

  const category = normalizeCategoryKey(command?.categoria);
  const aliases = unique(ensureArray(command?.aliases).map((alias) => String(alias)));
  const usageMethods = unique(
    ensureArray(command?.metodos_de_uso).map((method) =>
      String(method).replaceAll('<prefix>', '/').trim(),
    ),
  );
  const usageVariants =
    command?.mensagens_uso && typeof command.mensagens_uso === 'object'
      ? Object.entries(command.mensagens_uso).reduce((acc, [variantKey, methods]) => {
          const normalizedVariantKey = String(variantKey || '').trim();
          const normalizedMethods = unique(
            ensureArray(methods).map((method) => String(method).replaceAll('<prefix>', '/').trim()),
          );
          if (normalizedVariantKey && normalizedMethods.length) {
            acc[normalizedVariantKey] = normalizedMethods;
          }
          return acc;
        }, {})
      : {};

  return {
    key: `${moduleDirName}:${commandName}`,
    name: commandName,
    aliases,
    module: moduleDirName,
    module_label: moduleName,
    category,
    category_label: resolveCategoryMeta(category).label,
    descricao: String(command?.descricao || '').trim(),
    permissao_necessaria: String(command?.permissao_necessaria || '').trim(),
    local_de_uso: unique(ensureArray(command?.local_de_uso).map((item) => String(item).trim())),
    subcomandos: unique(ensureArray(command?.subcomandos).map((item) => String(item).trim())),
    metodos_de_uso: usageMethods,
    mensagens_uso: usageVariants,
  };
};

const buildCatalog = async () => {
  const moduleConfigs = await listModuleConfigs();
  const commands = [];
  const modules = [];

  for (const { moduleDirName, configPath } of moduleConfigs) {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const moduleName = String(parsed?.module || moduleDirName).trim() || moduleDirName;
    const entries = ensureArray(parsed?.commands);

    const moduleCommands = [];
    for (const entry of entries) {
      if (!entry || entry.enabled === false) continue;
      const sanitized = sanitizeCommand({ command: entry, moduleDirName, moduleName });
      if (!sanitized) continue;
      moduleCommands.push(sanitized);
      commands.push(sanitized);
    }

    modules.push({
      key: moduleDirName,
      label: moduleName,
      source_file: path.relative(repoRoot, configPath),
      enabled: parsed?.enabled !== false,
      command_count: moduleCommands.length,
    });
  }

  const categoryMap = new Map();
  for (const command of commands) {
    if (!categoryMap.has(command.category)) {
      const categoryMeta = resolveCategoryMeta(command.category);
      categoryMap.set(command.category, {
        key: command.category,
        label: categoryMeta.label,
        icon: categoryMeta.icon,
        command_count: 0,
        modules: new Set(),
        commands: [],
      });
    }
    const category = categoryMap.get(command.category);
    category.command_count += 1;
    category.modules.add(command.module);
    category.commands.push(command);
  }

  const knownOrderMap = new Map(CATEGORY_ORDER.map((key, index) => [key, index]));
  const categories = Array.from(categoryMap.values())
    .sort((left, right) => {
      const leftOrder = knownOrderMap.has(left.key) ? knownOrderMap.get(left.key) : 999;
      const rightOrder = knownOrderMap.has(right.key) ? knownOrderMap.get(right.key) : 999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (left.command_count !== right.command_count)
        return right.command_count - left.command_count;
      return left.label.localeCompare(right.label, 'pt-BR');
    })
    .map((category) => ({
      ...category,
      modules: Array.from(category.modules).sort((left, right) =>
        left.localeCompare(right, 'pt-BR'),
      ),
      commands: category.commands.sort((left, right) =>
        left.name.localeCompare(right.name, 'pt-BR'),
      ),
    }));

  const sortedModules = modules.sort((left, right) => {
    if (left.command_count !== right.command_count) return right.command_count - left.command_count;
    return left.label.localeCompare(right.label, 'pt-BR');
  });

  return {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    totals: {
      modules: sortedModules.length,
      categories: categories.length,
      commands: commands.length,
    },
    modules: sortedModules,
    categories,
  };
};

const writeCatalog = async () => {
  const payload = await buildCatalog();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(
    `Catalogo de comandos atualizado: ${path.relative(repoRoot, outputPath)} (${payload.totals.commands} comandos)`,
  );
};

writeCatalog().catch((error) => {
  console.error('Falha ao gerar catalogo de comandos:', error);
  process.exitCode = 1;
});
