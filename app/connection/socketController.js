/**
 * OmniZap WhatsApp Connection Controller
 *
 * Controlador responsável pela conexão e gerenciamento do socket WhatsApp
 * Utiliza Baileys para comunicação com a API WhatsApp Web
 *
 * @version 1.0.0
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
const fs = require('fs');
const NodeCache = require('node-cache');
const chalk = require('chalk');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');

dotenv.config();

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

const QR_CODE_PATH = process.env.QR_CODE_PATH || './qr-code';

if (!fs.existsSync(`${QR_CODE_PATH}/creds.json`)) {
  console.log(
    OmniZapColors.primary(
      `OmniZap: Certifique-se de ter outro dispositivo para escanear o QR Code.\nCaminho QR: ${QR_CODE_PATH}\n`,
    ) + '–',
  );
}

const messageRetryCache = new NodeCache();

/**
 * Inicializa a conexão WhatsApp do OmniZap
 *
 * @returns {Promise<void>}
 */
async function initializeOmniZapConnection() {
  const { state, saveCreds } = await useMultiFileAuthState(QR_CODE_PATH);
  const { version } = await fetchLatestBaileysVersion();

  /**
   * Recupera uma mensagem pela chave do store
   *
   * @param {Object} key - Chave da mensagem contendo remoteJid e id
   * @returns {Promise<Object|undefined>} Objeto da mensagem ou undefined se não encontrada
   */
  async function getOmniZapMessage(key) {
    if (!key || !key.remoteJid || !key.id) {
      console.warn('OmniZap: Chave de mensagem inválida:', key);
      return undefined;
    }

    try {
      console.warn('OmniZap: Store removido - função getMessage retornando undefined');
      return undefined;
    } catch (error) {
      console.error(
        `OmniZap: Erro ao carregar mensagem (JID: ${key.remoteJid}, ID: ${key.id}):`,
        error,
      );
      return undefined;
    }
  }

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
    getMessage: getOmniZapMessage,
  });

  omniZapClient.ev.process(async (events) => {
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

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
                  `${OmniZapColors.error('[CONEXÃO FECHADA]')} OmniZap: Conexão fechada por erro: ${lastDisconnect?.error}`,
                );
            }
            initializeOmniZapConnection();
          }
          break;

        case 'connecting':
          console.log(
            OmniZapColors.primary(
              `〔 OmniZap 〕Reconectando/Iniciando - ${getCurrentDate()} ${getCurrentTime()}`,
            ),
          );
          break;

        case 'open':
          console.log(OmniZapColors.success(OmniZapMessages.connected()));
          await omniZapClient.sendPresenceUpdate('available');
          break;

        default:
          break;
      }
    }

    if (events['messages.upsert']) {
      const messageUpdate = events['messages.upsert'];

      const omniZapMainHandler = require('../../index.js');
      omniZapMainHandler(messageUpdate, omniZapClient, QR_CODE_PATH)
        .then(() => {})
        .catch((error) => {
          console.error('OmniZap: Erro no handler principal:', String(error));
        });
    }

    if (events['creds.update']) {
      await saveCreds();
    }
  });
}

initializeOmniZapConnection().catch(async (error) => {
  return console.log(OmniZapColors.error('OmniZap: Erro ao inicializar o sistema: ' + error));
});
