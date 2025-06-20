/**
 * OmniZap WhatsApp Connection Controller
 *
 * Controlador responsável pela conexão e gerenciamento do socket WhatsApp
 * Utiliza Baileys para comunicação com a API WhatsApp Web
 *
 * @version 1.0.3
 * @author OmniZap Team
 * @license MIT
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const dotenv = require('dotenv');
const { cleanEnv, str } = require('envalid');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
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

const OmniZapColors = {
  primary: (text) => chalk.cyan(text),
  error: (text) => chalk.red(text),
  warning: (text) => chalk.yellow(text),
  success: (text) => chalk.green(text),
  info: (text) => chalk.blue(text),
  gray: (text) => chalk.gray(text),
  white: (text) => chalk.white(text),
};

const logger = require('pino')().child({}).child({ level: 'silent' });

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
  console.log(OmniZapColors.info(`OmniZap: Diretório criado para QR Code: ${QR_CODE_PATH}`));
}

if (!fs.existsSync(`${QR_CODE_PATH}/creds.json`)) {
  console.log(
    OmniZapColors.primary(
      `OmniZap: Certifique-se de ter outro dispositivo para escanear o QR Code.\nCaminho QR: ${QR_CODE_PATH}\n`,
    ) + '–',
  );
}

console.log(OmniZapColors.info('🔗 OmniZap Socket: Sistema de conexão inicializado'));
console.log(OmniZapColors.gray('🔗 Módulos de cache e eventos carregados independentemente'));
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
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ['OmniZap', 'Chrome', '120.0.0.0'],
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
  });

  omniZapClient.ev.process(async (events) => {
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      eventHandler.processGenericEvent('connection.update', update);

      console.log(OmniZapColors.info(`🔗 Socket: Connection update - Status: ${connection}`));

      if (qr) {
        console.log(OmniZapColors.primary('\n📱 QR Code gerado! Escaneie com seu WhatsApp:'));
        console.log(OmniZapColors.gray('═══════════════════════════════════════════════════'));
        qrcode.generate(qr, { small: true });
        console.log(OmniZapColors.gray('═══════════════════════════════════════════════════'));
        console.log(
          OmniZapColors.info('💡 Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo'),
        );
        console.log(OmniZapColors.warning('⏰ O QR Code expira em 60 segundos\n'));
      }

      const statusCode = new Boom(lastDisconnect?.error)?.output.statusCode;

      switch (connection) {
        case 'close':
          if (statusCode) {
            switch (statusCode) {
              case 401:
                console.log(OmniZapColors.error(OmniZapMessages.auth_error()));
                break;
              case 408:
                console.log(OmniZapColors.warning(OmniZapMessages.timeout()));
                break;
              case 411:
                console.log(OmniZapColors.warning(OmniZapMessages.rate_limit()));
                break;
              case 428:
                console.log(OmniZapColors.warning(OmniZapMessages.connection_closed()));
                break;
              case 440:
                console.log(OmniZapColors.gray(OmniZapMessages.connection_timeout()));
                break;
              case 500:
                console.log(OmniZapColors.gray(OmniZapMessages.server_error()));
                break;
              case 503:
                console.log(OmniZapColors.gray('OmniZap: Erro desconhecido 503.'));
                break;
              case 515:
                console.log(OmniZapColors.gray(OmniZapMessages.version_error()));
                break;
              default:
                console.log(
                  `${OmniZapColors.error('[CONEXÃO FECHADA]')} Socket: Conexão fechada por erro: ${
                    lastDisconnect?.error
                  }`,
                );
            }
            initializeOmniZapConnection();
          }
          break;

        case 'connecting':
          console.log(
            OmniZapColors.primary(
              `〔 Socket 〕Reconectando/Iniciando - ${getCurrentDate()} ${getCurrentTime()}`,
            ),
          );
          break;

        case 'open':
          console.log(OmniZapColors.success(OmniZapMessages.connected()));
          await omniZapClient.sendPresenceUpdate('available');
          eventHandler.setWhatsAppClient(omniZapClient);
          break;

        default:
          break;
      }
    }

    if (events['messages.upsert']) {
      const messageUpdate = events['messages.upsert'];
      console.log(
        OmniZapColors.info(
          `📨 Socket: Messages upsert - ${messageUpdate.messages?.length || 0} mensagem(ns)`,
        ),
      );
      eventHandler.processMessagesUpsert(messageUpdate);

      const omniZapMainHandler = require('../../index.js');
      omniZapMainHandler(messageUpdate, omniZapClient, QR_CODE_PATH)
        .then(() => {
          console.log(OmniZapColors.gray('Socket: 🎯 Handler principal executado'));
        })
        .catch((error) => {
          console.error(
            OmniZapColors.error('Socket: ❌ Erro no handler principal:'),
            String(error),
          );
        });
    }

    if (events['messages.update']) {
      const updates = events['messages.update'];
      console.log(
        OmniZapColors.info(`📝 Socket: Messages update - ${updates?.length || 0} atualização(ões)`),
      );
      eventHandler.processMessagesUpdate(updates);
    }

    if (events['messages.delete']) {
      const deletion = events['messages.delete'];
      console.log(OmniZapColors.warning('🗑️ Socket: Messages delete'));
      eventHandler.processMessagesDelete(deletion);
    }

    if (events['messages.reaction']) {
      const reactions = events['messages.reaction'];
      console.log(
        OmniZapColors.info(`😀 Socket: Messages reaction - ${reactions?.length || 0} reação(ões)`),
      );

      eventHandler.processMessagesReaction(reactions);
    }

    if (events['message-receipt.update']) {
      const receipts = events['message-receipt.update'];
      console.log(
        OmniZapColors.info(`📬 Socket: Message receipt - ${receipts?.length || 0} recibo(s)`),
      );

      eventHandler.processMessageReceipt(receipts);
    }

    if (events['messaging-history.set']) {
      const historyData = events['messaging-history.set'];
      console.log(OmniZapColors.info('📚 Socket: Messaging history set'));

      eventHandler.processMessagingHistory(historyData);
    }

    if (events['groups.update']) {
      const updates = events['groups.update'];
      console.log(
        OmniZapColors.info(`👥 Socket: Groups update - ${updates?.length || 0} atualização(ões)`),
      );

      eventHandler.processGroupsUpdate(updates);
    }

    if (events['groups.upsert']) {
      const groupsMetadata = events['groups.upsert'];
      console.log(
        OmniZapColors.info(`👥 Socket: Groups upsert - ${groupsMetadata?.length || 0} grupo(s)`),
      );

      eventHandler.processGroupsUpsert(groupsMetadata);
    }

    if (events['group-participants.update']) {
      const event = events['group-participants.update'];
      console.log(OmniZapColors.info('👥 Socket: Group participants update'));

      eventHandler.processGroupParticipants(event);
    }

    if (events['chats.upsert']) {
      const chats = events['chats.upsert'];
      console.log(OmniZapColors.info(`💬 Socket: Chats upsert - ${chats?.length || 0} chat(s)`));

      eventHandler.processChatsUpsert(chats);
    }

    if (events['chats.update']) {
      const updates = events['chats.update'];
      console.log(
        OmniZapColors.info(`💬 Socket: Chats update - ${updates?.length || 0} atualização(ões)`),
      );

      eventHandler.processChatsUpdate(updates);
    }

    if (events['chats.delete']) {
      const jids = events['chats.delete'];
      console.log(
        OmniZapColors.warning(`💬 Socket: Chats delete - ${jids?.length || 0} chat(s) deletado(s)`),
      );

      eventHandler.processChatsDelete(jids);
    }

    if (events['contacts.upsert']) {
      const contacts = events['contacts.upsert'];
      console.log(
        OmniZapColors.info(`👤 Socket: Contacts upsert - ${contacts?.length || 0} contato(s)`),
      );

      eventHandler.processContactsUpsert(contacts);
    }

    if (events['contacts.update']) {
      const updates = events['contacts.update'];
      console.log(
        OmniZapColors.info(`👤 Socket: Contacts update - ${updates?.length || 0} atualização(ões)`),
      );

      eventHandler.processContactsUpdate(updates);
    }

    if (events['blocklist.set']) {
      const data = events['blocklist.set'];
      console.log(
        OmniZapColors.warning(
          `🚫 Socket: Blocklist set - ${data.blocklist?.length || 0} bloqueio(s)`,
        ),
      );

      eventHandler.processGenericEvent('blocklist.set', data);
    }

    if (events['blocklist.update']) {
      const data = events['blocklist.update'];
      console.log(OmniZapColors.warning(`🚫 Socket: Blocklist update - Ação: ${data.action}`));

      eventHandler.processGenericEvent('blocklist.update', data);
    }

    if (events['call']) {
      const callEvents = events['call'];
      console.log(
        OmniZapColors.info(`📞 Socket: Call events - ${callEvents?.length || 0} chamada(s)`),
      );

      eventHandler.processGenericEvent('call', callEvents);
    }

    if (events['presence.update']) {
      const data = events['presence.update'];
      console.log(OmniZapColors.info('👁️ Socket: Presence update'));

      eventHandler.processGenericEvent('presence.update', data);
    }

    if (events['creds.update']) {
      console.log(OmniZapColors.info('🔐 Socket: Credentials update - Salvando credenciais'));

      eventHandler.processGenericEvent('creds.update', { timestamp: Date.now() });

      await saveCreds();
    }
  });
}
initializeOmniZapConnection().catch(async (error) => {
  return console.log(OmniZapColors.error('Socket: Erro ao inicializar o sistema: ' + error));
});

module.exports = {
  initializeOmniZapConnection,
  cacheManager,
  eventHandler,
};
