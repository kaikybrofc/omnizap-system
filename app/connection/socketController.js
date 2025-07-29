/**
 * OmniZap WhatsApp Connection Controller
 *
 * Refatorado para seguir o padrão do Baileys
 * Utiliza eventos globais para comunicação
 *
 * @version 2.0.0
 * @license MIT
 * @source https://github.com/Kaikygr/omnizap-system
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  getAggregateVotesInPollMessage,
} = require('@whiskeysockets/baileys');

const store = require('../store/dataStore');
const groupConfigStore = require('../store/groupConfigStore');

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');

const pino = require('pino');
const logger = require('../utils/logger/loggerModule');
const { handleWhatsAppUpdate } = require('../controllers/messageController');
const { handleGenericUpdate } = require('../controllers/eventHandler');
const {
  handleGroupUpdate: handleGroupParticipantsEvent,
} = require('../modules/adminModule/groupEventHandlers');
const { getSystemMetrics } = require('../utils/systemMetrics/systemMetricsModule');

let activeSocket = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 3000;

async function connectToWhatsApp() {
  logger.info('Iniciando conexão com o WhatsApp...', {
    action: 'connect_init',
    timestamp: new Date().toISOString(),
  });

  connectionAttempts = 0;

  const authPath = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  await store.loadData();
  await groupConfigStore.loadData();
  const version = [6, 7, 0];

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
    markOnlineOnConnect: false,
    getMessage: async (key) =>
      (store.messages[key.remoteJid] || []).find((m) => m.key.id === key.id),
  });

  store.bind(sock.ev);

  activeSocket = sock;

  sock.ev.on('creds.update', async () => {
    logger.debug('Atualizando credenciais de autenticação...', {
      action: 'creds_update',
      timestamp: new Date().toISOString(),
    });
    await saveCreds();
  });

  sock.ev.on('connection.update', (update) => {
    handleConnectionUpdate(update, sock);
    logger.debug('Estado da conexão atualizado.', {
      action: 'connection_update',
      status: update.connection,
      lastDisconnect: update.lastDisconnect?.error?.message || null,
      isNewLogin: update.isNewLogin || false,
      timestamp: new Date().toISOString(),
    });
  });

  sock.ev.on('messages.upsert', (update) => {
    try {
      logger.debug('Novo(s) evento(s) em messages.upsert', {
        action: 'messages_upsert',
        type: update.type,
        messagesCount: update.messages.length,
        remoteJid: update.messages[0]?.key.remoteJid || null,
      });
      handleWhatsAppUpdate(update, sock);
    } catch (error) {
      logger.error('Erro no evento messages.upsert:', {
        error: error.message,
        stack: error.stack,
        action: 'messages_upsert_error',
      });
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

  sock.ev.on('all', (event) => {
    try {
      logger.debug('Evento genérico recebido.', {
        action: 'generic_event',
        eventType: event.event,
      });
      handleGenericUpdate(event);
    } catch (err) {
      logger.error('Erro no evento genérico (all):', {
        error: err.message,
        stack: err.stack,
        action: 'generic_event_error',
      });
    }
  });

  logger.info('Conexão com o WhatsApp estabelecida com sucesso.', {
    action: 'connect_success',
    timestamp: new Date().toISOString(),
  });
}

async function handleConnectionUpdate(update, sock) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    logger.info('📱 QR Code gerado! Escaneie com seu WhatsApp:', {
      action: 'qr_code_generated',
    });
    qrcode.generate(qr, { small: true });
  }

  if (connection === 'close') {
    const shouldReconnect =
      lastDisconnect?.error instanceof Boom &&
      lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;

    if (shouldReconnect && connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      connectionAttempts++;
      const reconnectDelay = INITIAL_RECONNECT_DELAY * Math.pow(2, connectionAttempts - 1);
      logger.warn(
        `Conexão perdida. Tentando reconectar em ${
          reconnectDelay / 1000
        }s... (Tentativa ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`,
        {
          action: 'reconnect_attempt',
          attempt: connectionAttempts,
          maxAttempts: MAX_CONNECTION_ATTEMPTS,
          delay: reconnectDelay,
          reason: lastDisconnect?.error?.output?.statusCode || 'unknown',
        },
      );
      setTimeout(connectToWhatsApp, reconnectDelay);
    } else if (shouldReconnect) {
      logger.error('❌ Falha ao reconectar após várias tentativas. Reinicie a aplicação.', {
        action: 'reconnect_failed',
        reason: lastDisconnect?.error?.output?.statusCode || 'unknown',
      });
    } else {
      logger.error('❌ Conexão fechada. Motivo:', {
        action: 'connection_closed',
        reason: lastDisconnect?.error?.output?.statusCode || 'unknown',
        error: lastDisconnect?.error?.message,
      });
    }
  }
  if (connection === 'open') {
    logger.info('✅ Conectado com sucesso ao WhatsApp!', {
      action: 'connection_open',
    });
    connectionAttempts = 0;
    if (process.send) {
      process.send('ready');
      logger.info('Sinal de "ready" enviado ao PM2.');
    }
    setInterval(() => {
      const metrics = getSystemMetrics();
      logger.info('System Metrics', metrics);
    }, 60000);

    try {
      const allGroups = await sock.groupFetchAllParticipating();
      for (const group of Object.values(allGroups)) {
        store.groups[group.id] = group;
      }
      store.debouncedWrite('groups');
      logger.info(`Metadados de ${Object.keys(allGroups).length} grupos carregados e salvos.`, {
        action: 'groups_loaded',
        count: Object.keys(allGroups).length,
      });
    } catch (error) {
      logger.error('Erro ao carregar metadados de grupos na conexão:', {
        error: error.message,
        stack: error.stack,
        action: 'groups_load_error',
      });
    }
  }
}

async function handleMessageUpdate(updates, sock) {
  for (const { key, update } of updates) {
    if (update.pollUpdates) {
      const pollCreation = await sock.getMessage(key);
      if (pollCreation) {
        const aggregatedVotes = getAggregateVotesInPollMessage({
          message: pollCreation,
          pollUpdates: update.pollUpdates,
        });
        logger.info('Votos da enquete atualizados:', {
          action: 'poll_votes_updated',
          key: key,
          aggregatedVotes: aggregatedVotes,
        });
      }
    }
  }
}

async function handleGroupUpdate(updates, sock) {
  for (const event of updates) {
    if (store.groups[event.id]) {
      Object.assign(store.groups[event.id], event);
    } else {
      store.groups[event.id] = event;
    }
    store.debouncedWrite('groups');
    logger.info(`Metadados do grupo ${event.id} atualizados.`, {
      action: 'group_metadata_updated',
      groupId: event.id,
    });
  }
}

/**
 * Retorna a instância do socket ativo.
 * @returns {import('@whiskeysockets/baileys').WASocket | null}
 */
function getActiveSocket() {
  return activeSocket;
}

/**
 * Força reconexão ao WhatsApp
 */
async function reconnectToWhatsApp() {
  if (activeSocket) {
    logger.info('Forçando o fechamento do socket para acionar a lógica de reconexão...');
    activeSocket.ws.close();
  } else {
    logger.warn('Tentativa de reconectar sem um socket ativo. Iniciando uma nova conexão.');
    await connectToWhatsApp();
  }
}

module.exports = {
  connectToWhatsApp,
  reconnectToWhatsApp,
  getActiveSocket,
};

if (require.main === module) {
  logger.info('🔌 Socket Controller executado diretamente. Iniciando conexão...');
  connectToWhatsApp().catch((err) => {
    logger.error('❌ Falha catastrófica ao iniciar a conexão diretamente do Socket Controller.', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });
}
