import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  getAggregateVotesInPollMessage,
} from '@whiskeysockets/baileys';

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

import { handleGroupUpdate as handleGroupParticipantsEvent } from '../modules/adminModule/groupEventHandlers.js';

import { findBy, findById, remove } from '../../database/index.js';
import {
  extractSenderInfoFromMessage,
  primeLidCache,
  resolveUserIdCached,
  isLidUserId,
  isWhatsAppUserId,
} from '../services/lidMapService.js';
import { queueChatUpdate, queueLidUpdate, queueMessageInsert } from '../services/dbWriteQueue.js';
import {
  buildGroupMetadataFromGroup,
  buildGroupMetadataFromUpdate,
  upsertGroupMetadata,
} from '../services/groupMetadataService.js';
import { buildMessageData } from '../services/messagePersistenceService.js';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let activeSocket = null;
let connectionAttempts = 0;
const msgRetryCounterCache = new NodeCache();
const MAX_CONNECTION_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 3000;
const BAILEYS_EVENT_NAMES = [
  'connection.update',
  'creds.update',
  'messaging-history.set',
  'chats.upsert',
  'chats.update',
  'lid-mapping.update',
  'chats.delete',
  'presence.update',
  'contacts.upsert',
  'contacts.update',
  'messages.delete',
  'messages.update',
  'messages.media-update',
  'messages.upsert',
  'messages.reaction',
  'message-receipt.update',
  'groups.upsert',
  'groups.update',
  'group-participants.update',
  'group.join-request',
  'group.member-tag.update',
  'blocklist.set',
  'blocklist.update',
  'call',
  'labels.edit',
  'labels.association',
  'newsletter.reaction',
  'newsletter.view',
  'newsletter-participants.update',
  'newsletter-settings.update',
  'chats.lock',
  'settings.update',
];
const BAILEYS_EVENTS_WITH_INTERNAL_LOG = new Set([
  'creds.update',
  'connection.update',
  'messages.upsert',
  'messages.update',
  'groups.update',
  'group-participants.update',
]);

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
      summary.jid = payload.jid ?? null;
      break;
    default:
      break;
  }

  return summary;
};

const registerBaileysEventLoggers = (sock) => {
  const eventsToLog = BAILEYS_EVENT_NAMES.filter((eventName) => !BAILEYS_EVENTS_WITH_INTERNAL_LOG.has(eventName));

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

/**
 * Inicia e gerencia a conexão com o WhatsApp usando o Baileys.
 * Configura autenticação, cria o socket e registra handlers de eventos.
 * @async
 * @returns {Promise<void>} Conclusão da inicialização e do registro de handlers.
 * @throws {Error} Lança erro se a conexão inicial falhar.
 */
export async function connectToWhatsApp() {
  logger.info('Iniciando conexão com o WhatsApp...', {
    action: 'connect_init',
    timestamp: new Date().toISOString(),
  });

  connectionAttempts = 0;

  const authPath = path.join(__dirname, 'auth');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const version = await resolveBaileysVersion();

  logger.debug('Dados de autenticação carregados com sucesso.', {
    authPath,
    version,
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

  sock.ev.on('creds.update', async () => {
    logger.debug('Atualizando credenciais de autenticação...', {
      action: 'creds_update',
      timestamp: new Date().toISOString(),
    });
    await saveCreds();
  });

  sock.ev.on('connection.update', (update) => {
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
    for (const chat of newChats) {
      queueChatUpdate(chat, { partial: false, forceName: true });
    }
  });

  sock.ev.on('chats.update', (updates) => {
    for (const update of updates) {
      queueChatUpdate(update, { partial: true });
    }
  });

  sock.ev.on('chats.delete', (deletions) => {
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

  sock.ev.on('messages.update', (update) => {
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

  sock.ev.on('groups.update', (updates) => {
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

  registerBaileysEventLoggers(sock);

  logger.info('Conexão com o WhatsApp estabelecida com sucesso.', {
    action: 'connect_success',
    timestamp: new Date().toISOString(),
  });
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

    if (shouldReconnect && connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      connectionAttempts++;
      const reconnectDelay = INITIAL_RECONNECT_DELAY * Math.pow(2, connectionAttempts - 1);
      logger.warn(`⚠️ Conexão perdida. Tentando reconectar...`, {
        action: 'reconnect_attempt',
        attempt: connectionAttempts,
        maxAttempts: MAX_CONNECTION_ATTEMPTS,
        delay: reconnectDelay,
        reasonCode: disconnectCode,
        errorMessage,
        timestamp: new Date().toISOString(),
      });
      setTimeout(connectToWhatsApp, reconnectDelay);
    } else if (shouldReconnect) {
      logger.error('❌ Falha ao reconectar após várias tentativas. Reinicie a aplicação.', {
        action: 'reconnect_failed',
        totalAttempts: connectionAttempts,
        reasonCode: disconnectCode,
        errorMessage,
        timestamp: new Date().toISOString(),
      });
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

    connectionAttempts = 0;

    if (process.send) {
      process.send('ready');
      logger.info('🟢 Sinal de "ready" enviado ao PM2.', {
        action: 'pm2_ready_signal',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const allGroups = await sock.groupFetchAllParticipating();

      for (const group of Object.values(allGroups)) {
        await upsertGroupMetadata(group.id, buildGroupMetadataFromGroup(group), {
          mergeExisting: false,
        });
      }

      logger.info(`📁 Metadados de ${Object.keys(allGroups).length} grupos sincronizados com MySQL.`, {
        action: 'groups_synced',
        count: Object.keys(allGroups).length,
        groupIds: Object.keys(allGroups),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('❌ Erro ao carregar metadados de grupos na conexão.', {
        action: 'groups_load_error',
        errorMessage: error.message,
        stack: error.stack,
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
