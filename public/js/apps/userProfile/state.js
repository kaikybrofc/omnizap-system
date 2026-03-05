const DEFAULT_API_BASE_PATH = '/api/sticker-packs';
const DEFAULT_LOGIN_PATH = '/login';
const DEFAULT_TERMS_URL = '/termos-de-uso/';
const DEFAULT_PRIVACY_URL = '/termos-de-uso/#politica-de-privacidade';
const DEFAULT_FALLBACK_AVATAR = 'https://iili.io/FC3FABe.jpg';

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash || fallback;
};

const normalizeUrlPath = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw;
};

export const createUserProfileState = (root) => {
  const dataset = root?.dataset || {};

  return {
    apiBasePath: normalizeBasePath(dataset.apiBasePath, DEFAULT_API_BASE_PATH),
    loginPath: normalizeBasePath(dataset.loginPath, DEFAULT_LOGIN_PATH),
    termsUrl: normalizeUrlPath(dataset.termsUrl, DEFAULT_TERMS_URL),
    privacyUrl: normalizeUrlPath(dataset.privacyUrl, DEFAULT_PRIVACY_URL),
    fallbackAvatar: normalizeUrlPath(dataset.fallbackAvatar, DEFAULT_FALLBACK_AVATAR),
    activeTab: 'summary',
    summaryLoaded: false,
    sidebarOpen: true,
    lastFailedScope: null,
    botPhone: '',
    supportPhone: '',
    supportText: '',
    supportUrl: '',
  };
};
