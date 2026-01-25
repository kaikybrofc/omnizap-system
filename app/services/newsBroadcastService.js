import axios from 'axios';
import logger from '../utils/logger/loggerModule.js';
import groupConfigStore from '../store/groupConfigStore.js';
import { TABLES, findAll } from '../../database/index.js';
import { getActiveSocket } from './socketState.js';
import getImageBuffer from '../utils/http/getImageBufferModule.js';

const DEFAULT_NEWS_API_URL = 'http://127.0.0.1:3001';
const NEWS_API_URL = (process.env.NEWS_API_URL || DEFAULT_NEWS_API_URL).replace(/\/+$/, '');
const MIN_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 120 * 1000;
const MAX_SENT_IDS = Number(process.env.NEWS_SENT_IDS_LIMIT || 500);
const LOOP_START_DELAY_MS = 5000;

const groupLoops = new Map();

const getRandomDelayMs = () => {
  const min = MIN_DELAY_MS;
  const max = MAX_DELAY_MS;
  return Math.floor(min + Math.random() * (max - min + 1));
};

const parseConfigValue = (value) => {
  if (value === null || value === undefined) return {};
  if (Buffer.isBuffer(value)) {
    try {
      return JSON.parse(value.toString('utf8'));
    } catch (error) {
      logger.warn('Falha ao fazer parse do config (buffer).', { error: error.message });
      return {};
    }
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn('Falha ao fazer parse do config (string).', { error: error.message });
      return {};
    }
  }
  if (typeof value === 'object') return value;
  return {};
};

const loadEnabledGroupsFromDb = async () => {
  const enabledGroups = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const rows = await findAll(TABLES.GROUP_CONFIGS, limit, offset);
    if (!rows.length) break;

    for (const row of rows) {
      const config = parseConfigValue(row.config);
      if (config?.newsEnabled) {
        enabledGroups.push(row.id);
      }
    }

    offset += rows.length;
    if (rows.length < limit) break;
  }

  return enabledGroups;
};

const normalizeNewsItems = (data) => {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      refined: item.refined || {},
    }));
};

const fetchNewsItems = async () => {
  try {
    const response = await axios.get(NEWS_API_URL, { timeout: 15000 });
    return normalizeNewsItems(response.data);
  } catch (error) {
    logger.error('Erro ao buscar noticias da API.', {
      error: error.message,
      url: NEWS_API_URL,
    });
    return [];
  }
};

const buildNewsCaption = (newsItem) => {
  const title = newsItem?.refined?.name || 'Notícia';
  const summary = (newsItem?.refined?.summary || '').trim();
  const url = newsItem?.refined?.url || '';

  const lines = [`📰 *${title}*`];
  if (summary) {
    lines.push('', summary);
  }
  if (url) {
    lines.push('', `🔗 ${url}`);
  }
  return lines.join('\n').trim();
};

const sortByTimestampAsc = (items) =>
  items.sort((a, b) => {
    const aTime = a?.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b?.timestamp ? Date.parse(b.timestamp) : 0;
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return aTime - bTime;
  });

const trimSentIds = (ids) => {
  if (!Array.isArray(ids)) return [];
  if (!Number.isFinite(MAX_SENT_IDS) || MAX_SENT_IDS <= 0) return ids;
  if (ids.length <= MAX_SENT_IDS) return ids;
  return ids.slice(ids.length - MAX_SENT_IDS);
};

const scheduleNextRun = (groupId, delayMs) => {
  const state = groupLoops.get(groupId);
  if (!state || state.stopped) return;
  if (state.timeoutId) clearTimeout(state.timeoutId);
  state.timeoutId = setTimeout(() => {
    processGroupNews(groupId);
  }, delayMs);
};

