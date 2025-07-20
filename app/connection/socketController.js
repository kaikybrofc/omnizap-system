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
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  getAggregateVotesInPollMessage,
} = require('@whiskeysockets/baileys');

const store = {
  chats: [],
  contacts: {},
  messages: {},
  bind: function (ev) {
    ev.on('messages.upsert', ({ messages, type }) => {
      if (type === 'append') {
        for (const msg of messages) {
          if (!this.messages[msg.key.remoteJid]) {
            this.messages[msg.key.remoteJid] = [];
          }
          this.messages[msg.key.remoteJid].push(msg);
        }
      }
    });
    ev.on('chats.upsert', (newChats) => {
      for (const chat of newChats) {
        const existingChat = this.chats.find((c) => c.id === chat.id);
        if (existingChat) {
          Object.assign(existingChat, chat);
        } else {
          this.chats.push(chat);
        }
      }
    });
    ev.on('contacts.upsert', (newContacts) => {
      for (const contact of newContacts) {
        this.contacts[contact.id] = contact;
      }
    });
  },
  readFromFile: function (filePath) {
    logger.info(`Attempting to read store from ${filePath} (not implemented)`);
  },
  writeToFile: function (filePath) {
    logger.info(`Attempting to write store to ${filePath} (not implemented)`);
  },
};

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const NodeCache = require('node-cache');
const logger = require('../utils/logger/loggerModule');
const { processMessages, processEvent } = require('../controllers/messageController');

let activeSocket = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 10000;

const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });

async function connectToWhatsApp() {
  logger.info('Iniciando conexão com o WhatsApp...');
  connectionAttempts = 0;

  const authPath = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const usePairingCode = process.env.PAIRING_CODE === 'true';

  const sock = makeWASocket({
    version,
    auth: state,
    logger: require('pino')({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: !usePairingCode,
    qrTimeout: 30000,
    syncFullHistory: true,
    markOnlineOnConnect: false,
    cachedGroupMetadata: (jid) => groupCache.get(jid),
    getMessage: async (key) =>
      (store.messages[key.remoteJid] || []).find((m) => m.key.id === key.id),
  });

  store.bind(sock.ev);

  if (usePairingCode && !sock.authState.creds.registered) {
    const phoneNumber = process.env.PHONE_NUMBER?.replace(/[^0-9]/g, '');
    if (!phoneNumber) {
      logger.error('Número de telefone é obrigatório para o modo de pareamento.');
      return;
    }
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        logger.info('═══════════════════════════════════════════════════');
        logger.info('📱 SEU CÓDIGO DE PAREAMENTO 📱');
        logger.info('\n          > ' + code.match(/.{1,4}/g).join('-') + ' <\n');
        logger.info('💡 WhatsApp → Dispositivos vinculados → Vincular com número');
        logger.info('═══════════════════════════════════════════════════');
      } catch (error) {
        logger.error('❌ Erro ao solicitar o código de pareamento:', error);
      }
    }, 3000);
  }

  activeSocket = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => handleConnectionUpdate(update, sock));
  sock.ev.on('messages.upsert', (messageUpdate) => processMessages(messageUpdate, sock));
  sock.ev.on('messages.update', (update) => handleMessageUpdate(update, sock));
  sock.ev.on('groups.update', (updates) => handleGroupUpdate(updates, sock));
  sock.ev.on('group-participants.update', (update) => handleGroupParticipantsUpdate(update, sock));
  sock.ev.on('chats.upsert', () => logger.info('Chats atualizados:', store.chats.all()));
  sock.ev.on('contacts.upsert', () =>
    logger.info('Contatos atualizados:', Object.values(store.contacts)),
  );
  sock.ev.on('all', (event) => processEvent(event));
}

function handleConnectionUpdate(update, sock) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    logger.info('📱 QR Code gerado! Escaneie com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
  }

  if (connection === 'close') {
    const shouldReconnect =
      lastDisconnect?.error instanceof Boom &&
      lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;

    if (shouldReconnect && connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      connectionAttempts++;
      logger.warn(
        `Conexão perdida. Tentando reconectar em ${
          RECONNECT_INTERVAL / 1000
        }s... (Tentativa ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`,
      );
      setTimeout(() => connectToWhatsApp(sock), RECONNECT_INTERVAL);
    } else if (shouldReconnect) {
      logger.error('❌ Falha ao reconectar após várias tentativas. Reinicie a aplicação.');
    } else {
      logger.error('❌ Conexão fechada. Motivo:', lastDisconnect?.error);
    }
  } else if (connection === 'open') {
    logger.info('✅ Conectado com sucesso ao WhatsApp!');
    connectionAttempts = 0;
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
        logger.info('Votos da enquete atualizados:', aggregatedVotes);
      }
    }
  }
}

async function handleGroupUpdate(updates, sock) {
  for (const event of updates) {
    try {
      const metadata = await sock.groupMetadata(event.id);
      groupCache.set(event.id, metadata);
      logger.info(`Metadados do grupo ${event.id} atualizados e cacheados.`);
    } catch (error) {
      logger.error(`Erro ao buscar metadados do grupo ${event.id}:`, error);
    }
  }
}

async function handleGroupParticipantsUpdate(update, sock) {
  try {
    const metadata = await sock.groupMetadata(update.id);
    groupCache.set(update.id, metadata);
    logger.info(`Participantes do grupo ${update.id} atualizados e metadados cacheados.`);
  } catch (error) {
    logger.error(
      `Erro ao buscar metadados do grupo ${update.id} após atualização de participantes:`,
      error,
    );
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
