#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const modulesRoot = path.join(repoRoot, 'app', 'modules');
const nowIso = new Date().toISOString();

const normalizeBoolLabel = (value) => (value ? 'sim' : 'nao');

const ensureArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const printList = (items, emptyText = '(nenhum)') => {
  const safeItems = ensureArray(items);
  if (!safeItems.length) return [`- ${emptyText}`];
  return safeItems.map((item) => `- ${String(item)}`);
};

const printObjectPairs = (obj, fallback = '(nao informado)') => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [`- ${fallback}`];
  const entries = Object.entries(obj);
  if (!entries.length) return [`- ${fallback}`];
  return entries.map(([key, value]) => `- ${key}: ${String(value)}`);
};

const renderArgumentLine = (argument) => {
  if (!argument || typeof argument !== 'object') return '- (argumento invalido)';
  const nome = String(argument.nome || 'arg').trim() || 'arg';
  const tipo = String(argument.tipo || 'any').trim() || 'any';
  const obrigatorio = argument.obrigatorio ? 'obrigatorio' : 'opcional';
  const validacao = String(argument.validacao || 'livre').trim() || 'livre';
  const defaultValue = argument.default === undefined ? 'null' : JSON.stringify(argument.default);
  return `- ${nome} | tipo: ${tipo} | ${obrigatorio} | validacao: ${validacao} | default: ${defaultValue}`;
};

const resolveGuideTitle = (moduleName) => {
  const raw = String(moduleName || 'module').trim() || 'module';
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1)} Agent Guide`;
};

const buildCommandSection = (command = {}) => {
  const commandName = String(command.name || '').trim() || 'comando';
  const lines = [];
  lines.push(`### ${commandName}`);
  const aliases = ensureArray(command.aliases);
  lines.push(`- aliases: ${aliases.length ? aliases.join(', ') : '(nenhum)'}`);
  lines.push(`- enabled: ${command.enabled !== false}`);
  lines.push(`- categoria: ${String(command.categoria || '(nao informado)')}`);
  lines.push(`- descricao: ${String(command.descricao || 'Sem descricao cadastrada.')}`);
  lines.push(
    `- permissao_necessaria: ${String(command.permissao_necessaria || '(nao informado)')}`,
  );
  lines.push(`- limite_de_uso: ${String(command.limite_de_uso || '(nao informado)')}`);

  lines.push('- local_de_uso:');
  lines.push(...printList(command.local_de_uso));

  lines.push('- metodos_de_uso:');
  lines.push(...printList(command.metodos_de_uso));

  if (command.mensagens_uso && typeof command.mensagens_uso === 'object') {
    lines.push('- mensagens_uso (variantes):');
    const usageVariants = Object.entries(command.mensagens_uso);
    if (!usageVariants.length) {
      lines.push('- (nenhum)');
    } else {
      for (const [variant, usageList] of usageVariants) {
        lines.push(`- ${variant}:`);
        lines.push(...printList(usageList));
      }
    }
  }

  lines.push('- subcomandos:');
  lines.push(...printList(command.subcomandos));

  lines.push('- argumentos:');
  const argumentos = ensureArray(command.argumentos);
  if (!argumentos.length) {
    lines.push('- (nenhum)');
  } else {
    lines.push(...argumentos.map((arg) => renderArgumentLine(arg)));
  }

  lines.push('- pre_condicoes:');
  const pre =
    command.pre_condicoes && typeof command.pre_condicoes === 'object' ? command.pre_condicoes : {};
  lines.push(`- requer_grupo: ${normalizeBoolLabel(Boolean(pre.requer_grupo))}`);
  lines.push(`- requer_admin: ${normalizeBoolLabel(Boolean(pre.requer_admin))}`);
  lines.push(
    `- requer_admin_principal: ${normalizeBoolLabel(Boolean(pre.requer_admin_principal))}`,
  );
  lines.push(`- requer_google_login: ${normalizeBoolLabel(Boolean(pre.requer_google_login))}`);
  lines.push(`- requer_nsfw: ${normalizeBoolLabel(Boolean(pre.requer_nsfw))}`);
  lines.push(`- requer_midia: ${normalizeBoolLabel(Boolean(pre.requer_midia))}`);
  lines.push(
    `- requer_mensagem_respondida: ${normalizeBoolLabel(Boolean(pre.requer_mensagem_respondida))}`,
  );

  const rateLimit =
    command.rate_limit && typeof command.rate_limit === 'object' ? command.rate_limit : {};
  lines.push('- rate_limit:');
  lines.push(`- max: ${rateLimit.max ?? 'null'}`);
  lines.push(`- janela_ms: ${rateLimit.janela_ms ?? 'null'}`);
  lines.push(`- escopo: ${rateLimit.escopo ?? '(nao informado)'}`);

  lines.push('- informacoes_coletadas:');
  lines.push(...printList(command.informacoes_coletadas));

  lines.push('- dependencias_externas:');
  lines.push(...printList(command.dependencias_externas));

  lines.push('- efeitos_colaterais:');
  lines.push(...printList(command.efeitos_colaterais));

  lines.push('- respostas_padrao:');
  lines.push(...printObjectPairs(command.respostas_padrao));

  lines.push('- observabilidade:');
  if (command.observabilidade && typeof command.observabilidade === 'object') {
    const obs = command.observabilidade;
    lines.push(`- evento_analytics: ${obs.evento_analytics ?? '(nao informado)'}`);
    lines.push(
      `- tags_log: ${
        Array.isArray(obs.tags_log) && obs.tags_log.length ? obs.tags_log.join(', ') : '(nenhum)'
      }`,
    );
    lines.push(`- nivel_log: ${obs.nivel_log ?? '(nao informado)'}`);
  } else {
    lines.push('- (nao informado)');
  }

  lines.push('- privacidade:');
  if (command.privacidade && typeof command.privacidade === 'object') {
    const privacy = command.privacidade;
    lines.push('- dados_sensiveis:');
    lines.push(...printList(privacy.dados_sensiveis));
    lines.push(`- retencao: ${privacy.retencao ?? '(nao informado)'}`);
    lines.push(`- base_legal: ${privacy.base_legal ?? '(nao informado)'}`);
  } else {
    lines.push('- (nao informado)');
  }

  return lines;
};

