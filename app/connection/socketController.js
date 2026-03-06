import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, getAggregateVotesInPollMessage, areJidsSameUser } from '@whiskeysockets/baileys';

import NodeCache from 'node-cache';
import { resolveBaileysVersion } from '../config/baileysConfig.js';

import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'node:path';

import pino from 'pino';
import logger from '../../utils/logger/loggerModule.js';
import { handleMessages } from '../controllers/messageController.js';
import { syncNewsBroadcastService } from '../services/newsBroadcastService.js';
import { setActiveSocket as storeActiveSocket, runActiveSocketMethod, isSocketOpen } from '../services/socketState.js';
import { recordError, recordMessagesUpsert } from '../observability/metrics.js';
import { resolveCaptchaByReaction } from '../services/captchaService.js';

import { handleGroupUpdate as handleGroupParticipantsEvent, handleGroupJoinRequest } from '../modules/adminModule/groupEventHandlers.js';

import { findBy, findById, remove } from '../../database/index.js';
import { extractSenderInfoFromMessage, primeLidCache, resolveUserIdCached, isLidUserId, isWhatsAppUserId } from '../services/lidMapService.js';
import { queueBaileysEventInsert, queueChatUpdate, queueLidUpdate, queueMessageInsert } from '../services/dbWriteQueue.js';
import { buildGroupMetadataFromGroup, buildGroupMetadataFromUpdate, upsertGroupMetadata, parseParticipantsFromDb } from '../services/groupMetadataService.js';
import { buildMessageData } from '../services/messagePersistenceService.js';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseEnvInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const parseEnvCsv = (value, fallback) => {
  if (value === undefined || value === null || value === '') return [...fallback];
  const parsed = String(value)
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...fallback];
};

const IS_PRODUCTION =
  String(process.env.NODE_ENV || '')
    .trim()
    .toLowerCase() === 'production';
const MSG_RETRY_CACHE_TTL_SECONDS = parseEnvInt(process.env.BAILEYS_MSG_RETRY_CACHE_TTL_SECONDS, 600, 60, 24 * 60 * 60);
const MSG_RETRY_CACHE_CHECKPERIOD_SECONDS = parseEnvInt(process.env.BAILEYS_MSG_RETRY_CACHE_CHECKPERIOD_SECONDS, 120, 30, 3600);
const BAILEYS_EVENT_LOG_ENABLED = parseEnvBool(process.env.BAILEYS_EVENT_LOG_ENABLED, !IS_PRODUCTION);
const BAILEYS_RECONNECT_ATTEMPT_RESET_MS = parseEnvInt(process.env.BAILEYS_RECONNECT_ATTEMPT_RESET_MS, 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
const GROUP_SYNC_ON_CONNECT = parseEnvBool(process.env.GROUP_SYNC_ON_CONNECT, true);
const GROUP_SYNC_TIMEOUT_MS = parseEnvInt(process.env.GROUP_SYNC_TIMEOUT_MS, 30 * 1000, 5 * 1000, 120 * 1000);
const GROUP_SYNC_MAX_GROUPS = parseEnvInt(process.env.GROUP_SYNC_MAX_GROUPS, 0, 0, 10_000);
const GROUP_SYNC_BATCH_SIZE = parseEnvInt(process.env.GROUP_SYNC_BATCH_SIZE, 50, 1, 1000);
const BAILEYS_AUTO_REJECT_CALLS = parseEnvBool(process.env.BAILEYS_AUTO_REJECT_CALLS, true);
const BAILEYS_ENABLE_AUTO_SESSION_RECREATION = parseEnvBool(process.env.BAILEYS_ENABLE_AUTO_SESSION_RECREATION, true);
const BAILEYS_ENABLE_RECENT_MESSAGE_CACHE = parseEnvBool(process.env.BAILEYS_ENABLE_RECENT_MESSAGE_CACHE, true);
const BAILEYS_GENERATE_HIGH_QUALITY_LINK_PREVIEW = parseEnvBool(process.env.BAILEYS_GENERATE_HIGH_QUALITY_LINK_PREVIEW, false);
const BAILEYS_PATCH_MESSAGE_BEFORE_SENDING = parseEnvBool(process.env.BAILEYS_PATCH_MESSAGE_BEFORE_SENDING, true);
const BAILEYS_USER_DEVICES_CACHE_TTL_SECONDS = parseEnvInt(process.env.BAILEYS_USER_DEVICES_CACHE_TTL_SECONDS, 300, 30, 24 * 60 * 60);
const BAILEYS_USER_DEVICES_CACHE_CHECKPERIOD_SECONDS = parseEnvInt(process.env.BAILEYS_USER_DEVICES_CACHE_CHECKPERIOD_SECONDS, 60, 15, 3600);
const BAILEYS_MEDIA_CACHE_TTL_SECONDS = parseEnvInt(process.env.BAILEYS_MEDIA_CACHE_TTL_SECONDS, 3600, 60, 7 * 24 * 60 * 60);
const BAILEYS_MEDIA_CACHE_CHECKPERIOD_SECONDS = parseEnvInt(process.env.BAILEYS_MEDIA_CACHE_CHECKPERIOD_SECONDS, 300, 30, 3600);
const BAILEYS_GROUP_METADATA_CACHE_TTL_SECONDS = parseEnvInt(process.env.BAILEYS_GROUP_METADATA_CACHE_TTL_SECONDS, 120, 10, 3600);
const BAILEYS_GROUP_METADATA_CACHE_CHECKPERIOD_SECONDS = parseEnvInt(process.env.BAILEYS_GROUP_METADATA_CACHE_CHECKPERIOD_SECONDS, 60, 10, 1800);
const BAILEYS_EVENT_JOURNAL_ENABLED = parseEnvBool(process.env.BAILEYS_EVENT_JOURNAL_ENABLED, false);
const DEFAULT_BAILEYS_EVENT_JOURNAL_EVENTS = [
  'connection.update',
  'messages.upsert',
  'messages.update',
  'messages.delete',
  'messages.reaction',
  'message-receipt.update',
  'chats.upsert',
  'chats.update',
  'chats.delete',
  'groups.upsert',
  'groups.update',
  'group-participants.update',
  'group.join-request',
  'lid-mapping.update',
];
const BAILEYS_EVENT_JOURNAL_EVENT_LIST = parseEnvCsv(process.env.BAILEYS_EVENT_JOURNAL_EVENTS, DEFAULT_BAILEYS_EVENT_JOURNAL_EVENTS);
const BAILEYS_EVENT_JOURNAL_ALL_EVENTS = BAILEYS_EVENT_JOURNAL_EVENT_LIST.includes('*');
const BAILEYS_EVENT_JOURNAL_EVENTS = new Set(BAILEYS_EVENT_JOURNAL_EVENT_LIST.filter((eventName) => eventName !== '*'));

let activeSocket = null;
let connectionAttempts = 0;
let reconnectWindowStartedAt = 0;
const msgRetryCounterCache = new NodeCache({
  stdTTL: MSG_RETRY_CACHE_TTL_SECONDS,
  checkperiod: MSG_RETRY_CACHE_CHECKPERIOD_SECONDS,
  useClones: false,
});
const userDevicesCacheBackend = new NodeCache({
  stdTTL: BAILEYS_USER_DEVICES_CACHE_TTL_SECONDS,
  checkperiod: BAILEYS_USER_DEVICES_CACHE_CHECKPERIOD_SECONDS,
  useClones: false,
});
const mediaCacheBackend = new NodeCache({
  stdTTL: BAILEYS_MEDIA_CACHE_TTL_SECONDS,
  checkperiod: BAILEYS_MEDIA_CACHE_CHECKPERIOD_SECONDS,
  useClones: false,
});
const groupMetadataCache = new NodeCache({
  stdTTL: BAILEYS_GROUP_METADATA_CACHE_TTL_SECONDS,
  checkperiod: BAILEYS_GROUP_METADATA_CACHE_CHECKPERIOD_SECONDS,
  useClones: false,
});
const MAX_CONNECTION_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 3000;
let reconnectTimeout = null;
let connectPromise = null;
let socketGeneration = 0;
const BAILEYS_EVENT_NAMES = ['connection.update', 'creds.update', 'messaging-history.set', 'chats.upsert', 'chats.update', 'lid-mapping.update', 'chats.delete', 'presence.update', 'contacts.upsert', 'contacts.update', 'messages.delete', 'messages.update', 'messages.media-update', 'messages.upsert', 'messages.reaction', 'message-receipt.update', 'groups.upsert', 'groups.update', 'group-participants.update', 'group.join-request', 'group.member-tag.update', 'blocklist.set', 'blocklist.update', 'call', 'labels.edit', 'labels.association', 'newsletter.reaction', 'newsletter.view', 'newsletter-participants.update', 'newsletter-settings.update', 'chats.lock', 'settings.update'];
const BAILEYS_EVENTS_WITH_INTERNAL_LOG = new Set(['creds.update', 'connection.update', 'messages.upsert', 'messages.update', 'groups.update', 'group-participants.update']);
const BAILEYS_NOISY_EVENTS_IN_PRODUCTION = new Set(['presence.update']);

const createCacheStoreAdapter = (cache) => ({
  get: (key) => cache.get(key),
  set: (key, value) => cache.set(key, value),
  del: (key) => cache.del(key),
  flushAll: () => cache.flushAll(),
});

const createExtendedCacheStoreAdapter = (cache) => ({
  ...createCacheStoreAdapter(cache),
  mget: (keys) => cache.mget(keys),
  mset: (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    cache.mset(
      entries
        .filter((entry) => entry && typeof entry.key === 'string')
        .map((entry) => ({
          key: entry.key,
          val: entry.value,
        })),
    );
  },
  mdel: (keys) => cache.del(keys),
});

const userDevicesCache = createExtendedCacheStoreAdapter(userDevicesCacheBackend);
const mediaCache = createCacheStoreAdapter(mediaCacheBackend);

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

const sanitizeMessagePayload = (value, seen = new WeakSet()) => {
  if (value === undefined || typeof value === 'function') return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;

  seen.add(value);
  if (Array.isArray(value)) {
    const sanitizedArray = [];
    for (const item of value) {
      const sanitized = sanitizeMessagePayload(item, seen);
      if (typeof sanitized !== 'undefined') sanitizedArray.push(sanitized);
    }
    return sanitizedArray;
  }

  if (!isPlainObject(value)) return value;

  const sanitizedObject = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeMessagePayload(item, seen);
    if (typeof sanitized !== 'undefined') {
      sanitizedObject[key] = sanitized;
    }
  }

  return sanitizedObject;
};

