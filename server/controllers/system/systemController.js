import logger from '#logger';
import { executeQuery, TABLES } from '../../../database/index.js';
import { getActiveSocket, getJidUser, normalizeJid, profilePictureUrlFromActiveSocket } from '../../../app/config/index.js';
import { getSystemMetrics } from '../../../app/utils/systemMetrics/systemMetricsModule.js';
import { createStickerCatalogSystemContext } from './stickerCatalogSystemContext.js';
import { createStickerCatalogNonCatalogHandlers } from '../sticker/nonCatalogHandlers.js';
import { sendJson, sendText, normalizeCatalogVisibility, normalizeVisitPath, withTimeout } from '../../http/httpRequestUtils.js';
import { fetchGitHubProjectSummary } from './githubController.js';
import { fetchPrometheusSummary } from './systemMetricsController.js';
import { buildBotContactInfo, buildSupportInfo, resolveCatalogBotPhone } from './contactController.js';
import { buildAdminMenu, buildAiMenu, buildAnimeMenu, buildMediaMenu, buildMenuCaption, buildQuoteMenu, buildStatsMenu, buildStickerMenu } from '../../../app/modules/menuModule/common.js';
import { trackWebVisitMetric } from './visitController.js';

const SYSTEM_SUMMARY_CACHE_SECONDS = Number(process.env.SYSTEM_SUMMARY_CACHE_SECONDS || 20);
const README_SUMMARY_CACHE_SECONDS = Number(process.env.README_SUMMARY_CACHE_SECONDS || 1800);
const README_MESSAGE_TYPE_SAMPLE_LIMIT = Number(process.env.README_MESSAGE_TYPE_SAMPLE_LIMIT || 25000);
const README_COMMAND_PREFIX = process.env.README_COMMAND_PREFIX || process.env.COMMAND_PREFIX || '/';
const GLOBAL_RANK_REFRESH_SECONDS = Number(process.env.GLOBAL_RANK_REFRESH_SECONDS || 600);
const MARKETPLACE_GLOBAL_STATS_CACHE_SECONDS = Number(process.env.MARKETPLACE_GLOBAL_STATS_CACHE_SECONDS || 45);
const GITHUB_PROJECT_CACHE_SECONDS = Number(process.env.GITHUB_PROJECT_CACHE_SECONDS || 300);

const SYSTEM_SUMMARY_CACHE = { expiresAt: 0, value: null, pending: null };
const README_SUMMARY_CACHE = { expiresAt: 0, value: null, pending: null };
const GLOBAL_RANK_CACHE = { expiresAt: 0, value: null, pending: null };
const MARKETPLACE_GLOBAL_STATS_CACHE = { expiresAt: 0, value: null, pending: null };

const resolveSocketReadyState = (activeSocket) => {
  const raw = activeSocket?.ws?.readyState;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'open') return 1;
  if (normalized === 'connecting') return 0;
  if (normalized === 'closing') return 2;
  if (normalized === 'closed') return 3;
  return null;
};

const resolveActiveSocketBotJid = (sock) => {
  if (!sock) return '';
  const candidates = [sock?.user?.id, sock?.authState?.creds?.me?.id, sock?.authState?.creds?.me?.lid];
  for (const candidate of candidates) {
    const resolved = normalizeJid(candidate);
    if (resolved) return resolved;
  }
  return '';
};

