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

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');

const dotenv = require('dotenv');
const { cleanEnv, str, bool } = require('envalid');
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
  PAIRING_CODE: bool({
    default: false,
    desc: 'Usar código de pareamento em vez de QR Code',
  }),
  PHONE_NUMBER: str({
    default: '',
    desc: 'Número de telefone para o código de pareamento (somente números, com código do país)',
  }),
});

const logger = require('../utils/logger/loggerModule');
const baileysLogger = require('pino')().child({}).child({ level: 'silent' });

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
 * Lida com o fechamento da conexão, logando o erro e decidindo se deve reconectar.
 * @param {object} lastDisconnect - O objeto de desconexão do Baileys.
 */
async function handleConnectionClose(lastDisconnect) {
  const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
  let shouldReconnect = true;
  let userMessage = '🔌 Conexão perdida. Tentando reconectar...';

  logger.debug('A conexão foi fechada.', {
    error: lastDisconnect.error,
    statusCode,
  });

  switch (statusCode) {
    case 401: // Unauthorized: credenciais inválidas ou usuário desconectado
      userMessage = '🚫 Erro de autenticação. A sessão é inválida.';
      logger.error(`${userMessage} Removendo credenciais e encerrando.`);
      try {
        fs.unlinkSync(path.join(QR_CODE_PATH, 'creds.json'));
        logger.info('Arquivo de sessão removido. Por favor, reinicie a aplicação para gerar um novo QR Code.');
      } catch (e) {
        logger.error('Não foi possível remover o arquivo de sessão.', { error: e.message });
      }
      shouldReconnect = false;
      break;
    case 408: // Connection Lost
      userMessage = '🌐 Conexão com o servidor perdida. Reconectando...';
      logger.warn(userMessage);
      break;
    case 411: // Multi-device Mismatch
      userMessage = '⚠️ Sincronização entre dispositivos falhou. Pode ser necessário escanear o QR Code novamente.';
      logger.warn(userMessage);
      break;
    case 428: // Connection Closed
      userMessage = '🔌 Conexão fechada. Reconectando...';
      logger.warn(userMessage);
      break;
    case 440: // Connection Replaced
      userMessage = '🔄 Nova sessão iniciada em outro local. Esta sessão foi encerrada.';
      logger.warn(userMessage);
      shouldReconnect = false;
      break;
    case 500: // Internal Server Error
      userMessage = '🔥 Erro interno no servidor do WhatsApp. Reconectando...';
      logger.error(userMessage);
      break;
    case 515: // Restart Required
      userMessage = '🔄 O servidor do WhatsApp exige uma reinicialização. Reconectando...';
      logger.warn(userMessage);
      break;
    default:
      userMessage = `🔌 Conexão fechada por motivo desconhecido. Reconectando...`;
      logger.error(`Erro não tratado: ${statusCode}`, { error: lastDisconnect.error });
  }

  if (shouldReconnect) {
    const delay = 5000;
    logger.info(`${userMessage} Tentando novamente em ${delay / 1000} segundos.`);
    setTimeout(() => initializeOmniZapConnection().catch((err) => logger.error('Falha crítica na tentativa de reconexão.', { error: err.message, stack: err.stack })), delay);
  } else {
    logger.info(userMessage);
  }
}

/**
 * Inicializa a conexão WhatsApp do OmniZap
 *
 * @returns {Promise<void>}
 */
async function initializeOmniZapConnection() {
  const { state, saveCreds } = await useMultiFileAuthState(QR_CODE_PATH);
  const { version } = await fetchLatestBaileysVersion();

  if (env.PAIRING_CODE && !state.creds.registered) {
    if (!env.PHONE_NUMBER) {
      logger.error('═══════════════════════════════════════════════════');
      logger.error('❌ ERRO DE CONFIGURAÇÃO: NÚMERO DE TELEFONE AUSENTE');
      logger.error('O modo de pareamento por código está ativado (PAIRING_CODE=true),');
      logger.error('mas a variável PHONE_NUMBER não foi definida no seu arquivo .env');
      logger.error('');
      logger.error('👉 AÇÃO NECESSÁRIA:');
      logger.error('   1. Abra o arquivo `.env` na raiz do projeto.');
      logger.error('   2. Adicione ou edite a linha: PHONE_NUMBER=SEUNUMERO');
      logger.error('   3. Substitua "SEUNUMERO" pelo seu número de WhatsApp com código do país (ex: 5511999999999).');
      logger.error('═══════════════════════════════════════════════════');
      throw new Error('Configuração de pareamento incompleta: PHONE_NUMBER ausente.');
    }

    logger.info('📱 Iniciando conexão com código de pareamento...');
    logger.warn('[!IMPORTANTE] O pareamento por código é um método para conectar o WhatsApp Web sem QR Code.');
    logger.warn('Você só pode conectar um dispositivo por vez com este método.');
    logger.info(`O número de telefone deve conter apenas números, incluindo o código do país. Ex: 5511999999999`);
  }

  const omniZapClient = makeWASocket({
    version,
    logger: baileysLogger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    browser: Browsers.appropriate('Chrome'),
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

  if (env.PAIRING_CODE && !omniZapClient.authState.creds.registered) {
    const phoneNumber = env.PHONE_NUMBER.replace(/[^0-9]/g, '');
    logger.info(`📞 Solicitando código de pareamento para o número: ${phoneNumber}`);

    setTimeout(async () => {
      try {
        const code = await omniZapClient.requestPairingCode(phoneNumber);
        logger.info('═══════════════════════════════════════════════════');
        logger.info('📱 SEU CÓDIGO DE PAREAMENTO 📱');
        logger.info(`\n          > ${code.match(/.{1,4}/g).join('-')} <\n`);
        logger.info('💡 Abra o WhatsApp → Dispositivos vinculados → Vincular com número de telefone');
        logger.info('═══════════════════════════════════════════════════');
      } catch (error) {
        logger.error('❌ Falha ao solicitar o código de pareamento:', { error: error.message, stack: error.stack });
      }
    }, 3000);
  }

  omniZapClient.ev.process(async (events) => {
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      eventHandler.processGenericEvent('connection.update', update);

      logger.info(`🔗 Socket: Connection update - Status: ${connection}`);

      if (qr && !env.PAIRING_CODE) {
        logger.info(`📱 QR Code gerado! Escaneie com seu WhatsApp:`);
        logger.info('═══════════════════════════════════════════════════');
        qrcode.generate(qr, { small: true });
        logger.info('═══════════════════════════════════════════════════');
        logger.info('💡 Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo');
        logger.warn('⏰ O QR Code expira em 60 segundos');
      }

      switch (connection) {
        case 'close':
          await handleConnectionClose(lastDisconnect);
          break;

        case 'connecting':
          logger.info(`〔 Socket 〕 Conectando... - ${getCurrentDate()} ${getCurrentTime()}`);
          break;

        case 'open':
          logger.info('✅ OmniZap: Conectado com sucesso!');
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
