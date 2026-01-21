import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  getAggregateVotesInPollMessage
} from '@whiskeysockets/baileys';

import { resolveBaileysVersion } from '../config/baileysConfig.js';

import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'node:path';

import pino from 'pino';
import logger from '../utils/logger/loggerModule.js';
import { handleMessages } from '../controllers/messageController.js';

import {
  handleGroupUpdate as handleGroupParticipantsEvent
} from '../modules/adminModule/groupEventHandlers.js';

import {
  create,
  findBy,
  findById,
  remove,
  upsert,
} from '../../database/index.js';

import { fileURLToPath } from 'node:url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


let activeSocket = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 3000;

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

const buildMessageData = (msg) => ({
  message_id: msg.key.id,
  chat_id: msg.key.remoteJid,
  sender_id: msg.key.participant || msg.key.remoteJid,
  content: msg.message.conversation || msg.message.extendedTextMessage?.text || null,
  raw_message: JSON.stringify(msg || {}),
  timestamp: new Date(Number(msg.messageTimestamp) * 1000),
});

async function persistIncomingMessages(incomingMessages, type) {
  if (type !== 'append' && type !== 'notify') return;

  for (const msg of incomingMessages) {
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

    const messageData = buildMessageData(msg);
    try {
      await create('messages', messageData);
    } catch (err) {
      const errorCode = err.code || err.errorCode;
      if (errorCode !== 'ER_DUP_ENTRY') {
        logger.error(`Erro ao salvar mensagem ${msg.key.id} no banco de dados:`, err);
      }
    }
  }
}

async function getStoredMessage(key) {
  try {
    const results = await findBy('messages', { message_id: key.id }, { limit: 1 });
    const record = results?.[0];
    return safeJsonParse(record?.raw_message, null);
  } catch (error) {
    logger.error('Erro ao buscar mensagem armazenada no banco:', {
      error: error.message,
      messageId: key.id,
    });
    return null;
  }
}

/**
 * Inicia e gerencia a conexão com o WhatsApp.
 * Configura autenticação, carrega dados, cria o socket e registra os handlers de eventos.
 * @async
 * @throws {Error} Lança um erro se a carga inicial de dados do MySQL falhar.
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
    logger: pino({ level: process.env.NODE_ENV === 'production' ? 'silent' : 'trace' }),
    browser: Browsers.macOS('Desktop'),
    qrTimeout: 30000,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    getMessage: getStoredMessage,
  });

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
      persistIncomingMessages(update.messages, update.type).catch((error) => {
        logger.error('Erro ao persistir mensagens no banco de dados:', {
          error: error.message,
        });
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

  sock.ev.on('chats.upsert', async (newChats) => {
    for (const chat of newChats) {
      const chatDataForDb = {
        id: chat.id,
        name: chat.name || chat.id,
        raw_chat: JSON.stringify(chat),
      };
      try {
        await upsert('chats', chatDataForDb);
      } catch (error) {
        logger.error('Erro no upsert do chat:', {
          error: error.message,
          chatId: chat.id,
        });
      }
    }
  });

  sock.ev.on('chats.update', async (updates) => {
    for (const update of updates) {
      try {
        const existingChat = await findById('chats', update.id);
        const existingRaw = safeJsonParse(existingChat?.raw_chat, {});
        const mergedChat = { ...existingRaw, ...update };
        const chatDataForDb = {
          id: update.id,
          name: update.name || existingChat?.name || update.id,
          raw_chat: JSON.stringify(mergedChat),
        };
        await upsert('chats', chatDataForDb);
      } catch (error) {
        logger.error('Erro no upsert do chat (update):', {
          error: error.message,
          chatId: update.id,
        });
      }
    }
  });

  sock.ev.on('chats.delete', async (deletions) => {
    for (const chatId of deletions) {
      try {
        await remove('chats', chatId);
      } catch (error) {
        logger.error('Erro ao remover chat do banco:', {
          error: error.message,
          chatId,
        });
      }
    }
  });

  sock.ev.on('groups.upsert', async (newGroups) => {
    for (const group of newGroups) {
      const groupDataForDb = {
        id: group.id,
        subject: group.subject,
        owner_jid: group.owner,
        creation: group.creation,
        description: group.desc,
        participants: JSON.stringify(group.participants || []),
      };
      try {
        await upsert('groups_metadata', groupDataForDb);
      } catch (error) {
        logger.error('Erro no upsert do grupo:', {
          error: error.message,
          groupId: group.id,
        });
      }
    }
  });

  sock.ev.on('groups.update', async (updates) => {
    for (const update of updates) {
      try {
        const existingGroup = await findById('groups_metadata', update.id);
        const currentParticipants = parseParticipants(existingGroup?.participants);
        const participants = update.participants || currentParticipants;
        const groupDataForDb = {
          id: update.id,
          subject: update.subject ?? existingGroup?.subject,
          owner_jid: update.owner ?? existingGroup?.owner_jid,
          creation: update.creation ?? existingGroup?.creation,
          description: update.desc ?? existingGroup?.description,
          participants: JSON.stringify(participants || []),
        };
        await upsert('groups_metadata', groupDataForDb);
      } catch (error) {
        logger.error('Erro no upsert do grupo (update):', {
          error: error.message,
          groupId: update.id,
        });
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
 * Os dados são persistidos no MySQL e lidos diretamente do banco quando necessário.
 */
async function handleGroupUpdate(updates, sock) {
  await Promise.all(
    updates.map(async (event) => {
      try {
        const groupId = event.id;
        const oldData = (await findById('groups_metadata', groupId)) || {};
        const currentParticipants = parseParticipants(oldData.participants);
        const participantsData = (event.participants || currentParticipants).map((p) => ({
          id: p.id || null,
          jid: p.jid || p.id || null,
          lid: p.lid || null,
          admin: p.admin || null,
        }));

        const updatedData = {
          id: groupId,
          subject: event.subject ?? oldData.subject,
          description: event.desc ?? oldData.description,
          owner_jid: event.owner ?? oldData.owner_jid,
          creation: event.creation ?? oldData.creation,
          participants: JSON.stringify(participantsData),
        };

        await upsert('groups_metadata', updatedData);

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
 */
export async function reconnectToWhatsApp() {
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
