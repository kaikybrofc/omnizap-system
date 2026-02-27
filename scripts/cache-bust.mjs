#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const usage = () => {
  console.error('Uso: node scripts/cache-bust.mjs --dir <diretorio> --version <build_id>');
};

const parseArgs = (argv) => {
  const options = {
    dir: '',
    version: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dir') {
      options.dir = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--version') {
      options.version = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
  }

  return options;
};

const listHtmlFiles = async (rootDir) => {
  const output = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && absolutePath.toLowerCase().endsWith('.html')) {
        output.push(absolutePath);
      }
    }
  }

  return output;
};

const withVersion = (assetPath, version) => {
  const [withoutHash, hash = ''] = assetPath.split('#', 2);
  const [pathname, query = ''] = withoutHash.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('v', version);
  const queryString = params.toString();
  return `${pathname}?${queryString}${hash ? `#${hash}` : ''}`;
};

const applyCacheBustToHtml = (html, version) => {
  const pattern = /((?:src|href)=["'])(\/(?:js|css)\/[^"']+)(["'])/gi;
  let referencesUpdated = 0;

  const output = html.replace(pattern, (fullMatch, prefix, assetPath, suffix) => {
    const nextPath = withVersion(assetPath, version);
    if (nextPath !== assetPath) referencesUpdated += 1;
    return `${prefix}${nextPath}${suffix}`;
  });

  return { output, referencesUpdated };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (!options.dir || !options.version) {
    usage();
    process.exit(1);
  }

  const targetDir = path.resolve(options.dir);
  const htmlFiles = await listHtmlFiles(targetDir);
  let filesUpdated = 0;
  let referencesUpdated = 0;

  for (const filePath of htmlFiles) {
    const current = await fs.readFile(filePath, 'utf8');
    const { output, referencesUpdated: fileRefs } = applyCacheBustToHtml(current, options.version);
    if (output !== current) {
      await fs.writeFile(filePath, output, 'utf8');
      filesUpdated += 1;
      referencesUpdated += fileRefs;
    }
  }

  console.log(`[cache-bust] version=${options.version} files=${filesUpdated} refs=${referencesUpdated}`);
};

main().catch((error) => {
  console.error(`[cache-bust] erro: ${error?.message || error}`);
  process.exit(1);
});