const patchMessageBeforeSending = async (message) => {
  if (!BAILEYS_PATCH_MESSAGE_BEFORE_SENDING) return message;
  try {
    const sanitized = sanitizeMessagePayload(message);
    if (!sanitized || typeof sanitized !== 'object') return message;
    return sanitized;
  } catch (error) {
    logger.warn('Falha ao sanitizar payload de mensagem antes do envio. Usando payload original.', {
      action: 'patch_message_before_sending_error',
      error: error?.message,
    });
    return message;
  }
};

const buildCachedParticipants = (participantsRaw) => {
  const participants = parseParticipantsFromDb(participantsRaw);
  if (!Array.isArray(participants) || participants.length === 0) return [];
  return participants
    .map((entry) => {
      const id = entry?.id || entry?.jid || entry?.lid || null;
      if (!id) return null;
      const admin = entry?.admin === 'admin' || entry?.admin === 'superadmin' ? entry.admin : entry?.isAdmin ? 'admin' : undefined;
      return admin ? { id, admin } : { id };
    })
    .filter(Boolean);
};

const resolveCachedGroupMetadata = async (jid) => {
  if (!jid || typeof jid !== 'string' || !jid.endsWith('@g.us')) return undefined;

  const cached = groupMetadataCache.get(jid);
  if (cached) return cached;

  try {
    const row = await findById('groups_metadata', jid);
    const data = Array.isArray(row) ? row[0] : row;
    if (!data) return undefined;

    const participants = buildCachedParticipants(data.participants || data.participants_json);
    if (participants.length === 0) return undefined;

    const metadata = {
      id: data.id || jid,
      subject: data.subject || data.name || '',
      desc: data.description || data.desc || '',
      owner: data.owner_jid || data.owner || undefined,
      creation: Number.isFinite(Number(data.creation)) ? Number(data.creation) : undefined,
      participants,
      addressingMode: data.addressing_mode || data.addressingMode || undefined,
      ephemeralDuration: Number.isFinite(Number(data.ephemeral_duration ?? data.ephemeralDuration)) ? Number(data.ephemeral_duration ?? data.ephemeralDuration) : undefined,
    };

    groupMetadataCache.set(jid, metadata);
    return metadata;
  } catch (error) {
    logger.debug('Falha ao resolver metadados de grupo do cache local.', {
      action: 'cached_group_metadata_lookup_error',
      jid,
      error: error?.message,
    });
    return undefined;
  }
};

const invalidateCachedGroupMetadata = (groupId) => {
  if (!groupId || typeof groupId !== 'string') return;
  groupMetadataCache.del(groupId);
};

