/**
 * OmniZap WhatsApp Connection Controller
 *
 * Controlador responsável pela conexão e gerenciamento do socket WhatsApp
 * Utiliza Baileys para comunicação com a API WhatsApp Web
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');

const dotenv = require('dotenv');
const { cleanEnv, str } = require('envalid');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');

const { cacheManager } = require('../cache/cacheManager');
const { eventHandler } = require('../events/eventHandler');

dotenv.config();

const env = cleanEnv(process.env, {
  QR_CODE_PATH: str({
    default: path.join(__dirname, 'qr-code'),
    desc: 'Caminho para armazenar os arquivos de QR Code e autenticação',
  }),
});

const logger = require('../utils/logger/loggerModule');
const baileysLogger = require('pino')().child({}).child({ level: 'silent' });

const OmniZapMessages = {
  auth_error: () => 'OmniZap: Erro de autenticação. Escaneie o QR Code novamente.',
  timeout: () => 'OmniZap: Timeout de conexão. Tentando reconectar...',
  rate_limit: () => 'OmniZap: Muitas requisições. Tente novamente em alguns momentos.',
  connection_closed: () => 'OmniZap: Conexão fechada inesperadamente. Reconectando...',
  connection_timeout: () => 'OmniZap: Timeout de conexão. Reconectando...',
  server_error: () => 'OmniZap: Erro interno do servidor. Reconectando...',
  version_error: () => 'OmniZap: Falha na versão. Atualize a aplicação.',
  connected: () => 'OmniZap: Conectado com sucesso!',
};

const moment = require('moment-timezone');
const getCurrentDate = () => moment().format('DD/MM/YY');
const getCurrentTime = () => moment().format('HH:mm:ss');

const QR_CODE_PATH = env.QR_CODE_PATH;
const NodeCache = require('node-cache');
const messageRetryCache = new NodeCache();

if (!fs.existsSync(QR_CODE_PATH)) {
  fs.mkdirSync(QR_CODE_PATH, { recursive: true });
  logger.info(`OmniZap: Diretório criado para QR Code: ${QR_CODE_PATH}`);
}

if (!fs.existsSync(`${QR_CODE_PATH}/creds.json`)) {
  logger.info(
    `OmniZap: Certifique-se de ter outro dispositivo para escanear o QR Code.
Caminho QR: ${QR_CODE_PATH}
–`,
  );
}

logger.info('🔗 OmniZap Socket: Sistema de conexão inicializado');
logger.debug('🔗 Módulos de cache e eventos carregados independentemente');

/**
 * Inicializa a conexão WhatsApp do OmniZap
 *
 * @returns {Promise<void>}
 */
