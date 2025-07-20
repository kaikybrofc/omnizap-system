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
  groups: {},
  bind: function (ev) {
    ev.on('messages.upsert', ({ messages: incomingMessages, type }) => {
      const MAX_MESSAGES_PER_CHAT = 100; // Define o limite de mensagens por chat
      if (type === 'append') {
        for (const msg of incomingMessages) {
          if (!this.messages[msg.key.remoteJid]) {
            this.messages[msg.key.remoteJid] = [];
          }
          this.messages[msg.key.remoteJid].push(msg);
          // Remove a mensagem mais antiga se o limite for excedido
          if (this.messages[msg.key.remoteJid].length > MAX_MESSAGES_PER_CHAT) {
            this.messages[msg.key.remoteJid].shift();
          }
        }
        this.debouncedWrite('messages');
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
      this.debouncedWrite('chats');
    });
    ev.on('contacts.upsert', (newContacts) => {
      for (const contact of newContacts) {
        this.contacts[contact.id] = contact;
      }
      this.debouncedWrite('contacts');
    });
  },
  readFromFile: function (dataType) {
    const filePath = path.join(__dirname, 'store', `${dataType}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        this[dataType] = JSON.parse(data);
        logger.info(`Store for ${dataType} read from ${filePath}`);
      } else {
        logger.warn(
          `Store file for ${dataType} not found at ${filePath}. Starting with empty data.`,
        );
      }
    } catch (error) {
      logger.error(`Error reading store for ${dataType} from ${filePath}:`, error);
    }
  },
  writeToFile: function (dataType) {
    const filePath = path.join(__dirname, 'store', `${dataType}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(this[dataType], null, 2));
      logger.info(`Store for ${dataType} written to ${filePath}`);
    } catch (error) {
      logger.error(`Error writing store for ${dataType} to ${filePath}:`, error);
    }
  },
  debouncedWrites: {},
  debouncedWrite: function (dataType, delay = 1000) {
    if (this.debouncedWrites[dataType]) {
      clearTimeout(this.debouncedWrites[dataType]);
    }
    this.debouncedWrites[dataType] = setTimeout(() => {
      this.writeToFile(dataType);
      delete this.debouncedWrites[dataType];
    }, delay);
  },
};

const fs = require('fs');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');

const logger = require('../utils/logger/loggerModule');
const { processMessages, processEvent } = require('../controllers/messageController');

let activeSocket = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 10000;

async function connectToWhatsApp() {
  logger.info('Iniciando conexão com o WhatsApp...');
  connectionAttempts = 0;

  const authPath = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  store.readFromFile('chats');
  store.readFromFile('contacts');
  store.readFromFile('messages');
  store.readFromFile('groups');
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
  sock.ev.on('creds.update', async () => {
    await saveCreds();
  });
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

async function handleConnectionUpdate(update, sock) {
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
  }
  if (connection === 'open') {
    logger.info('✅ Conectado com sucesso ao WhatsApp!');
    connectionAttempts = 0;
    // Fetch and save all participating groups metadata on successful connection
    try {
      const allGroups = await sock.groupFetchAllParticipating();
      for (const group of Object.values(allGroups)) {
        store.groups[group.id] = group;
      }
      store.debouncedWrite('groups');
      logger.info(`Metadados de ${Object.keys(allGroups).length} grupos carregados e salvos.`);
    } catch (error) {
      logger.error('Erro ao carregar metadados de grupos na conexão:', error);
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
        logger.info('Votos da enquete atualizados:', aggregatedVotes);
      }
    }
  }
}

async function handleGroupUpdate(updates, sock) {
  for (const event of updates) {
    try {
      const metadata = await sock.groupMetadata(event.id);
      store.groups[event.id] = metadata;
      store.debouncedWrite('groups');
      logger.info(`Metadados do grupo ${event.id} atualizados e cacheados.`);
    } catch (error) {
      logger.error(`Erro ao buscar metadados do grupo ${event.id}:`, error);
    }
  }
}

async function handleGroupParticipantsUpdate(update, sock) {
  try {
    const metadata = await sock.groupMetadata(update.id);
    store.groups[update.id] = metadata;
    store.debouncedWrite('groups');
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
