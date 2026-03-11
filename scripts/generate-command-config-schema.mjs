#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const parseCliArgs = (argv = []) => {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(token, true);
      continue;
    }
    args.set(token, next);
    index += 1;
  }
  return args;
};

const LEGACY_PRE_CONDICOES_REQUIRED = ['requer_grupo', 'requer_admin', 'requer_admin_principal', 'requer_google_login', 'requer_nsfw', 'requer_midia', 'requer_mensagem_respondida'];

const V2_REQUIREMENTS_REQUIRED = ['require_group', 'require_group_admin', 'require_bot_owner', 'require_google_login', 'require_nsfw_enabled', 'require_media', 'require_reply_message'];

const booleanPropsFrom = (keys = []) => Object.fromEntries(keys.map((key) => [key, { type: 'boolean' }]));

const LEGACY_ARGUMENT_SCHEMA = {
  type: 'object',
  required: ['nome', 'tipo', 'obrigatorio'],
  properties: {
    nome: { type: 'string' },
    tipo: { type: 'string' },
    obrigatorio: { type: 'boolean' },
    validacao: { type: ['string', 'null'] },
    default: {},
  },
  additionalProperties: true,
};

const V2_ARGUMENT_SCHEMA = {
  type: 'object',
  required: ['name', 'type', 'required'],
  properties: {
    name: { type: 'string' },
    type: { type: 'string' },
    required: { type: 'boolean' },
    default: {},
    enum: {
      type: ['array', 'null'],
      items: { type: ['string', 'number', 'boolean'] },
    },
    description: { type: ['string', 'null'] },
    validation: { type: ['string', 'null'] },
    position: { type: ['integer', 'null'] },
  },
  additionalProperties: true,
};

const LEGACY_PRE_CONDICOES_SCHEMA = {
  type: 'object',
  required: LEGACY_PRE_CONDICOES_REQUIRED,
  properties: booleanPropsFrom(LEGACY_PRE_CONDICOES_REQUIRED),
  additionalProperties: true,
};

const V2_REQUIREMENTS_SCHEMA = {
  type: 'object',
  required: V2_REQUIREMENTS_REQUIRED,
  properties: {
    ...booleanPropsFrom(V2_REQUIREMENTS_REQUIRED),
    legacy: LEGACY_PRE_CONDICOES_SCHEMA,
  },
  additionalProperties: true,
};

const PLAN_LIMIT_ENTRY_SCHEMA = {
  type: 'object',
  required: ['max', 'janela_ms', 'escopo'],
  properties: {
    max: { type: ['integer', 'null'] },
    janela_ms: { type: ['integer', 'null'] },
    escopo: { type: 'string' },
  },
  additionalProperties: true,
};

const PLAN_LIMITS_SCHEMA = {
  type: 'object',
  required: ['comum', 'premium'],
  properties: {
    comum: PLAN_LIMIT_ENTRY_SCHEMA,
    premium: PLAN_LIMIT_ENTRY_SCHEMA,
  },
  additionalProperties: true,
};