const summarizeBaileysEventPayload = (eventName, payload) => {
  if (payload === null) return { payloadType: 'null' };
  if (payload === undefined) return { payloadType: 'undefined' };
  if (Buffer.isBuffer(payload)) {
    return { payloadType: 'buffer', bytes: payload.length };
  }

  if (Array.isArray(payload)) {
    const summary = { payloadType: 'array', items: payload.length };
    if (payload.length > 0 && payload[0] && typeof payload[0] === 'object') {
      summary.sampleKeys = Object.keys(payload[0]).slice(0, 6);
    }
    return summary;
  }

  if (typeof payload !== 'object') {
    if (typeof payload === 'string') {
      return { payloadType: 'string', length: payload.length };
    }
    return { payloadType: typeof payload, value: payload };
  }

  const summary = { payloadType: 'object', keys: Object.keys(payload).slice(0, 10) };

  switch (eventName) {
    case 'messaging-history.set':
      summary.chats = Array.isArray(payload.chats) ? payload.chats.length : 0;
      summary.contacts = Array.isArray(payload.contacts) ? payload.contacts.length : 0;
      summary.messages = Array.isArray(payload.messages) ? payload.messages.length : 0;
      summary.isLatest = payload.isLatest ?? null;
      summary.progress = payload.progress ?? null;
      summary.syncType = payload.syncType ?? null;
      break;
    case 'presence.update':
      summary.id = payload.id ?? null;
      summary.presencesCount = payload.presences ? Object.keys(payload.presences).length : 0;
      break;
    case 'chats.lock':
      summary.id = payload.id ?? null;
      summary.locked = payload.locked ?? null;
      break;
    case 'settings.update':
      summary.setting = payload.setting ?? null;
      break;
    case 'messages.delete':
      if (payload.all === true) {
        summary.all = true;
        summary.jid = payload.jid ?? null;
      } else if (Array.isArray(payload.keys)) {
        summary.keysCount = payload.keys.length;
      }
      break;
    case 'blocklist.set':
      summary.blocklistCount = Array.isArray(payload.blocklist) ? payload.blocklist.length : 0;
      break;
    case 'blocklist.update':
      summary.blocklistCount = Array.isArray(payload.blocklist) ? payload.blocklist.length : 0;
      summary.type = payload.type ?? null;
      break;
    case 'group.join-request':
      summary.groupId = payload.id ?? null;
      summary.participant = payload.participant ?? null;
      summary.action = payload.action ?? null;
      summary.method = payload.method ?? null;
      break;
    case 'group.member-tag.update':
      summary.groupId = payload.groupId ?? null;
      summary.participant = payload.participant ?? null;
      summary.label = payload.label ?? null;
      break;
    case 'labels.association':
      summary.type = payload.type ?? null;
      summary.labelId = payload.association?.labelId ?? null;
      summary.chatId = payload.association?.chatId ?? null;
      break;
    case 'labels.edit':
      summary.labelId = payload.id ?? null;
      summary.labelName = payload.name ?? payload.label ?? null;
      break;
    case 'newsletter.reaction':
      summary.id = payload.id ?? null;
      summary.serverId = payload.server_id ?? null;
      summary.reactionCode = payload.reaction?.code ?? null;
      summary.reactionCount = payload.reaction?.count ?? null;
      summary.reactionRemoved = payload.reaction?.removed ?? null;
      break;
    case 'newsletter.view':
      summary.id = payload.id ?? null;
      summary.serverId = payload.server_id ?? null;
      summary.count = payload.count ?? null;
      break;
    case 'newsletter-participants.update':
      summary.id = payload.id ?? null;
      summary.user = payload.user ?? null;
      summary.action = payload.action ?? null;
      summary.newRole = payload.new_role ?? null;
      break;
    case 'newsletter-settings.update':
      summary.id = payload.id ?? null;
      summary.updateKeys = payload.update ? Object.keys(payload.update).slice(0, 6) : [];
      break;
    case 'lid-mapping.update':
      summary.lid = payload.lid ?? null;
      summary.pn = payload.pn ?? payload.jid ?? null;
      break;
    default:
      break;
  }

  return summary;
};

const shouldLogBaileysEvent = (eventName) => {
  if (!BAILEYS_EVENT_LOG_ENABLED) return false;
  if (IS_PRODUCTION && BAILEYS_NOISY_EVENTS_IN_PRODUCTION.has(eventName)) return false;
  return true;
};

const registerBaileysEventLoggers = (sock) => {
  const eventsToLog = BAILEYS_EVENT_NAMES.filter((eventName) => !BAILEYS_EVENTS_WITH_INTERNAL_LOG.has(eventName) && shouldLogBaileysEvent(eventName));

  for (const eventName of eventsToLog) {
    sock.ev.on(eventName, (payload) => {
      const summary = summarizeBaileysEventPayload(eventName, payload);
      logger.debug('Evento Baileys recebido.', {
        action: 'baileys_event',
        event: eventName,
        ...summary,
        timestamp: new Date().toISOString(),
      });
    });
  }

  logger.debug('Loggers de eventos Baileys registrados.', {
    action: 'baileys_event_logger_ready',
    enabled: BAILEYS_EVENT_LOG_ENABLED,
    eventsCount: eventsToLog.length,
    events: eventsToLog,
  });
};

const shouldPersistBaileysEvent = (eventName) => {
  if (!BAILEYS_EVENT_JOURNAL_ENABLED) return false;
  if (BAILEYS_EVENT_JOURNAL_ALL_EVENTS) return BAILEYS_EVENT_NAMES.includes(eventName);
  return BAILEYS_EVENT_JOURNAL_EVENTS.has(eventName);
};

const takeFirstString = (...values) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
};

const extractBaileysEventReferences = (payload) => {
  const refs = {
    chatId: null,
    messageId: null,
    participantId: null,
  };

  const assignChat = (...values) => {
    if (refs.chatId) return;
    refs.chatId = takeFirstString(...values);
  };

  const assignMessage = (...values) => {
    if (refs.messageId) return;
    refs.messageId = takeFirstString(...values);
  };

  const assignParticipant = (...values) => {
    if (refs.participantId) return;
    refs.participantId = takeFirstString(...values);
  };

  const applyFromKey = (key) => {
    if (!key || typeof key !== 'object') return;
    assignChat(key.remoteJid, key.remoteJidAlt);
    assignMessage(key.id);
    assignParticipant(key.participant, key.participantAlt);
  };

  const applyFromObject = (value) => {
    if (!value || typeof value !== 'object') return;

    applyFromKey(value.key);
    applyFromKey(value.msg?.key);
    applyFromKey(value.reaction?.key);
    applyFromKey(value.reactionMessage?.key);
    applyFromKey(value.reactedKey);

    assignChat(value.id, value.groupId, value.jid, value.chatId);
    assignMessage(value.messageId, value.msgId, value.server_id);
    assignParticipant(value.participant, value.user, value.lid, value.pn);

    if (Array.isArray(value.participants) && value.participants.length > 0) {
      assignParticipant(value.participants[0]);
    }
    if (Array.isArray(value.keys) && value.keys.length > 0) {
      applyFromKey(value.keys[0]);
    }
    if (Array.isArray(value.messages) && value.messages.length > 0) {
      applyFromObject(value.messages[0]);
    }
  };

  if (Array.isArray(payload)) {
    for (const item of payload) {
      applyFromObject(item);
      if (refs.chatId && refs.messageId && refs.participantId) break;
    }
  } else {
    applyFromObject(payload);
  }

  return refs;
};

