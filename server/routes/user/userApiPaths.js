export const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
      ? withLeadingSlash.slice(0, -1)
      : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

const normalizePathname = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw;
};

const hasPathPrefix = (pathname, prefix) => {
  if (pathname === prefix) return true;
  const normalizedPrefix = String(prefix || '').endsWith('/') ? String(prefix || '') : `${prefix}/`;
  return pathname.startsWith(normalizedPrefix);
};

export const DEFAULT_USER_API_BASE_PATH = '/api';
export const DEFAULT_LEGACY_STICKER_API_BASE_PATH = '/api/sticker-packs';

const USER_API_EXACT_ROUTE_SUFFIXES = Object.freeze([
  '',
  '/auth/google/session',
  '/auth/login',
  '/auth/terms/acceptance',
  '/auth/password',
  '/auth/password/recovery/request',
  '/auth/password/recovery/verify',
  '/auth/password/recovery/session',
  '/me',
  '/bot-contact',
  '/support',
  '/create-config',
  '/system-summary',
  '/project-summary',
  '/global-ranking-summary',
  '/readme-summary',
  '/readme-markdown',
  '/intents',
  '/creators',
  '/recommendations',
  '/stats',
  '/home-bootstrap',
]);

const USER_API_PREFIX_ROUTE_SUFFIXES = Object.freeze(['/auth/password/recovery/session/']);

const buildUserApiMatcher = (apiBasePath) => {
  const basePath = normalizeBasePath(apiBasePath, DEFAULT_USER_API_BASE_PATH);
  const exactPaths = new Set(USER_API_EXACT_ROUTE_SUFFIXES.map((suffix) => `${basePath}${suffix}`));
  const prefixPaths = USER_API_PREFIX_ROUTE_SUFFIXES.map((suffix) => `${basePath}${suffix}`);
  return {
    basePath,
    exactPaths,
    prefixPaths,
  };
};

export const buildUserApiPaths = (apiBasePath) => buildUserApiMatcher(apiBasePath).exactPaths;

export const isUserApiPath = (pathname, apiBasePath) => {
  const normalizedPathname = normalizePathname(pathname);
  const matcher = buildUserApiMatcher(apiBasePath);
  if (matcher.exactPaths.has(normalizedPathname)) return true;
  return matcher.prefixPaths.some((prefixPath) => hasPathPrefix(normalizedPathname, prefixPath));
};

export const resolveLegacyUserApiPath = (
  pathname,
  {
    apiBasePath = DEFAULT_USER_API_BASE_PATH,
    legacyApiBasePath = DEFAULT_LEGACY_STICKER_API_BASE_PATH,
  } = {},
) => {
  const normalizedPathname = normalizePathname(pathname);
  const resolvedApiBasePath = normalizeBasePath(apiBasePath, DEFAULT_USER_API_BASE_PATH);
  const resolvedLegacyBasePath = normalizeBasePath(
    legacyApiBasePath,
    DEFAULT_LEGACY_STICKER_API_BASE_PATH,
  );

  if (!isUserApiPath(normalizedPathname, resolvedApiBasePath)) return null;
  if (resolvedApiBasePath === resolvedLegacyBasePath) return normalizedPathname;
  if (normalizedPathname === resolvedApiBasePath) return resolvedLegacyBasePath;

  const suffix = normalizedPathname.slice(resolvedApiBasePath.length);
  if (!suffix) return resolvedLegacyBasePath;
  return `${resolvedLegacyBasePath}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
};
