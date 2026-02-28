#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const args = process.argv.slice(2);
const action = String(args[0] || '').trim();

const getArg = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return String(args[index + 1] || fallback).trim();
};

const env = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parseRepoFromRemote = () => {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString('utf8')
      .trim();
    if (!remoteUrl) return '';

    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
    if (httpsMatch?.[1]) return httpsMatch[1];

    const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
    if (sshMatch?.[1]) return sshMatch[1];
  } catch {
    return '';
  }
  return '';
};

const token = env('RELEASE_GITHUB_TOKEN', 'DEPLOY_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN');
const repository = env('RELEASE_GITHUB_REPO', 'DEPLOY_GITHUB_REPO', 'GITHUB_REPOSITORY') || parseRepoFromRemote();

if (!action || !['upsert', 'get'].includes(action)) {
  console.error('Uso: node scripts/github-release-notify.mjs <upsert|get> --tag vX.Y.Z [opções]');
  process.exit(1);
}

if (!token || !repository) {
  console.error('GitHub release notify ignorado: token ou repositório não configurado.');
  process.exit(2);
}

const [repoOwnerRaw, repoNameRaw] = repository.split('/', 2);
const repoOwner = String(repoOwnerRaw || '').trim();
const repoName = String(repoNameRaw || '').trim();
if (!repoOwner || !repoName) {
  console.error('GitHub release notify ignorado: formato de repositório inválido (esperado owner/repo).');
  process.exit(2);
}

const tag = getArg('--tag');
const target = getArg('--target');
const name = getArg('--name', tag);
const body = getArg('--body', '');
const generateNotes = toBool(getArg('--generate-notes', 'true'), true);
const prerelease = toBool(getArg('--prerelease', 'false'), false);
const draft = toBool(getArg('--draft', 'false'), false);

if (!tag) {
  console.error('Parâmetro obrigatório ausente: --tag');
  process.exit(1);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  'User-Agent': 'omnizap-release-script',
};

const request = async (url, method, payload) => {
  const response = await fetch(url, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw,
  };
};

const failFromResponse = (response, fallbackPrefix = 'GitHub API') => {
  const message = response?.data?.message || response?.raw || 'unknown error';
  throw new Error(`${fallbackPrefix} ${response?.status ?? 'n/a'}: ${message}`);
};

const run = async () => {
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}`;

  const byTag = await request(`${baseUrl}/releases/tags/${encodeURIComponent(tag)}`, 'GET');
  let existingRelease = null;
  if (byTag.ok) {
    existingRelease = byTag.data;
  } else if (byTag.status !== 404) {
    failFromResponse(byTag, 'GitHub API');
  }

  if (action === 'get') {
    if (!existingRelease) {
      throw new Error(`GitHub release não encontrada para tag ${tag}`);
    }
    const url = existingRelease.html_url || '';
    process.stdout.write(`found id=${existingRelease.id} tag=${tag} url=${url}`);
    return;
  }

  const commonPayload = {
    tag_name: tag,
    target_commitish: target || undefined,
    name: name || tag,
    draft,
    prerelease,
  };

  if (body) {
    commonPayload.body = body;
  }

  if (existingRelease) {
    const update = await request(`${baseUrl}/releases/${existingRelease.id}`, 'PATCH', commonPayload);
    if (!update.ok) {
      failFromResponse(update, 'GitHub API');
    }
    const url = update.data?.html_url || '';
    process.stdout.write(`updated id=${update.data?.id} tag=${tag} url=${url}`);
    return;
  }

  const createPayload = { ...commonPayload };
  if (generateNotes) {
    createPayload.generate_release_notes = true;
  }

  const created = await request(`${baseUrl}/releases`, 'POST', createPayload);
  if (!created.ok) {
    failFromResponse(created, 'GitHub API');
  }

  const url = created.data?.html_url || '';
  process.stdout.write(`created id=${created.data?.id} tag=${tag} url=${url}`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
