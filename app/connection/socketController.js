/**
 * OmniZap WhatsApp Connection Controller
 *
 * Refatorado para seguir o padrão do Baileys
 * Utiliza eventos globais para comunicação
 *
 * @version 2.0.0
 * @license MIT
 */

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const logger = require('../utils/logger/loggerModule');

let activeSocket = null;
let connectionAttempts = 0;
let lastConnectionTime = null;
let isReconnecting = false;

/**
 * Lida com todos os eventos do Baileys
 */
function handleAllEvents(sock) {
  sock.ev.on('connection.update', (update) => {
    logger.info('🔄 Evento de conexão:', update);
  });

  sock.ev.on('messages.upsert', (messageUpdate) => {
    logger.info('📨 Evento de mensagens:', messageUpdate);
  });

  sock.ev.on('creds.update', () => {
    logger.info('🔐 Credenciais atualizadas');
  });

  sock.ev.on('chats.upsert', (chats) => {
    logger.info('💬 Novos chats:', chats);
  });

  sock.ev.on('groups.update', (groups) => {
    logger.info('👥 Atualizações de grupos:', groups);
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    logger.info('👤 Novos contatos:', contacts);
  });

  // Adicione outros eventos conforme necessário
}

/**
 * Configura e retorna o socket do Baileys
 */
async function connectToWhatsApp() {
  if (isReconnecting) {
    logger.warn('🔄 Já está em processo de reconexão, aguarde...');
    return;
  }

  try {
    isReconnecting = true;
    connectionAttempts++;
    logger.info(`🔗 Tentativa de conexão #${connectionAttempts}`);

    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info_baileys'));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: require('pino')({ level: 'silent' }),
      browser: Browsers.ubuntu('OmniZap'),
      printQRInTerminal: true,
    });

    handleAllEvents(sock);

    activeSocket = sock;
    return sock;
  } catch (error) {
    isReconnecting = false;
    logger.error('❌ Erro ao conectar ao WhatsApp:', error.message);
    throw error;
  }
}

/**
 * Lida com atualizações de conexão
 */
function handleConnectionUpdate(update, sock, saveCreds) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    logger.info('📱 QR Code gerado! Escaneie com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
  }

  if (connection === 'close') {
    const shouldReconnect = (lastDisconnect?.error?.output?.statusCode || 0) !== DisconnectReason.loggedOut;
    if (shouldReconnect && connectionAttempts < 5) {
      setTimeout(connectToWhatsApp, 10000);
    } else {
      logger.error('❌ Sessão encerrada. Reinicie a aplicação para reconectar.');
    }
  } else if (connection === 'open') {
    logger.info('✅ Conectado com sucesso ao WhatsApp!');
    lastConnectionTime = Date.now();
    connectionAttempts = 0;
    isReconnecting = false;
  }

  sock.ev.on('creds.update', saveCreds);
}

/**
 * Lida com novas mensagens
 */
function handleMessagesUpsert({ messages }) {
  for (const message of messages) {
    logger.info(`📨 Nova mensagem de ${message.key.remoteJid}: ${message.message?.conversation || 'Sem conteúdo'}`);
  }
}

/**
 * Força reconexão ao WhatsApp
 */
async function reconnectToWhatsApp() {
  if (activeSocket) {
    activeSocket.ws.close();
  }
  await connectToWhatsApp();
}

module.exports = {
  connectToWhatsApp,
  reconnectToWhatsApp,
};
