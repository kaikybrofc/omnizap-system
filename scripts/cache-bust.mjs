#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { URLSearchParams } from 'node:url';

const TARGET_SOURCE_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css']);
const ASSET_SUFFIX_PATTERN =
  String.raw`\.(?:js|mjs|cjs|css|png|jpe?g|gif|svg|webp|ico|json|map|woff2?|ttf|eot)(?:\?[^"'#\s)]*)?(?:#[^"' \s)]*)?`;
const HTML_ATTRIBUTE_ASSET_PATTERN = new RegExp(
  String.raw`((?:src|href|poster)=["'])([^"']+?${ASSET_SUFFIX_PATTERN})(["'])`,
  'gi',
);
const QUOTED_LOCAL_ASSET_PATTERN = new RegExp(
  String.raw`(["'])((?:\/|\.{1,2}\/)[^"'\s]+?${ASSET_SUFFIX_PATTERN})\1`,
  'gi',
);
const CSS_URL_ASSET_PATTERN = new RegExp(
  String.raw`(url\(\s*["']?)([^"')\s]+?${ASSET_SUFFIX_PATTERN})(["']?\s*\))`,
  'gi',
);

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

const listSourceFiles = async (rootDir) => {
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
      if (!entry.isFile()) continue;
      const extension = path.extname(absolutePath).toLowerCase();
      if (TARGET_SOURCE_EXTENSIONS.has(extension)) {
        output.push(absolutePath);
      }
    }
  }

  return output;
};

const isLocalAssetPath = (assetPath) => {
  const value = String(assetPath || '').trim();
  if (!value) return false;

  const lower = value.toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('//') ||
    lower.startsWith('data:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('#')
  ) {
    return false;
  }

  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../');
};

const withVersion = (assetPath, version) => {
  const [withoutHash, hash = ''] = assetPath.split('#', 2);
  const [pathname, query = ''] = withoutHash.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('v', version);
  const queryString = params.toString();
  return `${pathname}?${queryString}${hash ? `#${hash}` : ''}`;
};

const applyCacheBustToSource = (source, version) => {
  let referencesUpdated = 0;
  const rewrite = (assetPath) => {
    if (!isLocalAssetPath(assetPath)) return assetPath;
    const nextPath = withVersion(assetPath, version);
    if (nextPath !== assetPath) referencesUpdated += 1;
    return nextPath;
  };

  let output = source.replace(HTML_ATTRIBUTE_ASSET_PATTERN, (fullMatch, prefix, assetPath, suffix) => {
    const nextPath = rewrite(assetPath);
    return `${prefix}${nextPath}${suffix}`;
  });

  output = output.replace(QUOTED_LOCAL_ASSET_PATTERN, (fullMatch, quote, assetPath) => {
    const nextPath = rewrite(assetPath);
    return `${quote}${nextPath}${quote}`;
  });

  output = output.replace(CSS_URL_ASSET_PATTERN, (fullMatch, prefix, assetPath, suffix) => {
    const nextPath = rewrite(assetPath);
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
  const sourceFiles = await listSourceFiles(targetDir);
  let filesUpdated = 0;
  let referencesUpdated = 0;

  for (const filePath of sourceFiles) {
    const current = await fs.readFile(filePath, 'utf8');
    const { output, referencesUpdated: fileRefs } = applyCacheBustToSource(current, options.version);
    if (output !== current) {
      await fs.writeFile(filePath, output, 'utf8');
      filesUpdated += 1;
    }
    referencesUpdated += fileRefs;
  }

  console.log(`[cache-bust] version=${options.version} scanned=${sourceFiles.length} files=${filesUpdated} refs=${referencesUpdated}`);
};

main().catch((error) => {
  console.error(`[cache-bust] erro: ${error?.message || error}`);
  process.exit(1);
});