const ACCESS_SCHEMA = {
  type: 'object',
  required: ['premium_only', 'allowed_plans'],
  properties: {
    premium_only: { type: 'boolean' },
    allowed_plans: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  additionalProperties: true,
};

const COMMAND_HANDLER_SCHEMA = {
  type: 'object',
  required: ['file', 'method'],
  properties: {
    file: { type: 'string' },
    method: { type: 'string' },
    command_case: { type: ['string', 'null'] },
  },
  additionalProperties: true,
};

const COMMAND_SCHEMA = {
  type: 'object',
  required: ['name', 'aliases', 'metodos_de_uso', 'argumentos', 'categoria', 'enabled', 'pre_condicoes', 'id', 'description', 'usage', 'permission', 'contexts', 'collected_data', 'requirements', 'arguments', 'dependencies', 'side_effects', 'docs', 'behavior', 'limits', 'observability', 'privacy', 'discovery', 'access', 'plan_limits', 'version', 'stability', 'deprecated', 'risk_level', 'handler'],
  properties: {
    name: { type: 'string' },
    aliases: {
      type: 'array',
      items: { type: 'string' },
    },
    metodos_de_uso: {
      type: 'array',
      items: { type: 'string' },
    },
    argumentos: {
      type: 'array',
      items: LEGACY_ARGUMENT_SCHEMA,
    },
    categoria: { type: 'string' },
    enabled: { type: 'boolean' },
    pre_condicoes: LEGACY_PRE_CONDICOES_SCHEMA,

    id: { type: 'string' },
    description: { type: 'string' },
    usage: {
      type: 'array',
      items: { type: 'string' },
    },
    permission: { type: 'string' },
    contexts: {
      type: 'array',
      items: { type: 'string' },
    },
    collected_data: {
      type: 'array',
      items: { type: 'string' },
    },
    requirements: V2_REQUIREMENTS_SCHEMA,
    arguments: {
      type: 'array',
      items: V2_ARGUMENT_SCHEMA,
    },
    dependencies: {
      type: 'array',
      items: { type: 'string' },
    },
    side_effects: {
      type: 'array',
      items: { type: 'string' },
    },
    docs: { type: 'object' },
    behavior: { type: 'object' },
    limits: { type: 'object' },
    observability: { type: 'object' },
    privacy: { type: 'object' },
    discovery: { type: 'object' },
    access: ACCESS_SCHEMA,
    plan_limits: PLAN_LIMITS_SCHEMA,
    version: { type: 'string' },
    stability: { type: 'string' },
    deprecated: { type: 'boolean' },
    replaced_by: { type: ['string', 'null'] },
    risk_level: { type: 'string' },
    handler: COMMAND_HANDLER_SCHEMA,
  },
  additionalProperties: true,
};

const COMMAND_CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://omnizap.shop/schemas/command-config.schema.json',
  title: 'OmniZap Command Config Schema (v2)',
  description: 'Schema padrão para arquivos app/modules/*/commandConfig.json.',
  type: 'object',
  required: ['schema_version', 'module', 'enabled', 'source_files', 'defaults', 'commands'],
  properties: {
    schema_version: {
      type: 'string',
      pattern: '^2\\.',
    },
    module: { type: 'string' },
    enabled: { type: 'boolean' },
    source_files: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
    defaults: {
      type: 'object',
      required: ['command', 'requirements'],
      properties: {
        inheritance_mode: { type: ['string', 'null'] },
        compatibility_mode: { type: ['string', 'null'] },
        legacy_field_aliases: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        command: {
          type: 'object',
          required: ['enabled', 'category', 'version', 'stability', 'deprecated', 'risk_level'],
          properties: {
            enabled: { type: 'boolean' },
            category: { type: 'string' },
            version: { type: 'string' },
            stability: { type: 'string' },
            deprecated: { type: 'boolean' },
            replaced_by: { type: ['string', 'null'] },
            risk_level: { type: 'string' },
          },
          additionalProperties: true,
        },
        requirements: V2_REQUIREMENTS_SCHEMA,
        pre_condicoes: LEGACY_PRE_CONDICOES_SCHEMA,
        responses: { type: 'object' },
        respostas_padrao: { type: 'object' },
        access: ACCESS_SCHEMA,
        plan_limits: PLAN_LIMITS_SCHEMA,
        limite_uso_por_plano: PLAN_LIMITS_SCHEMA,
      },
      additionalProperties: true,
    },
    commands: {
      type: 'array',
      minItems: 1,
      items: COMMAND_SCHEMA,
    },
    textos: {
      type: 'object',
      additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
    },
  },
  additionalProperties: true,
};

const args = parseCliArgs(process.argv.slice(2));
const outputPath = path.resolve(String(args.get('--out') || path.join(process.cwd(), 'schemas', 'command-config.schema.json')));
const printStdout = Boolean(args.get('--stdout'));

const run = async () => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(COMMAND_CONFIG_SCHEMA, null, 2)}\n`, 'utf8');

  if (printStdout) {
    process.stdout.write(`${JSON.stringify(COMMAND_CONFIG_SCHEMA, null, 2)}\n`);
  }

  console.log(`[command-config-schema] generated: ${path.relative(process.cwd(), outputPath)}`);
};

run().catch((error) => {
  console.error('[command-config-schema] failed:', error?.message || error);
  process.exit(1);
});