const registerBaileysEventJournal = (sock, generation) => {
  if (!BAILEYS_EVENT_JOURNAL_ENABLED) {
    logger.debug('Journal de eventos Baileys desativado por configuração.', {
      action: 'baileys_event_journal_disabled',
    });
    return;
  }

  const unknownEvents = BAILEYS_EVENT_JOURNAL_EVENT_LIST.filter((eventName) => eventName !== '*' && !BAILEYS_EVENT_NAMES.includes(eventName));
  if (unknownEvents.length > 0) {
    logger.warn('Alguns eventos configurados para journal não existem na lista conhecida do Baileys.', {
      action: 'baileys_event_journal_unknown_events',
      unknownEvents,
    });
  }

  const eventsToPersist = BAILEYS_EVENT_NAMES.filter((eventName) => shouldPersistBaileysEvent(eventName));
  if (eventsToPersist.length === 0) {
    logger.warn('Journal de eventos Baileys habilitado sem eventos válidos para persistir.', {
      action: 'baileys_event_journal_empty',
      configuredEvents: BAILEYS_EVENT_JOURNAL_EVENT_LIST,
    });
    return;
  }

  for (const eventName of eventsToPersist) {
    sock.ev.on(eventName, (payload) => {
      try {
        const summary = summarizeBaileysEventPayload(eventName, payload);
        const refs = extractBaileysEventReferences(payload);
        queueBaileysEventInsert({
          event_name: eventName,
          socket_generation: generation,
          chat_id: refs.chatId,
          message_id: refs.messageId,
          participant_id: refs.participantId,
          payload_summary: summary,
          event_timestamp: new Date(),
        });
      } catch (error) {
        logger.warn('Falha ao enfileirar evento Baileys para journal.', {
          action: 'baileys_event_journal_enqueue_failed',
          eventName,
          error: error?.message,
        });
      }
    });
  }

  logger.info('Journal de eventos Baileys habilitado.', {
    action: 'baileys_event_journal_ready',
    generation,
    eventsCount: eventsToPersist.length,
    events: eventsToPersist,
  });
};

/**
 * Faz parse seguro de JSON com suporte a Buffer e retorna fallback em caso de erro.
 * @param {unknown} value - Valor a ser interpretado.
 * @param {any} fallback - Valor retornado quando o parse falha ou o valor é inválido.
 * @returns {any} Objeto parseado ou fallback.
 */
const safeJsonParse = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (Buffer.isBuffer(value)) {
    return safeJsonParse(value.toString('utf8'), fallback);
  }
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    logger.warn('Falha ao fazer parse de JSON armazenado.', {
      error: error.message,
    });
    return fallback;
  }
};

/**
 * Normaliza PN para JID de WhatsApp quando o payload vier sem domínio.
 * @param {string|null|undefined} pn
 * @returns {string|null}
 */
const normalizePnToJid = (pn) => {
  if (!pn || typeof pn !== 'string') return null;
  const normalized = pn.trim();
  if (!normalized) return null;
  if (isWhatsAppUserId(normalized)) return normalized;
  if (/^\d+(?::\d+)?$/.test(normalized)) return `${normalized}@s.whatsapp.net`;
  return null;
};

/**
 * Persiste mensagens recebidas quando o tipo do upsert permite salvamento.
 * @async
 * @param {Array<import('@whiskeysockets/baileys').WAMessage>} incomingMessages - Mensagens recebidas.
 * @param {'append' | 'notify' | string} type - Tipo do evento de upsert.
 * @returns {Promise<void>} Conclusão da persistência.
 */
async function persistIncomingMessages(incomingMessages, type) {
  if (type !== 'append' && type !== 'notify') return;

  const entries = [];
  const lidsToPrime = new Set();

  for (const msg of incomingMessages) {
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
    const senderInfo = extractSenderInfoFromMessage(msg);
    if (senderInfo.lid) lidsToPrime.add(senderInfo.lid);
    entries.push({ msg, senderInfo });
  }

  if (lidsToPrime.size > 0) {
    try {
      await primeLidCache(Array.from(lidsToPrime));
    } catch (error) {
      logger.warn('Falha ao aquecer cache de LID.', { error: error.message });
    }
  }

  for (const { msg, senderInfo } of entries) {
    if (senderInfo.lid) {
      queueLidUpdate(senderInfo.lid, senderInfo.jid, 'message');
    }

    const canonicalSenderId = resolveUserIdCached(senderInfo) || msg.key.participant || msg.key.remoteJid;

    const messageData = buildMessageData(msg, canonicalSenderId);
    queueMessageInsert(messageData);
  }
}

/**
 * Recupera mensagem armazenada para suporte a recursos (ex.: enquetes) do Baileys.
 * @async
 * @param {import('@whiskeysockets/baileys').WAMessageKey} key - Chave da mensagem.
 * @returns {Promise<import('@whiskeysockets/baileys').proto.IMessage | undefined>} Conteúdo da mensagem armazenada.
 */
async function getStoredMessage(key) {
  const messageId = key?.id;
  const remoteJid = key?.remoteJid;
  if (!messageId || !remoteJid) return undefined;

  try {
    const results = await findBy('messages', { message_id: messageId, chat_id: remoteJid }, { limit: 1 });
    const record = results?.[0];
    const stored = safeJsonParse(record?.raw_message, null);
    if (record?.raw_message && !stored) {
      logger.error('Falha ao interpretar raw_message armazenado.', {
        messageId,
        remoteJid,
      });
    }
    return stored?.message ?? undefined;
  } catch (error) {
    logger.error('Erro ao buscar mensagem armazenada no banco:', {
      error: error.message,
      messageId,
      remoteJid,
    });
    return undefined;
  }
}

const clearReconnectTimeout = () => {
  if (!reconnectTimeout) return;
  clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
};

const resetReconnectState = () => {
  connectionAttempts = 0;
  reconnectWindowStartedAt = 0;
};

const getNextReconnectAttempt = () => {
  const now = Date.now();
  if (!reconnectWindowStartedAt || now - reconnectWindowStartedAt >= BAILEYS_RECONNECT_ATTEMPT_RESET_MS) {
    reconnectWindowStartedAt = now;
    connectionAttempts = 0;
  }
  connectionAttempts += 1;
  return connectionAttempts;
};

const scheduleReconnect = (delay) => {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(
    () => {
      reconnectTimeout = null;
      connectToWhatsApp().catch((error) => {
        logger.error('Falha ao executar reconexão agendada.', {
          action: 'reconnect_schedule_failure',
          errorMessage: error?.message,
          stack: error?.stack,
          timestamp: new Date().toISOString(),
        });
      });
    },
    Math.max(0, Number(delay) || 0),
  );
};

const withTimeout = (promise, timeoutMs, timeoutLabel = 'operation_timeout') =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs);
    }),
  ]);

