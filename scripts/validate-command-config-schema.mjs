#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const parseCliArgs = (argv = []) => {
  const args = new Map();
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(token, true);
      continue;
    }

    if (token === '--file') {
      const current = args.get(token);
      if (Array.isArray(current)) {
        current.push(next);
      } else if (typeof current === 'string') {
        args.set(token, [current, next]);
      } else {
        args.set(token, next);
      }
      index += 1;
      continue;
    }

    args.set(token, next);
    index += 1;
  }

  return { args, positional };
};

const asArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
};

const discoverDefaultConfigFiles = () => {
  const modulesRoot = path.join(process.cwd(), 'app', 'modules');
  let moduleEntries = [];
  try {
    moduleEntries = fs.readdirSync(modulesRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return moduleEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(modulesRoot, entry.name, 'commandConfig.json'))
    .filter((configPath) => fs.existsSync(configPath))
    .sort((left, right) => left.localeCompare(right));
};

const formatAjvError = (error) => {
  const instancePath = error?.instancePath || '/';
  const message = error?.message || 'invalid';
  const keyword = error?.keyword ? ` [${error.keyword}]` : '';
  return `${instancePath}${keyword}: ${message}`;
};

const { args, positional } = parseCliArgs(process.argv.slice(2));
const schemaPath = path.resolve(String(args.get('--schema') || path.join(process.cwd(), 'schemas', 'command-config.schema.json')));
const explicitFiles = [...asArray(args.get('--file')), ...positional].map((file) => path.resolve(String(file)));
const targetFiles = explicitFiles.length ? explicitFiles : discoverDefaultConfigFiles();

if (!fs.existsSync(schemaPath)) {
  console.error(`[command-config-schema] schema nao encontrado: ${schemaPath}`);
  console.error('Gere antes com: npm run command-config:schema:generate');
  process.exit(1);
}

if (!targetFiles.length) {
  console.error('[command-config-schema] nenhum arquivo alvo encontrado para validacao');
  process.exit(1);
}

const rawSchema = fs.readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(rawSchema);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

let hasErrors = false;

for (const targetFile of targetFiles) {
  if (!fs.existsSync(targetFile)) {
    hasErrors = true;
    console.error(`\n✖ ${path.relative(process.cwd(), targetFile)} (arquivo nao encontrado)`);
    continue;
  }

  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  } catch (error) {
    hasErrors = true;
    console.error(`\n✖ ${path.relative(process.cwd(), targetFile)} (json invalido: ${error?.message || error})`);
    continue;
  }

  const ok = validate(payload);
  if (ok) {
    console.log(`✔ ${path.relative(process.cwd(), targetFile)}`);
    continue;
  }

  hasErrors = true;
  console.error(`\n✖ ${path.relative(process.cwd(), targetFile)}`);
  for (const error of validate.errors || []) {
    console.error(`  - ${formatAjvError(error)}`);
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`\n[command-config-schema] ok (${targetFiles.length} arquivo(s))`);
