#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const prettierBin = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');

const mode = process.argv.includes('--check') ? '--check' : '--write';
const args = ['.', mode, '--config', '.prettierrc', '--ignore-path', '.gitignore', '--ignore-unknown'];

const child = spawn(prettierBin, args, {
  stdio: 'inherit',
  cwd: projectRoot,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`[prettier] Falha ao executar: ${error?.message || 'erro desconhecido'}`);
  process.exit(1);
});
