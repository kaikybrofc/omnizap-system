import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, getAggregateVotesInPollMessage } from '@whiskeysockets/baileys';

import NodeCache from 'node-cache';
import { resolveBaileysVersion } from '../config/baileysConfig.js';

import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'node:path';

import pino from 'pino';
import logger from '../utils/logger/loggerModule.js';
import { handleMessages } from '../controllers/messageController.js';
import { syncNewsBroadcastService } from '../services/newsBroadcastService.js';
import { setActiveSocket as storeActiveSocket } from '../services/socketState.js';
import { recordError, recordMessagesUpsert } from '../observability/metrics.js';
import { resolveCaptchaByReaction } from '../services/captchaService.js';

import { handleGroupUpdate as handleGroupParticipantsEvent, handleGroupJoinRequest } from '../modules/adminModule/groupEventHandlers.js';

import { findBy, findById, remove } from '../../database/index.js';
import { extractSenderInfoFromMessage, primeLidCache, resolveUserIdCached, isLidUserId, isWhatsAppUserId } from '../services/lidMapService.js';
import { queueChatUpdate, queueLidUpdate, queueMessageInsert } from '../services/dbWriteQueue.js';
import { buildGroupMetadataFromGroup, buildGroupMetadataFromUpdate, upsertGroupMetadata } from '../services/groupMetadataService.js';
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

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const MSG_RETRY_CACHE_TTL_SECONDS = parseEnvInt(process.env.BAILEYS_MSG_RETRY_CACHE_TTL_SECONDS, 600, 60, 24 * 60 * 60);
const MSG_RETRY_CACHE_CHECKPERIOD_SECONDS = parseEnvInt(process.env.BAILEYS_MSG_RETRY_CACHE_CHECKPERIOD_SECONDS, 120, 30, 3600);
const BAILEYS_EVENT_LOG_ENABLED = parseEnvBool(process.env.BAILEYS_EVENT_LOG_ENABLED, !IS_PRODUCTION);
const BAILEYS_RECONNECT_ATTEMPT_RESET_MS = parseEnvInt(
  process.env.BAILEYS_RECONNECT_ATTEMPT_RESET_MS,
  10 * 60 * 1000,
  60 * 1000,
  24 * 60 * 60 * 1000,
);
const GROUP_SYNC_ON_CONNECT = parseEnvBool(process.env.GROUP_SYNC_ON_CONNECT, true);
const GROUP_SYNC_TIMEOUT_MS = parseEnvInt(process.env.GROUP_SYNC_TIMEOUT_MS, 30 * 1000, 5 * 1000, 120 * 1000);
const GROUP_SYNC_MAX_GROUPS = parseEnvInt(process.env.GROUP_SYNC_MAX_GROUPS, 0, 0, 10_000);
const GROUP_SYNC_BATCH_SIZE = parseEnvInt(process.env.GROUP_SYNC_BATCH_SIZE, 50, 1, 1000);

let activeSocket = null;
let connectionAttempts = 0;
let reconnectWindowStartedAt = 0;
const msgRetryCounterCache = new NodeCache({
  stdTTL: MSG_RETRY_CACHE_TTL_SECONDS,
  checkperiod: MSG_RETRY_CACHE_CHECKPERIOD_SECONDS,
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
  const eventsToLog = BAILEYS_EVENT_NAMES.filter(
    (eventName) => !BAILEYS_EVENTS_WITH_INTERNAL_LOG.has(eventName) && shouldLogBaileysEvent(eventName),
  );

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

const isSocketOpen = (socket) => {
  if (!socket?.ws) return false;
  if (typeof socket.ws.isOpen === 'boolean') return socket.ws.isOpen;
  return socket.ws.readyState === 1;
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

  const allGroups = await withTimeout(
    sock.groupFetchAllParticipating(),
    GROUP_SYNC_TIMEOUT_MS,
    `groups_sync_timeout_${GROUP_SYNC_TIMEOUT_MS}ms`,
  );
  const allGroupEntries = Object.values(allGroups || {});
  const selectedGroups =
    GROUP_SYNC_MAX_GROUPS > 0
      ? allGroupEntries.slice(0, GROUP_SYNC_MAX_GROUPS)
      : allGroupEntries;

  let syncedCount = 0;
  let failedCount = 0;

  for (let offset = 0; offset < selectedGroups.length; offset += GROUP_SYNC_BATCH_SIZE) {
    const batch = selectedGroups.slice(offset, offset + GROUP_SYNC_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((group) =>
        upsertGroupMetadata(group.id, buildGroupMetadataFromGroup(group), {
          mergeExisting: false,
        })),
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

    registerBaileysEventLoggers(sock);

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