export const systemContext = createStickerCatalogSystemContext({
  executeQuery,
  tables: TABLES,
  logger,
  getSystemMetrics,
  getActiveSocket,
  resolveSocketReadyState,
  resolveActiveSocketBotJid,
  resolveCatalogBotPhone,
  fetchPrometheusSummary,
  metricsEndpoint: process.env.METRICS_ENDPOINT,
  systemSummaryCache: SYSTEM_SUMMARY_CACHE,
  systemSummaryCacheSeconds: SYSTEM_SUMMARY_CACHE_SECONDS,
  readmeSummaryCache: README_SUMMARY_CACHE,
  readmeSummaryCacheSeconds: README_SUMMARY_CACHE_SECONDS,
  readmeMessageTypeSampleLimit: README_MESSAGE_TYPE_SAMPLE_LIMIT,
  readmeCommandPrefix: README_COMMAND_PREFIX,
  buildMenuCaption,
  buildStickerMenu,
  buildMediaMenu,
  buildQuoteMenu,
  buildAnimeMenu,
  buildAiMenu,
  buildStatsMenu,
  buildAdminMenu,
  profilePictureUrlFromActiveSocket,
  normalizeJid,
  getJidUser,
  globalRankCache: GLOBAL_RANK_CACHE,
  globalRankRefreshSeconds: GLOBAL_RANK_REFRESH_SECONDS,
  marketplaceGlobalStatsCache: MARKETPLACE_GLOBAL_STATS_CACHE,
  marketplaceGlobalStatsCacheSeconds: MARKETPLACE_GLOBAL_STATS_CACHE_SECONDS,
});

const { getSystemSummaryCached, getReadmeSummaryCached, resolveBotUserCandidates, sanitizeRankingPayloadByBot, getGlobalRankingSummaryCached, scheduleGlobalRankingPreload, getMarketplaceGlobalStatsCached } = systemContext;

const resolveVisitPathFromReferrer = (req) => {
  const rawReferrer = String(req?.headers?.referer || req?.headers?.referrer || '').trim();
  if (!rawReferrer) return '/';
  try {
    const parsed = new URL(rawReferrer);
    const requestHost = req.headers.host;
    if (requestHost && parsed.host && parsed.host.toLowerCase() !== requestHost.toLowerCase()) return '/';
    return normalizeVisitPath(parsed.pathname || '/');
  } catch {
    return '/';
  }
};

export const systemHandlers = createStickerCatalogNonCatalogHandlers({
  sendJson,
  sendText,
  logger,
  getSystemSummaryCached,
  systemSummaryCache: SYSTEM_SUMMARY_CACHE,
  systemSummaryCacheSeconds: SYSTEM_SUMMARY_CACHE_SECONDS,
  getReadmeSummaryCached,
  readmeSummaryCache: README_SUMMARY_CACHE,
  readmeSummaryCacheSeconds: README_SUMMARY_CACHE_SECONDS,
  getGlobalRankingSummaryCached,
  globalRankRefreshSeconds: GLOBAL_RANK_REFRESH_SECONDS,
  globalRankCache: GLOBAL_RANK_CACHE,
  sanitizeRankingPayloadByBot,
  getActiveSocket,
  resolveBotUserCandidates,
  getMarketplaceGlobalStatsCached,
  marketplaceGlobalStatsCacheSeconds: MARKETPLACE_GLOBAL_STATS_CACHE_SECONDS,
  marketplaceGlobalStatsCache: MARKETPLACE_GLOBAL_STATS_CACHE,
  githubRepoInfo: { fullName: process.env.GITHUB_REPOSITORY || 'Kaikygr/omnizap-system' },
  githubProjectCacheSeconds: GITHUB_PROJECT_CACHE_SECONDS,
  fetchGitHubProjectSummary,
  buildSupportInfo,
  buildBotContactInfo,
  trackWebVisitMetric,
  resolveVisitPathFromReferrer,
  normalizeCatalogVisibility,
  stickerWebGoogleClientId: process.env.STICKER_WEB_GOOGLE_CLIENT_ID,
  homeBootstrapExposeContact: process.env.HOME_BOOTSTRAP_EXPOSE_CONTACT !== 'false',
  // Estas serão injetadas via bridge para evitar circular dependency
  getMarketplaceStatsCached: (vis) => globalThis.getMarketplaceStatsCachedBridge?.(vis),
  resolveGoogleWebSessionFromRequest: (req) => globalThis.resolveGoogleWebSessionFromRequestBridge?.(req),
  isAuthenticatedGoogleSession: (sess) => Boolean(sess?.sub && (sess?.ownerJid || sess?.ownerPhone || sess?.email)),
});

export { scheduleGlobalRankingPreload };