const buildAgentMarkdown = ({ moduleDirName, config }) => {
  const moduleName = String(config?.module || moduleDirName || 'module');
  const schemaVersion = String(config?.schema_version || '1.0.0');
  const moduleEnabled = config?.enabled !== false;
  const sourceFiles = ensureArray(config?.source_files);
  const commands = ensureArray(config?.commands);
  const enabledCommands = commands.filter((entry) => entry && entry.enabled !== false);

  const lines = [];
  lines.push(`# ${resolveGuideTitle(moduleName)}`);
  lines.push('');
  lines.push(
    'Este arquivo e destinado a agentes de IA para gerar respostas no contexto dos comandos deste modulo.',
  );
  lines.push('');
  lines.push('## Fonte de Verdade');
  lines.push(`- arquivo_base: \`app/modules/${moduleDirName}/commandConfig.json\``);
  lines.push(`- schema_version: \`${schemaVersion}\``);
  lines.push(`- module_enabled: \`${moduleEnabled}\``);
  lines.push(`- generated_at: \`${nowIso}\``);
  lines.push('');
  lines.push('## Escopo do Modulo');
  lines.push(`- module: \`${moduleName}\``);
  lines.push('- source_files:');
  lines.push(...printList(sourceFiles));
  lines.push(`- total_commands: \`${commands.length}\``);
  lines.push(`- total_enabled_commands: \`${enabledCommands.length}\``);

  if (config?.ai_help && typeof config.ai_help === 'object') {
    const aiHelp = config.ai_help;
    lines.push('');
    lines.push('## Configuracao AI Help');
    lines.push(`- enabled: ${aiHelp.enabled !== false}`);
    lines.push(`- mode: ${String(aiHelp.mode || '(nao informado)')}`);
    lines.push('- rag_sources:');
    lines.push(...printList(aiHelp.rag_sources));
    const faq = aiHelp.faq && typeof aiHelp.faq === 'object' ? aiHelp.faq : {};
    const llm = aiHelp.llm && typeof aiHelp.llm === 'object' ? aiHelp.llm : {};
    lines.push(`- faq.cache_file: ${faq.cache_file ?? '(nao informado)'}`);
    lines.push(`- faq.interval_ms: ${faq.interval_ms ?? '(nao informado)'}`);
    lines.push(`- faq.auto_generate_on_start: ${faq.auto_generate_on_start ?? '(nao informado)'}`);
    lines.push(`- llm.enabled: ${llm.enabled ?? '(nao informado)'}`);
    lines.push(`- llm.model: ${llm.model ?? '(nao informado)'}`);
    lines.push(
      `- llm.max_agent_context_chars: ${llm.max_agent_context_chars ?? '(nao informado)'}`,
    );
    lines.push(`- llm.max_response_chars: ${llm.max_response_chars ?? '(nao informado)'}`);
    lines.push(`- llm.timeout_ms: ${llm.timeout_ms ?? '(nao informado)'}`);
  }

  lines.push('');
  lines.push('## Protocolo de Resposta para IA');
  lines.push('- Passo 1: identificar comando pelo token apos o prefixo.');
  lines.push('- Passo 2: resolver alias para nome canonico usando campo `aliases`.');
  lines.push('- Passo 3: validar `enabled`, `pre_condicoes`, permissao e local de uso.');
  lines.push(
    '- Passo 4: se houver erro de uso, responder com `mensagens_uso` (quando existir) ou `metodos_de_uso`.',
  );
  lines.push('- Passo 5: seguir `respostas_padrao` como fallback de texto.');
  lines.push(
    '- Passo 6: considerar `informacoes_coletadas`, `privacidade` e `observabilidade` ao elaborar resposta.',
  );

  lines.push('');
  lines.push('## Regras de Seguranca para IA');
  lines.push('- A IA orienta, mas nao executa acao administrativa automaticamente.');
  lines.push('- Nao inventar comandos, subcomandos ou permissao fora do JSON.');
  lines.push('- Sempre informar onde pode usar (grupo/privado) e quem pode usar.');
  lines.push('- Em duvida de permissao, responder com orientacao conservadora.');

  lines.push('');
  lines.push('## Catalogo de Comandos');
  if (!commands.length) {
    lines.push('- (nenhum comando configurado)');
  } else {
    for (const command of commands) {
      lines.push(...buildCommandSection(command));
      lines.push('');
    }
    while (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }
  }

  lines.push('');
  return lines.join('\n');
};

const listModuleDirs = async () => {
  const entries = await fs.readdir(modulesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

const shouldSkipModule = (moduleDirName, includeAdmin) => {
  if (moduleDirName === 'adminModule' && !includeAdmin) return true;
  return false;
};

const main = async () => {
  const includeAdmin = process.argv.includes('--include-admin');
  const moduleDirs = await listModuleDirs();
  const generated = [];

  for (const moduleDirName of moduleDirs) {
    if (shouldSkipModule(moduleDirName, includeAdmin)) continue;

    const configPath = path.join(modulesRoot, moduleDirName, 'commandConfig.json');
    try {
      await fs.access(configPath);
    } catch {
      continue;
    }

    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    const markdown = buildAgentMarkdown({ moduleDirName, config });
    const targetPath = path.join(modulesRoot, moduleDirName, 'AGENT.md');
    await fs.writeFile(targetPath, markdown, 'utf8');
    generated.push(path.relative(repoRoot, targetPath));
  }

  for (const item of generated) {
    console.log(`generated: ${item}`);
  }
  console.log(`total_generated: ${generated.length}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