const syncGroupsOnConnectionOpen = async (sock) => {
  if (!GROUP_SYNC_ON_CONNECT) {
    logger.info('Sincronização de grupos no connect desativada por configuração.', {
      action: 'groups_sync_disabled',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const allGroups = await withTimeout(sock.groupFetchAllParticipating(), GROUP_SYNC_TIMEOUT_MS, `groups_sync_timeout_${GROUP_SYNC_TIMEOUT_MS}ms`);
  const allGroupEntries = Object.values(allGroups || {});
  const selectedGroups = GROUP_SYNC_MAX_GROUPS > 0 ? allGroupEntries.slice(0, GROUP_SYNC_MAX_GROUPS) : allGroupEntries;

  let syncedCount = 0;
  let failedCount = 0;

  for (let offset = 0; offset < selectedGroups.length; offset += GROUP_SYNC_BATCH_SIZE) {
    const batch = selectedGroups.slice(offset, offset + GROUP_SYNC_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((group) =>
        upsertGroupMetadata(group.id, buildGroupMetadataFromGroup(group), {
          mergeExisting: false,
        }).then((result) => {
          invalidateCachedGroupMetadata(group.id);
          return result;
        }),
      ),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') syncedCount += 1;
      else failedCount += 1;
    }
  }

  logger.info('📁 Metadados de grupos sincronizados com MySQL.', {
    action: 'groups_synced',
    totalFetched: allGroupEntries.length,
    totalSynced: syncedCount,
    totalFailed: failedCount,
    totalSkipped: Math.max(0, allGroupEntries.length - selectedGroups.length),
    batchSize: GROUP_SYNC_BATCH_SIZE,
    maxGroups: GROUP_SYNC_MAX_GROUPS > 0 ? GROUP_SYNC_MAX_GROUPS : null,
    timeoutMs: GROUP_SYNC_TIMEOUT_MS,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Inicia e gerencia a conexão com o WhatsApp usando o Baileys.
 * Configura autenticação, cria o socket e registra handlers de eventos.
 * @async
 * @returns {Promise<void>} Conclusão da inicialização e do registro de handlers.
 * @throws {Error} Lança erro se a conexão inicial falhar.
 */
export async function connectToWhatsApp() {
  if (connectPromise) {
    return connectPromise;
  }

  if (isSocketOpen(activeSocket)) {
    return;
  }

  logger.info('Iniciando conexão com o WhatsApp...', {
    action: 'connect_init',
    timestamp: new Date().toISOString(),
  });
  connectPromise = (async () => {
    clearReconnectTimeout();
    const generation = ++socketGeneration;
    const authPath = path.join(__dirname, 'auth');
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const version = await resolveBaileysVersion();

    logger.debug('Dados de autenticação carregados com sucesso.', {
      authPath,
      version,
      generation,
    });

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Desktop'),
      qrTimeout: 30000,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      msgRetryCounterCache,
      maxMsgRetryCount: 5,
      retryRequestDelayMs: 250,
      getMessage: getStoredMessage,
      userDevicesCache,
      mediaCache,
      cachedGroupMetadata: resolveCachedGroupMetadata,
      patchMessageBeforeSending,
      enableAutoSessionRecreation: BAILEYS_ENABLE_AUTO_SESSION_RECREATION,
      enableRecentMessageCache: BAILEYS_ENABLE_RECENT_MESSAGE_CACHE,
      generateHighQualityLinkPreview: BAILEYS_GENERATE_HIGH_QUALITY_LINK_PREVIEW,
    });

    activeSocket = sock;
    storeActiveSocket(sock);

    const isCurrentSocket = () => activeSocket === sock && generation === socketGeneration;

    sock.ev.on('creds.update', async () => {
      if (!isCurrentSocket()) return;
      logger.debug('Atualizando credenciais de autenticação...', {
        action: 'creds_update',
        timestamp: new Date().toISOString(),
      });
      await saveCreds();
    });

    sock.ev.on('connection.update', (update) => {
      if (!isCurrentSocket()) return;
      handleConnectionUpdate(update, sock);
      if (update.connection === 'open') {
        syncNewsBroadcastService();
      }
      logger.debug('Estado da conexão atualizado.', {
        action: 'connection_update',
        status: update.connection,
        lastDisconnect: update.lastDisconnect?.error?.message || null,
        isNewLogin: update.isNewLogin || false,
        timestamp: new Date().toISOString(),
      });
    });

    sock.ev.on('messages.upsert', (update) => {
      if (!isCurrentSocket()) return;
      const start = process.hrtime.bigint();
      const messagesCount = Array.isArray(update?.messages) ? update.messages.length : 0;
      const eventType = update?.type || 'unknown';
      try {
        logger.debug('Novo(s) evento(s) em messages.upsert', {
          action: 'messages_upsert',
          type: update.type,
          messagesCount: update.messages.length,
          remoteJid: update.messages[0]?.key.remoteJid || null,
        });
        const persistPromise = persistIncomingMessages(update.messages, update.type).catch((error) => {
          logger.error('Erro ao persistir mensagens no banco de dados:', {
            error: error.message,
          });
          recordError('messages_upsert');
        });
        const handlePromise = handleMessages(update, sock).catch((error) => {
          recordError('messages_upsert');
          throw error;
        });

        Promise.allSettled([persistPromise, handlePromise]).then((results) => {
          const ok = results.every((result) => result.status === 'fulfilled');
          const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
          recordMessagesUpsert({
            durationMs,
            type: eventType,
            messagesCount,
            ok,
          });
        });
      } catch (error) {
        logger.error('Erro no evento messages.upsert:', {
          error: error.message,
          stack: error.stack,
          action: 'messages_upsert_error',
        });
        recordError('messages_upsert');
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        recordMessagesUpsert({
          durationMs,
          type: eventType,
          messagesCount,
          ok: false,
        });
      }
    });

    sock.ev.on('chats.upsert', (newChats) => {
      if (!isCurrentSocket()) return;
      for (const chat of newChats) {
        queueChatUpdate(chat, { partial: false, forceName: true });
      }
    });

    sock.ev.on('chats.update', (updates) => {
      if (!isCurrentSocket()) return;
      for (const update of updates) {
        queueChatUpdate(update, { partial: true });
      }
    });

    sock.ev.on('chats.delete', (deletions) => {
      if (!isCurrentSocket()) return;
      for (const chatId of deletions) {
        remove('chats', chatId).catch((error) => {
          logger.error('Erro ao remover chat do banco:', {
            error: error.message,
            chatId,
          });
        });
      }
    });

    sock.ev.on('groups.upsert', async (newGroups) => {
      if (!isCurrentSocket()) return;
      for (const group of newGroups) {
        try {
          await upsertGroupMetadata(group.id, buildGroupMetadataFromGroup(group), {
            mergeExisting: false,
          });
          invalidateCachedGroupMetadata(group.id);
        } catch (error) {
          logger.error('Erro no upsert do grupo:', {
            error: error.message,
            groupId: group.id,
          });
        }
      }
    });

    sock.ev.on('contacts.update', (updates) => {
      if (!isCurrentSocket()) return;
      if (!Array.isArray(updates)) return;
      for (const update of updates) {
        try {
          const jidCandidate = update?.id || update?.jid || null;
          const lidCandidate = update?.lid || null;
          const jid = isWhatsAppUserId(jidCandidate) ? jidCandidate : null;
          const lid = isLidUserId(lidCandidate) ? lidCandidate : isLidUserId(jidCandidate) ? jidCandidate : null;
          if (lid) {
            queueLidUpdate(lid, jid, 'contacts');
          }
        } catch (error) {
          logger.warn('Falha ao processar contacts.update para lid_map.', { error: error.message });
        }
      }
    });

    sock.ev.on('lid-mapping.update', (update) => {
      if (!isCurrentSocket()) return;
      try {
        const lid = typeof update?.lid === 'string' ? update.lid : null;
        const pnJid = normalizePnToJid(update?.pn);
        if (!lid || !pnJid) return;
        queueLidUpdate(lid, pnJid, 'lid-mapping');
      } catch (error) {
        logger.warn('Falha ao processar lid-mapping.update para lid_map.', { error: error.message });
      }
    });

    sock.ev.on('messages.update', (update) => {
      if (!isCurrentSocket()) return;
      try {
        logger.debug('Atualização de mensagens recebida.', {
          action: 'messages_update',
          updatesCount: update.length,
        });
        handleMessageUpdate(update, sock);
      } catch (error) {
        logger.error('Erro no evento messages.update:', {
          error: error.message,
          stack: error.stack,
          action: 'messages_update_error',
        });
      }
    });

    sock.ev.on('messages.reaction', async (updates) => {
      if (!isCurrentSocket()) return;
      try {
        const reactions = Array.isArray(updates) ? updates : [updates];
        for (const update of reactions) {
          const key = update?.key || update?.msg?.key || update?.reaction?.key || null;
          const reaction = update?.reaction || update?.msg?.reaction || update?.reactionMessage || null;
          const reactedKey = reaction?.key || update?.reactedKey || update?.reactionMessage?.key || null;

          const groupId = key?.remoteJid || reactedKey?.remoteJid || null;
          const senderJid = key?.participant || update?.participant || reaction?.sender || null;
          const senderIdentity = {
            participant: key?.participant || update?.participant || reaction?.sender || null,
            participantAlt: key?.participantAlt || update?.participantAlt || reaction?.participantAlt || reaction?.key?.participantAlt || null,
            jid: senderJid,
          };
          const reactedMessageId = reactedKey?.id || null;
          const reactionText = typeof reaction?.text === 'string' ? reaction.text : '';

          if (groupId && (senderJid || senderIdentity.participantAlt)) {
            await resolveCaptchaByReaction({ groupId, senderJid, senderIdentity, reactedMessageId, reactionText });
          }
        }
      } catch (error) {
        logger.error('Erro no evento messages.reaction:', {
          error: error.message,
          stack: error.stack,
          action: 'messages_reaction_error',
        });
      }
    });

    sock.ev.on('groups.update', (updates) => {
      if (!isCurrentSocket()) return;
      try {
        logger.debug('Grupo(s) atualizado(s).', {
          action: 'groups_update',
          groupCount: updates.length,
          groupIds: updates.map((u) => u.id),
        });
        handleGroupUpdate(updates, sock);
      } catch (err) {
        logger.error('Erro no evento groups.update:', {
          error: err.message,
          stack: err.stack,
          action: 'groups_update_error',
        });
      }
    });

    sock.ev.on('group-participants.update', (update) => {
      if (!isCurrentSocket()) return;
      try {
        logger.debug('Participantes do grupo atualizados.', {
          action: 'group_participants_update',
          groupId: update.id,
          actionType: update.action,
          participants: update.participants,
        });
        invalidateCachedGroupMetadata(update.id);
        handleGroupParticipantsEvent(sock, update.id, update.participants, update.action);
      } catch (err) {
        logger.error('Erro no evento group-participants.update:', {
          error: err.message,
          stack: err.stack,
          action: 'group_participants_update_error',
        });
      }
    });

    sock.ev.on('group.join-request', (update) => {
      if (!isCurrentSocket()) return;
      try {
        logger.debug('Solicitação de entrada no grupo recebida.', {
          action: 'group_join_request',
          groupId: update?.id,
          participant: update?.participant,
          method: update?.method,
          joinAction: update?.action,
        });
        handleGroupJoinRequest(sock, update);
      } catch (err) {
        logger.error('Erro no evento group.join-request:', {
          error: err.message,
          stack: err.stack,
          action: 'group_join_request_error',
        });
      }
    });

    sock.ev.on('call', async (calls) => {
      if (!isCurrentSocket()) return;
      if (!BAILEYS_AUTO_REJECT_CALLS) return;
      if (!Array.isArray(calls)) return;

      for (const call of calls) {
        try {
          if (!call || call.status !== 'offer') continue;
          if (!call.id || !call.from) continue;

          const myJid = sock.user?.id || null;
          if (myJid && areJidsSameUser(call.from, myJid)) {
            continue;
          }

          await sock.rejectCall(call.id, call.from);
          logger.info('Chamada recebida rejeitada automaticamente.', {
            action: 'call_auto_reject',
            callId: call.id,
            from: call.from,
            isGroup: call.isGroup || false,
            isVideo: call.isVideo || false,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.warn('Falha ao rejeitar chamada automaticamente.', {
            action: 'call_auto_reject_failed',
            callId: call?.id || null,
            from: call?.from || null,
            error: error?.message,
          });
        }
      }
    });

    registerBaileysEventLoggers(sock);
    registerBaileysEventJournal(sock, generation);

    logger.info('Conexão com o WhatsApp estabelecida com sucesso.', {
      action: 'connect_success',
      generation,
      timestamp: new Date().toISOString(),
    });
  })();

  try {
    await connectPromise;
  } finally {
    connectPromise = null;
  }
}

/**
 * Gerencia atualizações de estado da conexão com o WhatsApp.
 * Lida com QR code, reconexão automática e ações pós-conexão (sync de grupos).
 * @async
 * @param {import('@whiskeysockets/baileys').ConnectionState} update - Estado da conexão.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instância do socket do WhatsApp.
 * @returns {Promise<void>} Conclusão do processamento do estado.
 */
async function handleConnectionUpdate(update, sock) {
  if (sock !== activeSocket) return;
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    logger.info('📱 QR Code gerado! Escaneie com seu WhatsApp.', {
      action: 'qr_code_generated',
      timestamp: new Date().toISOString(),
    });
    qrcode.generate(qr, { small: true });
  }

  if (connection === 'close') {
    const disconnectCode = lastDisconnect?.error?.output?.statusCode || 'unknown';
    const errorMessage = lastDisconnect?.error?.message || 'Sem mensagem de erro';

    const shouldReconnect = lastDisconnect?.error instanceof Boom && disconnectCode !== DisconnectReason.loggedOut;

    if (shouldReconnect) {
      const attempt = getNextReconnectAttempt();
      if (attempt <= MAX_CONNECTION_ATTEMPTS) {
        const reconnectDelay = INITIAL_RECONNECT_DELAY * Math.pow(2, attempt - 1);
        logger.warn(`⚠️ Conexão perdida. Tentando reconectar...`, {
          action: 'reconnect_attempt',
          attempt,
          maxAttempts: MAX_CONNECTION_ATTEMPTS,
          delay: reconnectDelay,
          reasonCode: disconnectCode,
          errorMessage,
          timestamp: new Date().toISOString(),
        });
        activeSocket = null;
        storeActiveSocket(null);
        scheduleReconnect(reconnectDelay);
      } else {
        logger.error('❌ Limite de tentativas atingido; aguardando janela para novo retry.', {
          action: 'reconnect_backoff_window',
          totalAttempts: attempt,
          maxAttempts: MAX_CONNECTION_ATTEMPTS,
          retryAfterMs: BAILEYS_RECONNECT_ATTEMPT_RESET_MS,
          reasonCode: disconnectCode,
          errorMessage,
          timestamp: new Date().toISOString(),
        });
        activeSocket = null;
        storeActiveSocket(null);
        connectionAttempts = 0;
        reconnectWindowStartedAt = Date.now();
        scheduleReconnect(BAILEYS_RECONNECT_ATTEMPT_RESET_MS);
      }
    } else {
      logger.error('❌ Conexão fechada definitivamente.', {
        action: 'connection_closed',
        reasonCode: disconnectCode,
        errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (connection === 'open') {
    logger.info('✅ Conectado com sucesso ao WhatsApp!', {
      action: 'connection_open',
      timestamp: new Date().toISOString(),
    });

    resetReconnectState();
    clearReconnectTimeout();

    if (process.send) {
      process.send('ready');
      logger.info('🟢 Sinal de "ready" enviado ao PM2.', {
        action: 'pm2_ready_signal',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      await syncGroupsOnConnectionOpen(sock);
    } catch (error) {
      logger.error('❌ Erro ao carregar metadados de grupos na conexão.', {
        action: 'groups_load_error',
        errorMessage: error.message,
        stack: error.stack,
        timeoutMs: GROUP_SYNC_TIMEOUT_MS,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

/**
 * Processa atualizações em mensagens existentes, como votos em enquetes.
 * @async
 * @param {Array<import('@whiskeysockets/baileys').MessageUpdate>} updates - Atualizações de mensagens.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instância do socket do WhatsApp.
 * @returns {Promise<void>} Conclusão do processamento das atualizações.
 */
async function handleMessageUpdate(updates, sock) {
  for (const { key, update } of updates) {
    if (update.pollUpdates) {
      try {
        const pollCreation = await sock.getMessage(key);

        if (pollCreation) {
          const aggregatedVotes = getAggregateVotesInPollMessage({
            message: pollCreation,
            pollUpdates: update.pollUpdates,
          });

          logger.info('📊 Votos da enquete atualizados.', {
            action: 'poll_votes_updated',
            remoteJid: key.remoteJid,
            messageId: key.id,
            participant: key.participant || null,
            votesCount: Object.values(aggregatedVotes || {}).reduce((a, b) => a + b, 0),
            votes: aggregatedVotes,
            timestamp: new Date().toISOString(),
          });
        } else {
          logger.warn('⚠️ Mensagem da enquete não encontrada.', {
            action: 'poll_message_not_found',
            key,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        logger.error('❌ Erro ao processar atualização de votos da enquete.', {
          action: 'poll_update_error',
          errorMessage: error.message,
          stack: error.stack,
          key,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

/**
 * Atualiza metadados de grupos no banco MySQL a partir dos eventos do Baileys.
 * @async
 * @param {Array<import('@whiskeysockets/baileys').GroupUpdate>} updates - Eventos de atualização de grupos.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instância do socket do WhatsApp.
 * @returns {Promise<void>} Conclusão das atualizações em lote.
 * @description
 * Processa alterações de grupo (título, descrição, proprietário e participantes)
 * persistindo a versão consolidada no MySQL.
 */
async function handleGroupUpdate(updates) {
  await Promise.all(
    updates.map(async (event) => {
      try {
        const groupId = event.id;
        const oldData = (await findById('groups_metadata', groupId)) || {};
        const updatedData = buildGroupMetadataFromUpdate(event, oldData);

        await upsertGroupMetadata(groupId, updatedData, { mergeExisting: false });
        invalidateCachedGroupMetadata(groupId);

        const changedFields = Object.keys(event).filter((k) => event[k] !== oldData[k]);
        logger.info('📦 Metadados do grupo atualizados', {
          action: 'group_metadata_updated',
          groupId,
          groupName: updatedData.subject || oldData.subject || 'Desconhecido',
          changedFields,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('❌ Erro ao atualizar metadados do grupo', {
          action: 'group_metadata_update_error',
          errorMessage: error.message,
          stack: error.stack,
          event,
          timestamp: new Date().toISOString(),
        });
      }
    }),
  );
}

/**
 * Retorna a instância atual do socket ativo do WhatsApp.
 * @returns {import('@whiskeysockets/baileys').WASocket | null} Socket ativo ou null.
 */
export function getActiveSocket() {
  logger.debug('🔍 Recuperando instância do socket ativo.', {
    action: 'get_active_socket',
    socketExists: !!activeSocket,
    timestamp: new Date().toISOString(),
  });
  return activeSocket;
}

/**
 * Executa método centralizado do socket ativo com mapeamento para erros HTTP.
 * @param {string} methodName Nome do método no socket.
 * @param {...any} args Argumentos repassados ao método.
 * @returns {Promise<any>}
 */
async function runControllerSocketMethod(methodName, ...args) {
  try {
    return await runActiveSocketMethod(methodName, ...args);
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('Socket do WhatsApp indisponível')) {
      logger.warn('Socket ativo indisponível para operação.', {
        action: methodName,
        socketExists: !!activeSocket,
        socketOpen: isSocketOpen(activeSocket),
        timestamp: new Date().toISOString(),
      });
      throw new Boom('Socket do WhatsApp indisponível no momento.', { statusCode: 503 });
    }
    if (message.includes('não disponível no socket')) {
      throw new Boom(`Método "${methodName}" não disponível neste socket.`, { statusCode: 501 });
    }
    throw error;
  }
}

/**
 * Retorna as configurações de privacidade da conta.
 * @param {boolean} [force=false] Força refresh no servidor.
 * @returns {Promise<Record<string, string>>}
 */
export async function fetchPrivacySettings(force = false) {
  return runControllerSocketMethod('fetchPrivacySettings', force);
}

/**
 * Atualiza privacidade de mensagens.
 * @param {import('@whiskeysockets/baileys').WAPrivacyMessagesValue} value
 * @returns {Promise<void>}
 */
export async function updateMessagesPrivacy(value) {
  return runControllerSocketMethod('updateMessagesPrivacy', value);
}

/**
 * Atualiza privacidade de chamadas.
 * @param {import('@whiskeysockets/baileys').WAPrivacyCallValue} value
 * @returns {Promise<void>}
 */
export async function updateCallPrivacy(value) {
  return runControllerSocketMethod('updateCallPrivacy', value);
}

/**
 * Atualiza privacidade de visto por último.
 * @param {import('@whiskeysockets/baileys').WAPrivacyValue} value
 * @returns {Promise<void>}
 */
export async function updateLastSeenPrivacy(value) {
  return runControllerSocketMethod('updateLastSeenPrivacy', value);
}

/**
 * Atualiza privacidade de online.
 * @param {import('@whiskeysockets/baileys').WAPrivacyOnlineValue} value
 * @returns {Promise<void>}
 */
export async function updateOnlinePrivacy(value) {
  return runControllerSocketMethod('updateOnlinePrivacy', value);
}

/**
 * Atualiza privacidade da foto de perfil.
 * @param {import('@whiskeysockets/baileys').WAPrivacyValue} value
 * @returns {Promise<void>}
 */
export async function updateProfilePicturePrivacy(value) {
  return runControllerSocketMethod('updateProfilePicturePrivacy', value);
}

/**
 * Atualiza privacidade de status.
 * @param {import('@whiskeysockets/baileys').WAPrivacyValue} value
 * @returns {Promise<void>}
 */
export async function updateStatusPrivacy(value) {
  return runControllerSocketMethod('updateStatusPrivacy', value);
}

/**
 * Atualiza configuração de confirmação de leitura.
 * @param {import('@whiskeysockets/baileys').WAReadReceiptsValue} value
 * @returns {Promise<void>}
 */
export async function updateReadReceiptsPrivacy(value) {
  return runControllerSocketMethod('updateReadReceiptsPrivacy', value);
}

/**
 * Atualiza privacidade para adição em grupos.
 * @param {import('@whiskeysockets/baileys').WAPrivacyGroupAddValue} value
 * @returns {Promise<void>}
 */
export async function updateGroupsAddPrivacy(value) {
  return runControllerSocketMethod('updateGroupsAddPrivacy', value);
}

/**
 * Atualiza privacidade de pré-visualização de links.
 * @param {boolean} isPreviewsDisabled
 * @returns {Promise<void>}
 */
export async function updateDisableLinkPreviewsPrivacy(isPreviewsDisabled) {
  return runControllerSocketMethod('updateDisableLinkPreviewsPrivacy', isPreviewsDisabled);
}

/**
 * Atualiza modo padrão de mensagens temporárias.
 * @param {number} duration Duração em segundos.
 * @returns {Promise<void>}
 */
export async function updateDefaultDisappearingMode(duration) {
  return runControllerSocketMethod('updateDefaultDisappearingMode', duration);
}

/**
 * Envia atualização de presença.
 * @param {import('@whiskeysockets/baileys').WAPresence} type
 * @param {string} [toJid]
 * @returns {Promise<void>}
 */
export async function sendPresenceUpdate(type, toJid) {
  return runControllerSocketMethod('sendPresenceUpdate', type, toJid);
}

/**
 * Inscreve presença de um JID.
 * @param {string} toJid
 * @returns {Promise<void>}
 */
export async function presenceSubscribe(toJid) {
  return runControllerSocketMethod('presenceSubscribe', toJid);
}

/**
 * Executa alteração de chat via app patch.
 * @param {import('@whiskeysockets/baileys').ChatModification} mod
 * @param {string} jid
 * @returns {Promise<void>}
 */
export async function chatModify(mod, jid) {
  return runControllerSocketMethod('chatModify', mod, jid);
}

/**
 * Atalho para arquivar/desarquivar chat.
 * @param {string} jid
 * @param {Array<import('@whiskeysockets/baileys').proto.IWebMessageInfo>} [lastMessages=[]]
 * @param {boolean} [archive=true]
 * @returns {Promise<void>}
 */
export async function setChatArchived(jid, lastMessages = [], archive = true) {
  return chatModify({ archive, lastMessages }, jid);
}

/**
 * Atalho para marcar chat como lido/não lido.
 * @param {string} jid
 * @param {Array<import('@whiskeysockets/baileys').proto.IWebMessageInfo>} [lastMessages=[]]
 * @param {boolean} [markRead=true]
 * @returns {Promise<void>}
 */
export async function setChatRead(jid, lastMessages = [], markRead = true) {
  return chatModify({ markRead, lastMessages }, jid);
}

/**
 * Atalho para mutar/desmutar chat.
 * @param {string} jid
 * @param {number|null} muteMs Use `null` para desmutar.
 * @returns {Promise<void>}
 */
export async function setChatMute(jid, muteMs) {
  return chatModify({ mute: muteMs }, jid);
}

/**
 * Busca histórico de mensagens sob demanda (até 50 por consulta).
 * @param {number} count Quantidade solicitada.
 * @param {import('@whiskeysockets/baileys').WAMessageKey} oldestMsgKey Chave da mensagem mais antiga.
 * @param {number|import('long').default} oldestMsgTimestamp Timestamp da mensagem mais antiga.
 * @returns {Promise<string>} Request id da operação.
 */
export async function fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp) {
  return runControllerSocketMethod('fetchMessageHistory', count, oldestMsgKey, oldestMsgTimestamp);
}

/**
 * Solicita resend de placeholder para mensagem indisponível.
 * @param {import('@whiskeysockets/baileys').WAMessageKey} messageKey Chave da mensagem.
 * @param {Partial<import('@whiskeysockets/baileys').WAMessage>} [msgData] Dados auxiliares.
 * @returns {Promise<string|undefined>}
 */
export async function requestPlaceholderResend(messageKey, msgData) {
  return runControllerSocketMethod('requestPlaceholderResend', messageKey, msgData);
}

/**
 * Rejeita chamada recebida.
 * @param {string} callId ID da chamada.
 * @param {string} callFrom JID de origem da chamada.
 * @returns {Promise<void>}
 */
export async function rejectCall(callId, callFrom) {
  return runControllerSocketMethod('rejectCall', callId, callFrom);
}

/**
 * Força uma nova tentativa de conexão ao WhatsApp.
 * Encerra o socket atual (se existir) para disparar a lógica de reconexão.
 * @async
 * @returns {Promise<void>} Conclusão do fluxo de reconexão.
 */
export async function reconnectToWhatsApp() {
  // eslint-disable-next-line no-undef
  if (activeSocket && activeSocket.ws?.readyState === WebSocket.OPEN) {
    logger.info('♻️ Forçando fechamento do socket para reconectar...', {
      action: 'force_reconnect',
      timestamp: new Date().toISOString(),
    });
    activeSocket.ws.close();
  } else {
    logger.warn('⚠️ Nenhum socket ativo detectado. Iniciando nova conexão manualmente.', {
      action: 'reconnect_no_active_socket',
      timestamp: new Date().toISOString(),
    });
    await connectToWhatsApp();
  }
}

if (process.argv[1] === __filename) {
  logger.info('🚀 Socket Controller iniciado diretamente via CLI.', {
    action: 'module_direct_execution',
    timestamp: new Date().toISOString(),
  });

  connectToWhatsApp().catch((err) => {
    logger.error('❌ Falha crítica ao tentar iniciar conexão via execução direta.', {
      action: 'direct_connection_failure',
      errorMessage: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
    });
    process.exit(1);
  });
}
