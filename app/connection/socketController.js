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
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('OmniZap'),
        printQRInTerminal: !process.env.PAIRING_CODE,
        qrTimeout: 30000,
    });

    if (process.env.PAIRING_CODE && !sock.authState.creds.registered) {
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
    sock.ev.on('all', (event) => processEvent(event));
}

function handleConnectionUpdate(update, sock) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        logger.info('📱 QR Code gerado! Escaneie com seu WhatsApp:');
        qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) &&
                                (lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut);

        if (shouldReconnect && connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
            connectionAttempts++;
            logger.warn(`Conexão perdida. Tentando reconectar em ${RECONNECT_INTERVAL / 1000}s... (Tentativa ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`);
            setTimeout(connectToWhatsApp, RECONNECT_INTERVAL);
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
};
