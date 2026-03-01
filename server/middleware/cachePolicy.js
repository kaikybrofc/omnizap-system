import { URL } from 'node:url';

import { isAssetPath } from './cachePolicyHelpers.js';

export const applyCachePolicy = (req, res, { pathname } = {}) => {
  const resolvedPathname = pathname || new URL(req.url || '/', 'http://localhost').pathname;

  if (isAssetPath(resolvedPathname)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  if (resolvedPathname === '/sitemap.xml' || resolvedPathname.startsWith('/stickers')) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return;
  }

  if (resolvedPathname.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
};
