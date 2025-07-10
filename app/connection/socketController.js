/**
 * OmniZap WhatsApp Connection Controller
 *
 * Controlador responsável pela conexão e gerenciamento do socket WhatsApp
 * Utiliza Baileys para comunicação com a API WhatsApp Web
 * Baseado no exemplo oficial do Baileys
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { cleanEnv, str, bool } = require('envalid');
const path = require('path');

const { eventHandler } = require('../events/eventHandler');
const logger = require('../utils/logger/loggerModule');

dotenv.config();

const env = cleanEnv(process.env, {
  QR_CODE_PATH: str({
    default: path.join(__dirname, 'qr-code'),
    desc: 'Caminho para armazenar os arquivos de QR Code e autenticação',
  }),
  PAIRING_CODE: bool({
    default: false,
    desc: 'Usar código de pareamento em vez de QR Code',
  }),
  PHONE_NUMBER: str({
    default: '',
    desc: 'Número de telefone para o código de pareamento (somente números, com código do país)',
  }),
});

// Logger silencioso para Baileys
const baileysLogger = require('pino')({ level: 'silent' });

/**
 * Conecta ao WhatsApp usando Baileys
 * Implementação baseada no exemplo oficial
 */
async function connectToWhatsApp() {
  try {
    // Configura o estado de autenticação
    const { state, saveCreds } = await useMultiFileAuthState(env.QR_CODE_PATH);
    const { version } = await fetchLatestBaileysVersion();

    logger.info('🔗 OmniZap: Iniciando conexão com WhatsApp...');

    // Cria o socket do WhatsApp
    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      browser: Browsers.ubuntu('OmniZap'),
      printQRInTerminal: !env.PAIRING_CODE,
      generateHighQualityLinkPreview: true,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) => typeof jid === 'string' && jid.includes('broadcast'),
    });

    // Gerencia código de pareamento se necessário
    if (env.PAIRING_CODE && !sock.authState.creds.registered) {
      if (!env.PHONE_NUMBER) {
        logger.error('❌ Número de telefone necessário para o modo de pareamento');
        throw new Error('PHONE_NUMBER é obrigatório quando PAIRING_CODE=true');
      }

      const phoneNumber = env.PHONE_NUMBER.replace(/[^0-9]/g, '');
      logger.info(`📞 Solicitando código de pareamento para: ${phoneNumber}`);

      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          logger.info('═══════════════════════════════════════════════════');
          logger.info('📱 SEU CÓDIGO DE PAREAMENTO 📱');
          logger.info(`\n          > ${code.match(/.{1,4}/g).join('-')} <\n`);
          logger.info('💡 WhatsApp → Dispositivos vinculados → Vincular com número');
          logger.info('═══════════════════════════════════════════════════');
        } catch (error) {
          logger.error('❌ Erro ao solicitar código de pareamento:', error.message);
        }
      }, 3000);
    }

    // Event handlers
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      logger.info(`🔗 Status da conexão: ${connection}`);

      if (qr && !env.PAIRING_CODE) {
        logger.info('📱 QR Code gerado! Escaneie com seu WhatsApp:');
        logger.info('═══════════════════════════════════════════════════');
        qrcode.generate(qr, { small: true });
        logger.info('═══════════════════════════════════════════════════');
        logger.info('💡 WhatsApp → Dispositivos vinculados → Vincular dispositivo');
        logger.warn('⏰ QR Code expira em 60 segundos');
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;

        logger.warn(`🔌 Conexão fechada. Motivo: ${reason}, Reconectar: ${shouldReconnect}`);

        if (shouldReconnect) {
          logger.info('🔄 Reconectando em 5 segundos...');
          setTimeout(() => connectToWhatsApp(), 5000);
        } else {
          logger.error('❌ Sessão encerrada. Reinicie a aplicação para reconectar.');
        }
      } else if (connection === 'open') {
        logger.info('✅ OmniZap: Conectado com sucesso ao WhatsApp!');
        await sock.sendPresenceUpdate('available');

        // Define o cliente no event handler
        eventHandler.setWhatsAppClient(sock);
      }

      // Processa evento genérico
      eventHandler.processGenericEvent('connection.update', update);
    });

    // Manipulador de mensagens
    sock.ev.on('messages.upsert', async (messageUpdate) => {
      logger.info(`📨 Novas mensagens: ${messageUpdate.messages?.length || 0}`);

      // Processa no event handler
      eventHandler.processMessagesUpsert(messageUpdate);

      // Chama o handler principal
      try {
        const omniZapMainHandler = require('../../index.js');
        await omniZapMainHandler(messageUpdate, sock, env.QR_CODE_PATH);
        logger.debug('🎯 Handler principal executado com sucesso');
      } catch (error) {
        logger.error('❌ Erro no handler principal:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });

    // Outros eventos importantes
    sock.ev.on('messages.update', (updates) => {
      logger.info(`📝 Atualizações de mensagens: ${updates?.length || 0}`);
      eventHandler.processMessagesUpdate(updates);
    });

    sock.ev.on('messages.delete', (deletion) => {
      logger.warn('🗑️ Mensagens deletadas');
      eventHandler.processMessagesDelete(deletion);
    });

    sock.ev.on('messages.reaction', (reactions) => {
      logger.info(`😀 Reações: ${reactions?.length || 0}`);
      eventHandler.processMessagesReaction(reactions);
    });

    sock.ev.on('groups.update', (updates) => {
      logger.info(`👥 Atualizações de grupos: ${updates?.length || 0}`);
      eventHandler.processGroupsUpdate(updates);
    });

    sock.ev.on('group-participants.update', (event) => {
      logger.info('👥 Participantes do grupo atualizados');
      eventHandler.processGroupParticipants(event);
    });

    // Salva credenciais quando atualizadas
    sock.ev.on('creds.update', async () => {
      logger.info('🔐 Credenciais atualizadas - Salvando...');
      await saveCreds();
      eventHandler.processGenericEvent('creds.update', { timestamp: Date.now() });
    });

    return sock;
  } catch (error) {
    logger.error('❌ Erro ao conectar ao WhatsApp:', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

// Inicia a conexão
connectToWhatsApp().catch((error) => {
  logger.error('💥 Falha crítica na inicialização:', error.message);
  process.exit(1);
});

module.exports = {
  connectToWhatsApp,
  eventHandler,
};