async function initializeOmniZapConnection() {
  const { state, saveCreds } = await useMultiFileAuthState(QR_CODE_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const omniZapClient = makeWASocket({
    version,
    logger: baileysLogger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    browser: ['Chrome'],
    msgRetryCounterCache: messageRetryCache,
    generateHighQualityLinkPreview: true,
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!message?.interactiveMessage;
      if (requiresPatch) {
        message = {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadataVersion: 2,
                deviceListMetadata: {},
              },
              ...message,
            },
          },
        };
      }
      return message;
    },
    getMessage: async (key) => {
      return await cacheManager.getMessage(key);
    },
    shouldSyncHistoryMessage: () => false,
    shouldIgnoreJid: (jid) => jid.includes('broadcast'),
  });

  omniZapClient.ev.process(async (events) => {
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      eventHandler.processGenericEvent('connection.update', update);

      logger.info(`🔗 Socket: Connection update - Status: ${connection}`);

      if (qr) {
        logger.info(`📱 QR Code gerado! Escaneie com seu WhatsApp:`);
        logger.info('═══════════════════════════════════════════════════');
        qrcode.generate(qr, { small: true });
        logger.info('═══════════════════════════════════════════════════');
        logger.info('💡 Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo');
        logger.warn('⏰ O QR Code expira em 60 segundos');
      }

      const statusCode = new Boom(lastDisconnect?.error)?.output.statusCode;

      switch (connection) {
        case 'close':
          if (statusCode) {
            switch (statusCode) {
              case 401:
                logger.error(OmniZapMessages.auth_error());
                fs.unlinkSync(`${QR_CODE_PATH}/creds.json`);
                break;
              case 408:
                logger.warn(OmniZapMessages.timeout());
                break;
              case 411:
                logger.warn(OmniZapMessages.rate_limit());
                break;
              case 428:
                logger.warn(OmniZapMessages.connection_closed());
                break;
              case 440:
                logger.debug(OmniZapMessages.connection_timeout());
                break;
              case 500:
                logger.error(OmniZapMessages.server_error());
                break;
              case 503:
                logger.error('OmniZap: Erro desconhecido 503.');
                break;
              case 515:
                logger.warn(OmniZapMessages.version_error());
                break;
              default:
                logger.error(`[CONEXÃO FECHADA] Socket: Conexão fechada por erro: ${lastDisconnect?.error}`);
            }
            await initializeOmniZapConnection();
          }
          break;

        case 'connecting':
          logger.info(`〔 Socket 〕 Reconectando/Iniciando - ${getCurrentDate()} ${getCurrentTime()}`);
          break;

        case 'open':
          logger.info(OmniZapMessages.connected());
          await omniZapClient.sendPresenceUpdate('available');
          eventHandler.setWhatsAppClient(omniZapClient);
          break;

        default:
          break;
      }
    }

    if (events['messages.upsert']) {
      const messageUpdate = events['messages.upsert'];
      logger.info(`📨 Socket: Messages upsert - ${messageUpdate.messages?.length || 0} mensagem(ns)`);
      eventHandler.processMessagesUpsert(messageUpdate);

      const omniZapMainHandler = require('../../index.js');
      omniZapMainHandler(messageUpdate, omniZapClient, QR_CODE_PATH)
        .then(() => {
          logger.debug('Socket: 🎯 Handler principal executado');
        })
        .catch((error) => {
          logger.error('Socket: ❌ Erro no handler principal:', {
            error: error.message,
            stack: error.stack,
          });
        });
    }

    if (events['messages.update']) {
      const updates = events['messages.update'];
      logger.info(`📝 Socket: Messages update - ${updates?.length || 0} atualização(ões)`);
      eventHandler.processMessagesUpdate(updates);
    }

    if (events['messages.delete']) {
      const deletion = events['messages.delete'];
      logger.warn('🗑️ Socket: Messages delete');
      eventHandler.processMessagesDelete(deletion);
    }

    if (events['messages.reaction']) {
      const reactions = events['messages.reaction'];
      logger.info(`😀 Socket: Messages reaction - ${reactions?.length || 0} reação(ões)`);

      eventHandler.processMessagesReaction(reactions);
    }

    if (events['message-receipt.update']) {
      const receipts = events['message-receipt.update'];
      logger.info(`📬 Socket: Message receipt - ${receipts?.length || 0} recibo(s)`);

      eventHandler.processMessageReceipt(receipts);
    }

    if (events['messaging-history.set']) {
      const historyData = events['messaging-history.set'];
      logger.info('📚 Socket: Messaging history set');

      eventHandler.processMessagingHistory(historyData);
    }

    if (events['groups.update']) {
      const updates = events['groups.update'];
      logger.info(`👥 Socket: Groups update - ${updates?.length || 0} atualização(ões)`);

      eventHandler.processGroupsUpdate(updates);
    }

    if (events['groups.upsert']) {
      const groupsMetadata = events['groups.upsert'];
      logger.info(`👥 Socket: Groups upsert - ${groupsMetadata?.length || 0} grupo(s)`);

      eventHandler.processGroupsUpsert(groupsMetadata);
    }

    if (events['group-participants.update']) {
      const event = events['group-participants.update'];
      logger.info('👥 Socket: Group participants update');

      eventHandler.processGroupParticipants(event);
    }

    if (events['chats.upsert']) {
      const chats = events['chats.upsert'];
      logger.info(`💬 Socket: Chats upsert - ${chats?.length || 0} chat(s)`);

      eventHandler.processChatsUpsert(chats);
    }

    if (events['chats.update']) {
      const updates = events['chats.update'];
      logger.info(`💬 Socket: Chats update - ${updates?.length || 0} atualização(ões)`);

      eventHandler.processChatsUpdate(updates);
    }

    if (events['chats.delete']) {
      const jids = events['chats.delete'];
      logger.warn(`💬 Socket: Chats delete - ${jids?.length || 0} chat(s) deletado(s)`);

      eventHandler.processChatsDelete(jids);
    }

    if (events['contacts.upsert']) {
      const contacts = events['contacts.upsert'];
      logger.info(`👤 Socket: Contacts upsert - ${contacts?.length || 0} contato(s)`);

      eventHandler.processContactsUpsert(contacts);
    }

    if (events['contacts.update']) {
      const updates = events['contacts.update'];
      logger.info(`👤 Socket: Contacts update - ${updates?.length || 0} atualização(ões)`);

      eventHandler.processContactsUpdate(updates);
    }

    if (events['blocklist.set']) {
      const data = events['blocklist.set'];
      logger.warn(`🚫 Socket: Blocklist set - ${data.blocklist?.length || 0} bloqueio(s)`);

      eventHandler.processGenericEvent('blocklist.set', data);
    }

    if (events['blocklist.update']) {
      const data = events['blocklist.update'];
      logger.warn(`🚫 Socket: Blocklist update - Ação: ${data.action}`);

      eventHandler.processGenericEvent('blocklist.update', data);
    }

    if (events['call']) {
      const callEvents = events['call'];
      logger.info(`📞 Socket: Call events - ${callEvents?.length || 0} chamada(s)`);

      eventHandler.processGenericEvent('call', callEvents);
    }

    if (events['presence.update']) {
      const data = events['presence.update'];
      logger.debug('👁️ Socket: Presence update');

      eventHandler.processGenericEvent('presence.update', data);
    }

    if (events['creds.update']) {
      logger.info('🔐 Socket: Credentials update - Salvando credenciais');

      eventHandler.processGenericEvent('creds.update', { timestamp: Date.now() });

      await saveCreds();
    }
  });
}
initializeOmniZapConnection().catch(async (error) => {
  logger.error('Socket: Erro ao inicializar o sistema', {
    error: error.message,
    stack: error.stack,
  });
});

module.exports = {
  initializeOmniZapConnection,
  cacheManager,
  eventHandler,
};
('');
