const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, getAggregateVotesInPollMessage } = require('@whiskeysockets/baileys');

const store = require('../store/dataStore');
const groupConfigStore = require('../store/groupConfigStore');
const { resolveBaileysVersion } = require('../config/baileysConfig');

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');

const pino = require('pino');
const logger = require('../utils/logger/loggerModule');
const { handleMessages } = require('../controllers/messageController');

const { handleGroupUpdate: handleGroupParticipantsEvent } = require('../modules/adminModule/groupEventHandlers');

let activeSocket = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 3000;

/**
 * Inicia e gerencia a conexão com o WhatsApp.
 * Configura autenticação, carrega dados, cria o socket e registra os handlers de eventos.
 * @async
 * @throws {Error} Lança um erro se a carga inicial de dados do MySQL falhar.
 */
async function connectToWhatsApp() {
  logger.info('Iniciando conexão com o WhatsApp...', {
    action: 'connect_init',
    timestamp: new Date().toISOString(),
  });

  connectionAttempts = 0;

  const authPath = path.join(__dirname, 'auth');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  logger.info('Carregando dados do MySQL para o cache em memória...', {
    action: 'mysql_cache_load',
    timestamp: new Date().toISOString(),
  });

  try {
    const { findAll } = require('../../database/queries');
    const groups = await findAll('groups_metadata');
    for (const group of groups) {
      let parsedParticipants = [];
      try {
        if (typeof group.participants === 'string') {
          parsedParticipants = JSON.parse(group.participants);
        } else if (Array.isArray(group.participants)) {
          parsedParticipants = group.participants;
        }
      } catch (parseError) {
        logger.warn(`Erro ao fazer parse dos participantes do grupo ${group.id}:`, {
          error: parseError.message,
          participants: group.participants,
        });
      }

      store.groups[group.id] = {
        ...group,
        participants: parsedParticipants,
      };
    }
    logger.info(`Cache de grupos carregado com sucesso (${groups.length} grupos)`, {
      action: 'mysql_cache_load_success',
      groupCount: groups.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Erro catastrófico ao carregar dados do MySQL para o store:', error);
    throw error;
  }

  await groupConfigStore.loadData();
  const version = await resolveBaileysVersion();

  logger.debug('Dados de autenticação carregados com sucesso.', {
    authPath,
    version,
  });

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: process.env.NODE_ENV === 'production' ? 'silent' : 'trace' }),
    browser: Browsers.macOS('Desktop'),
    qrTimeout: 30000,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    getMessage: async (key) => (store.messages[key.remoteJid] || []).find((m) => m.key.id === key.id),
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
      handleMessages(update, sock);
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

  logger.info('Conexão com o WhatsApp estabelecida com sucesso.', {
    action: 'connect_success',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Gerencia as atualizações de estado da conexão com o WhatsApp.
 * Lida com a geração de QR code, reconexão automática e ações pós-conexão.
 * @async
 * @param {import('@whiskeysockets/baileys').ConnectionState} update - O objeto de atualização da conexão.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - A instância do socket do WhatsApp.
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
      const { upsert } = require('../../database/queries');

      for (const group of Object.values(allGroups)) {
        const participantsData = Array.isArray(group.participants)
          ? group.participants.map((p) => ({
              id: p.id,
              jid: p.jid || p.id,
              lid: p.lid || null,
              admin: p.admin,
            }))
          : [];

        await upsert('groups_metadata', {
          id: group.id,
          subject: group.subject,
          description: group.desc,
          owner_jid: group.owner,
          creation: group.creation,
          participants: JSON.stringify(participantsData),
        });

        store.groups[group.id] = group;
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
 * @param {Array<import('@whiskeysockets/baileys').MessageUpdate>} updates - Um array de atualizações de mensagens.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - A instância do socket do WhatsApp.
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
 * Converte a lista de participantes de uma string JSON para um array.
 * @param {string | Array<Object>} participants - Os participantes em formato de string JSON ou array.
 * @returns {Array<Object>} Um array de objetos de participantes.
 */
function parseParticipants(participants) {
  if (!participants) return [];
  try {
    if (typeof participants === 'string') return JSON.parse(participants);
    if (Array.isArray(participants)) return participants;
  } catch (err) {
    logger.warn('Erro ao fazer parse dos participantes:', { error: err.message });
  }
  return [];
}

/**
 * Atualiza os metadados de grupos no banco de dados MySQL e no cache em memória.
 *
 * @async
 * @param {Array<import('@whiskeysockets/baileys').GroupUpdate>} updates - Array de eventos de atualização de grupos.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instância do socket do WhatsApp.
 * @description
 * Esta função processa atualizações de grupos, como:
 * - Mudanças no título do grupo
 * - Alterações na descrição
 * - Mudanças no proprietário
 * - Atualizações nos participantes
 *
 * Os dados são persistidos no MySQL e também atualizados no cache em memória (store.groups)
 */
async function handleGroupUpdate(updates, sock) {
  await Promise.all(
    updates.map(async (event) => {
      try {
        const { upsert, findById } = require('../../database/queries');
        const groupId = event.id;
        const oldData = (await findById('groups_metadata', groupId)) || {};
        const currentData = store.groups[groupId] || {};

        const currentParticipants = parseParticipants(currentData.participants);
        const participantsData = (event.participants || currentParticipants).map((p) => ({
          id: p.id || null,
          jid: p.jid || p.id || null,
          lid: p.lid || null,
          admin: p.admin || null,
        }));

        const updatedData = {
          id: groupId,
          subject: event.subject ?? currentData.subject ?? oldData.subject,
          description: event.desc ?? currentData.desc ?? oldData.description,
          owner_jid: event.owner ?? currentData.owner ?? oldData.owner_jid,
          creation: event.creation ?? currentData.creation ?? oldData.creation,
          participants: participantsData,
        };

        await upsert('groups_metadata', updatedData);
        store.groups[groupId] = updatedData;

        const changedFields = Object.keys(event).filter((k) => event[k] !== oldData[k]);
        logger.info('📦 Metadados do grupo atualizados', {
          action: 'group_metadata_updated',
          groupId,
          groupName: updatedData.subject || 'Desconhecido',
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
 * 🔌 Retorna a instância atual do socket ativo do WhatsApp.
 * @returns {import('@whiskeysockets/baileys').WASocket | null}
 */
function getActiveSocket() {
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
 */
async function reconnectToWhatsApp() {
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

module.exports = {
  connectToWhatsApp,
  reconnectToWhatsApp,
  getActiveSocket,
};

if (require.main === module) {
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