const waitForSocketReady = async (timeoutMs = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sock = getActiveSocket();
    if (sock && sock.ws?.readyState === 1) {
      return sock;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
};

const stopGroupLoopInternal = (groupId) => {
  const state = groupLoops.get(groupId);
  if (!state) return;
  if (state.timeoutId) clearTimeout(state.timeoutId);
  state.stopped = true;
  groupLoops.delete(groupId);
};

const processGroupNews = async (groupId) => {
  const state = groupLoops.get(groupId);
  if (!state || state.stopped) return;
  if (state.inFlight) return;

  state.inFlight = true;
  let shouldSchedule = true;

  try {
    const config = await groupConfigStore.getGroupConfig(groupId);
    if (!config?.newsEnabled) {
      shouldSchedule = false;
      stopGroupLoopInternal(groupId);
      return;
    }

    const sock = getActiveSocket();
    if (!sock) {
      const now = Date.now();
      if (!state.lastNotReadyLogAt || now - state.lastNotReadyLogAt > 60_000) {
        state.lastNotReadyLogAt = now;
        logger.debug('Socket nao disponivel para envio de noticias.', { groupId });
      }
      return;
    }

    const allNews = await fetchNewsItems();
    if (allNews.length === 0) {
      return;
    }

    const sentIds = new Set(Array.isArray(config.newsSentIds) ? config.newsSentIds : []);
    const unsent = allNews.filter((item) => item?.id && !sentIds.has(item.id));

    if (unsent.length === 0) {
      return;
    }

    sortByTimestampAsc(unsent);
    const nextItem = unsent[0];
    const caption = buildNewsCaption(nextItem);
    const imageUrl = nextItem?.refined?.image || '';
    let sent = false;

    try {
      if (imageUrl && imageUrl.startsWith('https://')) {
        try {
          const imageBuffer = await getImageBuffer(imageUrl);
          await sock.sendMessage(groupId, { image: imageBuffer, caption });
          sent = true;
        } catch (error) {
          logger.warn('Falha ao baixar imagem da noticia. Enviando texto.', {
            groupId,
            error: error.message,
          });
        }
      }

      if (!sent) {
        await sock.sendMessage(groupId, { text: caption });
        sent = true;
      }

      if (sent) {
        sentIds.add(nextItem.id);
        const updatedSentIds = trimSentIds(Array.from(sentIds));
        await groupConfigStore.updateGroupConfig(groupId, {
          newsSentIds: updatedSentIds,
          newsLastSentAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Erro ao enviar noticia para grupo.', {
        groupId,
        error: error.message,
      });
    }
  } catch (error) {
    logger.error('Erro no processamento de noticias do grupo.', {
      groupId,
      error: error.message,
    });
  } finally {
    state.inFlight = false;
    if (shouldSchedule) {
      scheduleNextRun(groupId, getRandomDelayMs());
    }
  }
};

export const startNewsBroadcastForGroup = (groupId, options = {}) => {
  const existing = groupLoops.get(groupId);
  if (existing && !existing.stopped) {
    return;
  }

  const initialDelay =
    typeof options.initialDelayMs === 'number' ? options.initialDelayMs : LOOP_START_DELAY_MS;

  groupLoops.set(groupId, {
    timeoutId: null,
    inFlight: false,
    stopped: false,
  });

  scheduleNextRun(groupId, initialDelay);
};

export const stopNewsBroadcastForGroup = (groupId) => {
  stopGroupLoopInternal(groupId);
};

export const syncNewsBroadcastService = async () => {
  try {
    const enabledGroups = await loadEnabledGroupsFromDb();
    if (enabledGroups.length === 0) {
      logger.info('Nenhum grupo com noticias ativadas encontrado.');
      return;
    }

    enabledGroups.forEach((groupId) => {
      startNewsBroadcastForGroup(groupId);
    });

    logger.info('Serviço de noticias sincronizado.', {
      groups: enabledGroups.length,
    });
  } catch (error) {
    logger.error('Falha ao sincronizar serviço de noticias.', { error: error.message });
  }
};

export const initializeNewsBroadcastService = async () => syncNewsBroadcastService();

export const getNewsStatusForGroup = async (groupId) => {
  const config = await groupConfigStore.getGroupConfig(groupId);
  const sentCount = Array.isArray(config.newsSentIds) ? config.newsSentIds.length : 0;
  return {
    enabled: Boolean(config.newsEnabled),
    sentCount,
    lastSentAt: config.newsLastSentAt || null,
  };
};
