/**
 * OmniZap WhatsApp Connection Controller
 *
 * Controlador responsável pela conexão e gerenciamento do socket WhatsApp
 * Utiliza Baileys para comunicação com a API WhatsApp Web
 *
 * @version 1.0.1
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
const NodeCache = require('node-cache');
const chalk = require('chalk');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');

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

const messageRetryCache = new NodeCache();
const messagesCache = new NodeCache({
  stdTTL: 3600,
  checkperiod: 600,
  useClones: false,
});

const eventsCache = new NodeCache({
  stdTTL: 1800,
  checkperiod: 300,
  useClones: false,
});

const groupMetadataCache = new NodeCache({
  stdTTL: 7200,
  checkperiod: 600,
  useClones: false,
});

const contactsCache = new NodeCache({
  stdTTL: 14400,
  checkperiod: 600,
  useClones: false,
});

const chatsCache = new NodeCache({
  stdTTL: 3600,
  checkperiod: 600,
  useClones: false,
});

console.log(OmniZapColors.info('OmniZap: Sistema de cache de mensagens inicializado'));
console.log(OmniZapColors.gray('OmniZap: TTL do cache: 1 hora | Verificação: 10 minutos'));

console.log(OmniZapColors.info('🔄 OmniZap: Sistema de cache de eventos inicializado'));
console.log(
  OmniZapColors.gray('🔄 OmniZap: TTL eventos: 30 min | Grupos: 2h | Contatos: 4h | Chats: 1h'),
);

messagesCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`OmniZap: Mensagem expirada do cache: ${key}`));
});

messagesCache.on('flush', () => {
  console.log(OmniZapColors.warning('OmniZap: Cache de mensagens foi limpo'));
});

eventsCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`🔄 OmniZap: Evento expirado do cache: ${key}`));
});

eventsCache.on('flush', () => {
  console.log(OmniZapColors.warning('🔄 OmniZap: Cache de eventos foi limpo'));
});

groupMetadataCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`👥 OmniZap: Metadados de grupo expirados: ${key}`));
});

contactsCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`👤 OmniZap: Contato expirado do cache: ${key}`));
});

chatsCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`💬 OmniZap: Chat expirado do cache: ${key}`));
});

/**
 * Salva um evento no cache de eventos
 *
 * @param {string} eventType - Tipo do evento
 * @param {Object} eventData - Dados do evento
 * @param {string} eventId - ID único do evento
 * @returns {void}
 */
function saveEventToCache(eventType, eventData, eventId = null) {
  try {
    if (!eventType || !eventData) {
      console.warn(OmniZapColors.warning('🔄 OmniZap: ⚠️ Dados de evento inválidos para cache'));
      return;
    }

    const timestamp = Date.now();
    const cacheKey = eventId
      ? `event_${eventType}_${eventId}_${timestamp}`
      : `event_${eventType}_${timestamp}`;

    const enhancedEvent = {
      ...eventData,
      _eventType: eventType,
      _cached: true,
      _cacheTimestamp: timestamp,
      _eventId: eventId,
    };

    eventsCache.set(cacheKey, enhancedEvent);

    const recentEventsKey = `recent_events_${eventType}`;
    let recentEvents = eventsCache.get(recentEventsKey) || [];

    recentEvents.unshift(enhancedEvent);
    if (recentEvents.length > 50) {
      recentEvents = recentEvents.slice(0, 50);
    }

    eventsCache.set(recentEventsKey, recentEvents, 3600);

    console.log(
      OmniZapColors.success(
        `🔄 OmniZap: Evento ${eventType} salvo no cache (${cacheKey.substring(0, 50)}...)`,
      ),
    );
  } catch (error) {
    console.error(OmniZapColors.error('🔄 OmniZap: ❌ Erro ao salvar evento no cache:'), error);
  }
}

/**
 * Salva metadados de grupo no cache
 *
 * @param {string} jid - JID do grupo
 * @param {Object} metadata - Metadados do grupo
 * @returns {void}
 */
function saveGroupMetadataToCache(jid, metadata) {
  try {
    if (!jid || !metadata) {
      console.warn(OmniZapColors.warning('👥 OmniZap: ⚠️ Dados de grupo inválidos para cache'));
      return;
    }

    const cacheKey = `group_metadata_${jid}`;
    const enhancedMetadata = {
      ...metadata,
      _cached: true,
      _cacheTimestamp: Date.now(),
      _jid: jid,
    };

    groupMetadataCache.set(cacheKey, enhancedMetadata);
    console.log(
      OmniZapColors.success(
        `👥 OmniZap: Metadados do grupo salvo no cache (${jid.substring(0, 30)}...)`,
      ),
    );
  } catch (error) {
    console.error(
      OmniZapColors.error('👥 OmniZap: ❌ Erro ao salvar metadados de grupo no cache:'),
      error,
    );
  }
}

/**
 * Salva contato no cache
 *
 * @param {Object} contact - Dados do contato
 * @returns {void}
 */
function saveContactToCache(contact) {
  try {
    if (!contact || !contact.id) {
      console.warn(OmniZapColors.warning('👤 OmniZap: ⚠️ Dados de contato inválidos para cache'));
      return;
    }

    const cacheKey = `contact_${contact.id}`;
    const enhancedContact = {
      ...contact,
      _cached: true,
      _cacheTimestamp: Date.now(),
    };

    contactsCache.set(cacheKey, enhancedContact);
    console.log(
      OmniZapColors.success(
        `👤 OmniZap: Contato salvo no cache (${contact.id.substring(0, 30)}...)`,
      ),
    );
  } catch (error) {
    console.error(OmniZapColors.error('👤 OmniZap: ❌ Erro ao salvar contato no cache:'), error);
  }
}

/**
 * Salva chat no cache
 *
 * @param {Object} chat - Dados do chat
 * @returns {void}
 */
function saveChatToCache(chat) {
  try {
    if (!chat || !chat.id) {
      console.warn(OmniZapColors.warning('💬 OmniZap: ⚠️ Dados de chat inválidos para cache'));
      return;
    }

    const cacheKey = `chat_${chat.id}`;
    const enhancedChat = {
      ...chat,
      _cached: true,
      _cacheTimestamp: Date.now(),
    };

    chatsCache.set(cacheKey, enhancedChat);
    console.log(
      OmniZapColors.success(`💬 OmniZap: Chat salvo no cache (${chat.id.substring(0, 30)}...)`),
    );
  } catch (error) {
    console.error(OmniZapColors.error('💬 OmniZap: ❌ Erro ao salvar chat no cache:'), error);
  }
}

/**
 * Limpa mensagens antigas do cache baseado em critérios específicos
 *
 * @param {string} remoteJid - JID específico para limpar (opcional)
 * @returns {number} Número de mensagens removidas
 */
function clearMessagesCache(remoteJid = null) {
  try {
    let removedCount = 0;
    const allKeys = messagesCache.keys();

    if (remoteJid) {
      const keysToRemove = allKeys.filter((key) => key.includes(`msg_${remoteJid}_`));
      keysToRemove.forEach((key) => {
        messagesCache.del(key);
        removedCount++;
      });
      console.log(`OmniZap: ${removedCount} mensagens removidas do cache para JID: ${remoteJid}`);
    } else {
      messagesCache.flushAll();
      removedCount = allKeys.length;
      console.log(`OmniZap: Cache de mensagens completamente limpo (${removedCount} mensagens)`);
    }

    return removedCount;
  } catch (error) {
    console.error('OmniZap: Erro ao limpar cache de mensagens:', error);
    return 0;
  }
}

/**
 * Obtém estatísticas detalhadas de todos os caches
 *
 * @returns {Object} Estatísticas de todos os caches
 */
function getCacheStats() {
  try {
    const messagesStats = messagesCache.getStats();
    const eventsStats = eventsCache.getStats();
    const groupsStats = groupMetadataCache.getStats();
    const contactsStats = contactsCache.getStats();
    const chatsStats = chatsCache.getStats();

    const messageKeys = messagesCache.keys();
    const eventKeys = eventsCache.keys();
    const groupKeys = groupMetadataCache.keys();
    const contactKeys = contactsCache.keys();
    const chatKeys = chatsCache.keys();

    const messageKeysFiltered = messageKeys.filter((k) => k.startsWith('msg_'));
    const recentKeys = messageKeys.filter((k) => k.startsWith('recent_'));
    const counterKeys = messageKeys.filter((k) => k.startsWith('count_'));

    const eventTypes = {};
    eventKeys.forEach((key) => {
      const parts = key.split('_');
      if (parts.length >= 2) {
        const eventType = parts[1];
        eventTypes[eventType] = (eventTypes[eventType] || 0) + 1;
      }
    });

    const jidStats = {};
    messageKeysFiltered.forEach((key) => {
      const parts = key.split('_');
      if (parts.length >= 2) {
        const jid = parts[1];
        jidStats[jid] = (jidStats[jid] || 0) + 1;
      }
    });

    return {
      messages: {
        totalMessages: messageKeysFiltered.length,
        recentLists: recentKeys.length,
        counters: counterKeys.length,
        totalKeys: messageKeys.length,
        hits: messagesStats.hits,
        misses: messagesStats.misses,
        hitRate:
          messagesStats.hits > 0
            ? ((messagesStats.hits / (messagesStats.hits + messagesStats.misses)) * 100).toFixed(2)
            : 0,
        uniqueJids: Object.keys(jidStats).length,
        topJids: Object.entries(jidStats)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5),
      },

      events: {
        totalEvents: eventKeys.length,
        hits: eventsStats.hits,
        misses: eventsStats.misses,
        hitRate:
          eventsStats.hits > 0
            ? ((eventsStats.hits / (eventsStats.hits + eventsStats.misses)) * 100).toFixed(2)
            : 0,
        eventTypes: eventTypes,
        topEventTypes: Object.entries(eventTypes)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10),
      },

      groups: {
        totalGroups: groupKeys.length,
        hits: groupsStats.hits,
        misses: groupsStats.misses,
        hitRate:
          groupsStats.hits > 0
            ? ((groupsStats.hits / (groupsStats.hits + groupsStats.misses)) * 100).toFixed(2)
            : 0,
      },

      contacts: {
        totalContacts: contactKeys.length,
        hits: contactsStats.hits,
        misses: contactsStats.misses,
        hitRate:
          contactsStats.hits > 0
            ? ((contactsStats.hits / (contactsStats.hits + contactsStats.misses)) * 100).toFixed(2)
            : 0,
      },

      chats: {
        totalChats: chatKeys.length,
        hits: chatsStats.hits,
        misses: chatsStats.misses,
        hitRate:
          chatsStats.hits > 0
            ? ((chatsStats.hits / (chatsStats.hits + chatsStats.misses)) * 100).toFixed(2)
            : 0,
      },

      totals: {
        allKeys:
          messageKeys.length +
          eventKeys.length +
          groupKeys.length +
          contactKeys.length +
          chatKeys.length,
        allHits:
          messagesStats.hits +
          eventsStats.hits +
          groupsStats.hits +
          contactsStats.hits +
          chatsStats.hits,
        allMisses:
          messagesStats.misses +
          eventsStats.misses +
          groupsStats.misses +
          contactsStats.misses +
          chatsStats.misses,
      },
    };
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao obter estatísticas do cache:'), error);
    return null;
  }
}

/**
 * Busca mensagens no cache por critérios específicos
 *
 * @param {Object} criteria - Critérios de busca
 * @param {string} criteria.remoteJid - JID específico
 * @param {string} criteria.messageType - Tipo de mensagem
 * @param {number} criteria.limit - Limite de resultados
 * @returns {Array} Array de mensagens encontradas
 */
function searchMessagesInCache(criteria = {}) {
  try {
    const { remoteJid, messageType, limit = 50 } = criteria;
    const keys = messagesCache.keys();
    let results = [];

    let filteredKeys = keys.filter((k) => k.startsWith('msg_'));
    if (remoteJid) {
      filteredKeys = filteredKeys.filter((k) => k.includes(`msg_${remoteJid}_`));
    }

    for (const key of filteredKeys) {
      if (results.length >= limit) break;

      const message = messagesCache.get(key);
      if (message) {
        if (!messageType || message._messageType === messageType) {
          results.push({
            ...message,
            _cacheKey: key,
          });
        }
      }
    }

    results.sort((a, b) => (b._cacheTimestamp || 0) - (a._cacheTimestamp || 0));

    console.log(
      OmniZapColors.info(`OmniZap: 🔍 Busca no cache encontrou ${results.length} mensagens`),
    );
    return results;
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao buscar mensagens no cache:'), error);
    return [];
  }
}

/**
 * Obtém mensagens recentes de um JID específico
 *
 * @param {string} remoteJid - JID do contato/grupo
 * @param {number} limit - Número máximo de mensagens
 * @returns {Array} Array de mensagens recentes
 */
function getRecentMessages(remoteJid, limit = 20) {
  try {
    const recentMessagesKey = `recent_${remoteJid}`;
    const recentMessages = messagesCache.get(recentMessagesKey) || [];

    const limitedMessages = recentMessages.slice(0, limit);

    console.log(
      OmniZapColors.info(
        `OmniZap: 📱 Recuperadas ${
          limitedMessages.length
        } mensagens recentes para ${remoteJid.substring(0, 20)}...`,
      ),
    );
    return limitedMessages;
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao obter mensagens recentes:'), error);
    return [];
  }
}

/**
 * Salva uma mensagem no cache com funcionalidades avançadas
 *
 * @param {Object} messageInfo - Informações completas da mensagem
 * @returns {void}
 */
function saveMessageToCache(messageInfo) {
  try {
    if (!messageInfo || !messageInfo.key || !messageInfo.key.remoteJid || !messageInfo.key.id) {
      console.warn(
        OmniZapColors.warning('OmniZap: ⚠️ Informações de mensagem inválidas para cache'),
      );
      return;
    }

    const cacheKey = `msg_${messageInfo.key.remoteJid}_${messageInfo.key.id}`;
    const remoteJid = messageInfo.key.remoteJid;

    const enhancedMessage = {
      ...messageInfo,
      _cached: true,
      _cacheTimestamp: Date.now(),
      _lastAccessed: Date.now(),
      _messageType: messageInfo.message ? Object.keys(messageInfo.message)[0] : 'unknown',
    };

    messagesCache.set(cacheKey, enhancedMessage);

    const recentMessagesKey = `recent_${remoteJid}`;
    let recentMessages = messagesCache.get(recentMessagesKey) || [];

    recentMessages.unshift(enhancedMessage);

    if (recentMessages.length > 100) {
      recentMessages = recentMessages.slice(0, 100);
    }

    messagesCache.set(recentMessagesKey, recentMessages, 7200);

    const counterKey = `count_${remoteJid}`;
    const currentCount = messagesCache.get(counterKey) || 0;
    messagesCache.set(counterKey, currentCount + 1, 86400);

    console.log(
      OmniZapColors.success(
        `OmniZap: 💾 Mensagem salva no cache (${cacheKey.substring(0, 50)}...)`,
      ),
    );
    console.log(
      OmniZapColors.gray(
        `OmniZap: 📊 Tipo: ${enhancedMessage._messageType} | JID: ${remoteJid.substring(0, 20)}...`,
      ),
    );

    const stats = messagesCache.getStats();
    if (stats.keys % 10 === 0) {
      console.log(
        OmniZapColors.info(
          `OmniZap: 📈 Cache Stats - Chaves: ${stats.keys}, Hits: ${stats.hits}, Misses: ${stats.misses}`,
        ),
      );
    }

    if (stats.keys > 1000) {
      console.log(
        OmniZapColors.warning(`OmniZap: ⚠️ Cache com ${stats.keys} chaves - considere limpeza`),
      );
    }
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao salvar mensagem no cache:'), error);
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

  /**
   * Recupera uma mensagem pela chave do store com sistema de cache avançado
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
      const cacheKey = `msg_${key.remoteJid}_${key.id}`;

      const cachedMessage = messagesCache.get(cacheKey);
      if (cachedMessage) {
        console.log(
          OmniZapColors.success(
            `OmniZap: ✅ Mensagem recuperada do cache (${cacheKey.substring(0, 50)}...)`,
          ),
        );

        cachedMessage._lastAccessed = Date.now();
        messagesCache.set(cacheKey, cachedMessage);

        return cachedMessage;
      }

      console.log(
        OmniZapColors.warning(
          `OmniZap: ❌ Mensagem não encontrada no cache (${cacheKey.substring(0, 50)}...)`,
        ),
      );

      const recentMessagesKey = `recent_${key.remoteJid}`;
      const recentMessages = messagesCache.get(recentMessagesKey) || [];

      const foundMessage = recentMessages.find((msg) => msg && msg.key && msg.key.id === key.id);

      if (foundMessage) {
        console.log(OmniZapColors.info(`OmniZap: 🔍 Mensagem encontrada em mensagens recentes`));
        foundMessage._lastAccessed = Date.now();
        foundMessage._foundInRecent = true;
        messagesCache.set(cacheKey, foundMessage);

        return foundMessage;
      }

      const allKeys = messagesCache.keys();
      const similarKeys = allKeys.filter((k) => k.includes(key.remoteJid) && k.includes('msg_'));

      if (similarKeys.length > 0) {
        console.log(
          OmniZapColors.gray(
            `OmniZap: 🔎 Encontradas ${similarKeys.length} mensagens similares no cache`,
          ),
        );
      }

      return undefined;
    } catch (error) {
      console.error(
        OmniZapColors.error(
          `OmniZap: ❌ Erro ao carregar mensagem (JID: ${key.remoteJid}, ID: ${key.id}):`,
        ),
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
    // === EVENTOS DE CONEXÃO ===
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      saveEventToCache('connection.update', update, connection);
      console.log(
        OmniZapColors.info(`🔗 OmniZap: Evento connection.update - Status: ${connection}`),
      );

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
                  `${OmniZapColors.error('[CONEXÃO FECHADA]')} OmniZap: Conexão fechada por erro: ${
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

    // === EVENTOS DE MENSAGENS ===
    if (events['messages.upsert']) {
      const messageUpdate = events['messages.upsert'];
      console.log(
        OmniZapColors.info(
          `📨 OmniZap: Evento messages.upsert - ${
            messageUpdate.messages?.length || 0
          } mensagem(ns)`,
        ),
      );

      // Salva evento no cache
      saveEventToCache('messages.upsert', messageUpdate, `upsert_${Date.now()}`);

      // Salva todas as mensagens recebidas no cache com processamento melhorado
      if (messageUpdate.messages && Array.isArray(messageUpdate.messages)) {
        console.log(
          OmniZapColors.info(
            `OmniZap: 📨 Processando ${messageUpdate.messages.length} mensagem(ns)`,
          ),
        );

        let savedCount = 0;
        messageUpdate.messages.forEach((messageInfo) => {
          try {
            // Adiciona informações de contexto da mensagem
            const enhancedMessageInfo = {
              ...messageInfo,
              _receivedAt: Date.now(),
              _updateType: messageUpdate.type || 'notify',
              _batchId: Date.now().toString(),
            };

            saveMessageToCache(enhancedMessageInfo);
            savedCount++;
          } catch (error) {
            console.error(
              OmniZapColors.error('OmniZap: ❌ Erro ao processar mensagem individual:'),
              error,
            );
          }
        });

        console.log(
          OmniZapColors.success(
            `OmniZap: ✅ ${savedCount}/${messageUpdate.messages.length} mensagens salvas no cache`,
          ),
        );
      }

      const omniZapMainHandler = require('../../index.js');
      omniZapMainHandler(messageUpdate, omniZapClient, QR_CODE_PATH)
        .then(() => {
          console.log(OmniZapColors.gray('OmniZap: 🎯 Handler principal executado com sucesso'));
        })
        .catch((error) => {
          console.error(
            OmniZapColors.error('OmniZap: ❌ Erro no handler principal:'),
            String(error),
          );
        });
    }

    // === EVENTOS DE ATUALIZAÇÃO DE MENSAGENS ===
    if (events['messages.update']) {
      const updates = events['messages.update'];
      console.log(
        OmniZapColors.info(
          `📝 OmniZap: Evento messages.update - ${updates?.length || 0} atualização(ões)`,
        ),
      );
      saveEventToCache('messages.update', updates, `update_${Date.now()}`);

      updates?.forEach((update, index) => {
        console.log(
          OmniZapColors.gray(
            `   ${index + 1}. Status: ${update.update?.status || 'N/A'} | JID: ${
              update.key?.remoteJid?.substring(0, 20) || 'N/A'
            }...`,
          ),
        );
      });
    }

    // === EVENTOS DE EXCLUSÃO DE MENSAGENS ===
    if (events['messages.delete']) {
      const deletion = events['messages.delete'];
      console.log(OmniZapColors.warning(`🗑️ OmniZap: Evento messages.delete`));
      saveEventToCache('messages.delete', deletion, `delete_${Date.now()}`);

      if (deletion.keys) {
        console.log(OmniZapColors.gray(`   Mensagens deletadas: ${deletion.keys.length}`));
        deletion.keys.forEach((key, index) => {
          console.log(
            OmniZapColors.gray(
              `   ${index + 1}. JID: ${key.remoteJid?.substring(
                0,
                20,
              )}... | ID: ${key.id?.substring(0, 10)}...`,
            ),
          );
        });
      }
    }

    // === EVENTOS DE REAÇÕES ===
    if (events['messages.reaction']) {
      const reactions = events['messages.reaction'];
      console.log(
        OmniZapColors.info(
          `😀 OmniZap: Evento messages.reaction - ${reactions?.length || 0} reação(ões)`,
        ),
      );
      saveEventToCache('messages.reaction', reactions, `reaction_${Date.now()}`);

      reactions?.forEach((reaction, index) => {
        const emoji = reaction.reaction?.text || '❓';
        const jid = reaction.key?.remoteJid?.substring(0, 20) || 'N/A';
        console.log(OmniZapColors.gray(`   ${index + 1}. ${emoji} | JID: ${jid}...`));
      });
    }

    // === EVENTOS DE RECIBO DE MENSAGEM ===
    if (events['message-receipt.update']) {
      const receipts = events['message-receipt.update'];
      console.log(
        OmniZapColors.info(
          `📬 OmniZap: Evento message-receipt.update - ${receipts?.length || 0} recibo(s)`,
        ),
      );
      saveEventToCache('message-receipt.update', receipts, `receipt_${Date.now()}`);

      receipts?.forEach((receipt, index) => {
        const status = receipt.receipt?.readTimestamp
          ? '✓✓ Lida'
          : receipt.receipt?.receiptTimestamp
          ? '✓✓ Entregue'
          : '✓ Enviada';
        const jid = receipt.key?.remoteJid?.substring(0, 20) || 'N/A';
        console.log(OmniZapColors.gray(`   ${index + 1}. ${status} | JID: ${jid}...`));
      });
    }

    // === EVENTOS DE HISTÓRICO DE MENSAGENS ===
    if (events['messaging-history.set']) {
      const historyData = events['messaging-history.set'];
      console.log(OmniZapColors.info(`📚 OmniZap: Evento messaging-history.set`));
      saveEventToCache('messaging-history.set', historyData, `history_${Date.now()}`);

      if (historyData.messages) {
        console.log(
          OmniZapColors.gray(`   Mensagens no histórico: ${historyData.messages.length}`),
        );
      }
      if (historyData.chats) {
        console.log(OmniZapColors.gray(`   Chats no histórico: ${historyData.chats.length}`));
      }
    }

    // === EVENTOS DE GRUPOS ===
    if (events['groups.update']) {
      const updates = events['groups.update'];
      console.log(
        OmniZapColors.info(
          `👥 OmniZap: Evento groups.update - ${updates?.length || 0} atualização(ões)`,
        ),
      );
      saveEventToCache('groups.update', updates, `groups_update_${Date.now()}`);

      updates?.forEach((update, index) => {
        const jid = update.id?.substring(0, 30) || 'N/A';
        console.log(OmniZapColors.gray(`   ${index + 1}. Grupo: ${jid}...`));
        if (update.id) {
          saveGroupMetadataToCache(update.id, update);
        }
      });
    }

    if (events['groups.upsert']) {
      const groupsMetadata = events['groups.upsert'];
      console.log(
        OmniZapColors.info(
          `👥 OmniZap: Evento groups.upsert - ${groupsMetadata?.length || 0} grupo(s)`,
        ),
      );
      saveEventToCache('groups.upsert', groupsMetadata, `groups_upsert_${Date.now()}`);

      groupsMetadata?.forEach((group, index) => {
        const jid = group.id?.substring(0, 30) || 'N/A';
        const subject = group.subject || 'Sem nome';
        console.log(OmniZapColors.gray(`   ${index + 1}. ${subject} | JID: ${jid}...`));
        saveGroupMetadataToCache(group.id, group);
      });
    }

    if (events['group-participants.update']) {
      const event = events['group-participants.update'];
      console.log(OmniZapColors.info(`👥 OmniZap: Evento group-participants.update`));
      saveEventToCache('group-participants.update', event, `participants_${Date.now()}`);

      const jid = event.id?.substring(0, 30) || 'N/A';
      const action = event.action || 'N/A';
      const participants = event.participants?.length || 0;
      console.log(
        OmniZapColors.gray(
          `   Grupo: ${jid}... | Ação: ${action} | Participantes: ${participants}`,
        ),
      );
    }

    // === EVENTOS DE CHATS ===
    if (events['chats.upsert']) {
      const chats = events['chats.upsert'];
      console.log(
        OmniZapColors.info(`💬 OmniZap: Evento chats.upsert - ${chats?.length || 0} chat(s)`),
      );
      saveEventToCache('chats.upsert', chats, `chats_upsert_${Date.now()}`);

      chats?.forEach((chat, index) => {
        const jid = chat.id?.substring(0, 30) || 'N/A';
        const name = chat.name || 'Sem nome';
        console.log(OmniZapColors.gray(`   ${index + 1}. ${name} | JID: ${jid}...`));
        saveChatToCache(chat);
      });
    }

    if (events['chats.update']) {
      const updates = events['chats.update'];
      console.log(
        OmniZapColors.info(
          `💬 OmniZap: Evento chats.update - ${updates?.length || 0} atualização(ões)`,
        ),
      );
      saveEventToCache('chats.update', updates, `chats_update_${Date.now()}`);

      updates?.forEach((update, index) => {
        const jid = update.id?.substring(0, 30) || 'N/A';
        console.log(OmniZapColors.gray(`   ${index + 1}. Chat: ${jid}...`));
        saveChatToCache(update);
      });
    }

    if (events['chats.delete']) {
      const jids = events['chats.delete'];
      console.log(
        OmniZapColors.warning(
          `💬 OmniZap: Evento chats.delete - ${jids?.length || 0} chat(s) deletado(s)`,
        ),
      );
      saveEventToCache('chats.delete', jids, `chats_delete_${Date.now()}`);

      jids?.forEach((jid, index) => {
        console.log(
          OmniZapColors.gray(`   ${index + 1}. JID deletado: ${jid.substring(0, 30)}...`),
        );
      });
    }

    // === EVENTOS DE CONTATOS ===
    if (events['contacts.upsert']) {
      const contacts = events['contacts.upsert'];
      console.log(
        OmniZapColors.info(
          `👤 OmniZap: Evento contacts.upsert - ${contacts?.length || 0} contato(s)`,
        ),
      );
      saveEventToCache('contacts.upsert', contacts, `contacts_upsert_${Date.now()}`);

      contacts?.forEach((contact, index) => {
        const jid = contact.id?.substring(0, 30) || 'N/A';
        const name = contact.name || contact.notify || 'Sem nome';
        console.log(OmniZapColors.gray(`   ${index + 1}. ${name} | JID: ${jid}...`));
        saveContactToCache(contact);
      });
    }

    if (events['contacts.update']) {
      const updates = events['contacts.update'];
      console.log(
        OmniZapColors.info(
          `👤 OmniZap: Evento contacts.update - ${updates?.length || 0} atualização(ões)`,
        ),
      );
      saveEventToCache('contacts.update', updates, `contacts_update_${Date.now()}`);

      updates?.forEach((update, index) => {
        const jid = update.id?.substring(0, 30) || 'N/A';
        const name = update.name || update.notify || 'Sem nome';
        console.log(OmniZapColors.gray(`   ${index + 1}. ${name} | JID: ${jid}...`));
        saveContactToCache(update);
      });
    }

    // === EVENTOS DE BLOCKLIST ===
    if (events['blocklist.set']) {
      const data = events['blocklist.set'];
      console.log(
        OmniZapColors.warning(
          `🚫 OmniZap: Evento blocklist.set - ${data.blocklist?.length || 0} bloqueio(s)`,
        ),
      );
      saveEventToCache('blocklist.set', data, `blocklist_set_${Date.now()}`);

      data.blocklist?.forEach((jid, index) => {
        console.log(OmniZapColors.gray(`   ${index + 1}. Bloqueado: ${jid.substring(0, 30)}...`));
      });
    }

    if (events['blocklist.update']) {
      const data = events['blocklist.update'];
      console.log(
        OmniZapColors.warning(`🚫 OmniZap: Evento blocklist.update - Ação: ${data.action}`),
      );
      saveEventToCache('blocklist.update', data, `blocklist_update_${Date.now()}`);

      data.jids?.forEach((jid, index) => {
        const action = data.action === 'block' ? 'Bloqueado' : 'Desbloqueado';
        console.log(OmniZapColors.gray(`   ${index + 1}. ${action}: ${jid.substring(0, 30)}...`));
      });
    }

    // === EVENTOS DE CHAMADAS ===
    if (events['call']) {
      const callEvents = events['call'];
      console.log(
        OmniZapColors.info(`📞 OmniZap: Evento call - ${callEvents?.length || 0} chamada(s)`),
      );
      saveEventToCache('call', callEvents, `call_${Date.now()}`);

      callEvents?.forEach((callEvent, index) => {
        const from = callEvent.from?.substring(0, 30) || 'N/A';
        const status = callEvent.status || 'N/A';
        const isVideo = callEvent.isVideo ? '📹 Vídeo' : '📞 Voz';
        console.log(
          OmniZapColors.gray(`   ${index + 1}. ${isVideo} | De: ${from}... | Status: ${status}`),
        );
      });
    }

    // === EVENTOS DE PRESENÇA ===
    if (events['presence.update']) {
      const data = events['presence.update'];
      console.log(OmniZapColors.info(`👁️ OmniZap: Evento presence.update`));
      saveEventToCache('presence.update', data, `presence_${Date.now()}`);

      const jid = data.id?.substring(0, 30) || 'N/A';
      const presences = Object.keys(data.presences || {}).join(', ') || 'N/A';
      console.log(OmniZapColors.gray(`   JID: ${jid}... | Presenças: ${presences}`));
    }

    // === EVENTOS DE CREDENCIAIS ===
    if (events['creds.update']) {
      console.log(OmniZapColors.info(`🔐 OmniZap: Evento creds.update - Salvando credenciais`));
      saveEventToCache('creds.update', { timestamp: Date.now() }, `creds_${Date.now()}`);
      await saveCreds();
    }
  });
}

initializeOmniZapConnection().catch(async (error) => {
  return console.log(OmniZapColors.error('OmniZap: Erro ao inicializar o sistema: ' + error));
});

module.exports = {
  getCacheStats,
  searchMessagesInCache,
  getRecentMessages,
  clearMessagesCache,
  saveMessageToCache,
  saveEventToCache,
  saveGroupMetadataToCache,
  saveContactToCache,
  saveChatToCache,
  messagesCache,
  eventsCache,
  groupMetadataCache,
  contactsCache,
  chatsCache,
};

console.log(
  OmniZapColors.success('🚀 OmniZap: Sistema de cache avançado inicializado com sucesso!'),
);
console.log(OmniZapColors.info('📋 Funcionalidades disponíveis:'));
console.log(OmniZapColors.gray('   • Cache inteligente de mensagens'));
console.log(OmniZapColors.gray('   • Busca por critérios específicos'));
console.log(OmniZapColors.gray('   • Mensagens recentes por JID'));
console.log(OmniZapColors.gray('   • Limpeza automática inteligente'));
console.log(OmniZapColors.gray('   • Estatísticas detalhadas'));
console.log(OmniZapColors.gray('   • Sistema de backup'));

setInterval(() => {
  const stats = getCacheStats();
  if (stats) {
    console.log(OmniZapColors.primary('📊 ═══ OmniZap Cache Statistics ═══'));

    console.log(OmniZapColors.info('💬 MENSAGENS:'));
    console.log(OmniZapColors.gray(`   💾 Total de mensagens: ${stats.messages.totalMessages}`));
    console.log(OmniZapColors.gray(`   📝 Listas recentes: ${stats.messages.recentLists}`));
    console.log(OmniZapColors.gray(`   🔢 Contadores: ${stats.messages.counters}`));
    console.log(OmniZapColors.success(`   ✅ Cache hits: ${stats.messages.hits}`));
    console.log(OmniZapColors.warning(`   ❌ Cache misses: ${stats.messages.misses}`));
    console.log(OmniZapColors.primary(`   📈 Taxa de acerto: ${stats.messages.hitRate}%`));
    console.log(OmniZapColors.gray(`   👥 JIDs únicos: ${stats.messages.uniqueJids}`));

    console.log(OmniZapColors.info('🔄 EVENTOS:'));
    console.log(OmniZapColors.gray(`   🎯 Total de eventos: ${stats.events.totalEvents}`));
    console.log(OmniZapColors.success(`   ✅ Cache hits: ${stats.events.hits}`));
    console.log(OmniZapColors.warning(`   ❌ Cache misses: ${stats.events.misses}`));
    console.log(OmniZapColors.primary(`   📈 Taxa de acerto: ${stats.events.hitRate}%`));

    if (stats.events.topEventTypes.length > 0) {
      console.log(OmniZapColors.gray('   🏆 Top Tipos de Eventos:'));
      stats.events.topEventTypes.forEach(([type, count], index) => {
        console.log(OmniZapColors.gray(`      ${index + 1}. ${type}: ${count} eventos`));
      });
    }

    console.log(OmniZapColors.info('👥 GRUPOS:'));
    console.log(OmniZapColors.gray(`   📝 Total de grupos: ${stats.groups.totalGroups}`));
    console.log(OmniZapColors.primary(`   📈 Taxa de acerto: ${stats.groups.hitRate}%`));

    console.log(OmniZapColors.info('👤 CONTATOS:'));
    console.log(OmniZapColors.gray(`   📝 Total de contatos: ${stats.contacts.totalContacts}`));
    console.log(OmniZapColors.primary(`   📈 Taxa de acerto: ${stats.contacts.hitRate}%`));

    console.log(OmniZapColors.info('💬 CHATS:'));
    console.log(OmniZapColors.gray(`   📝 Total de chats: ${stats.chats.totalChats}`));
    console.log(OmniZapColors.primary(`   📈 Taxa de acerto: ${stats.chats.hitRate}%`));

    console.log(OmniZapColors.info('🎯 TOTAIS GERAIS:'));
    console.log(OmniZapColors.gray(`   🗝️ Total de chaves: ${stats.totals.allKeys}`));
    console.log(OmniZapColors.success(`   ✅ Total de hits: ${stats.totals.allHits}`));
    console.log(OmniZapColors.warning(`   ❌ Total de misses: ${stats.totals.allMisses}`));

    const overallHitRate =
      stats.totals.allHits > 0
        ? ((stats.totals.allHits / (stats.totals.allHits + stats.totals.allMisses)) * 100).toFixed(
            2,
          )
        : 0;
    console.log(OmniZapColors.primary(`   📈 Taxa geral de acerto: ${overallHitRate}%`));

    if (stats.messages.topJids.length > 0) {
      console.log(OmniZapColors.gray('   🏆 Top JIDs (Mensagens):'));
      stats.messages.topJids.forEach(([jid, count], index) => {
        console.log(
          OmniZapColors.gray(`      ${index + 1}. ${jid.substring(0, 15)}... (${count} msgs)`),
        );
      });
    }

    console.log(OmniZapColors.primary('═══════════════════════════════════'));
  }
}, 30 * 60 * 1000);

setInterval(() => {
  try {
    const stats = getCacheStats();
    const shouldClean =
      stats &&
      (stats.totals.allKeys > 3000 ||
        stats.messages.totalMessages > 1500 ||
        stats.events.totalEvents > 1000 ||
        (stats.totals.allHits > 0 &&
          (stats.totals.allHits / (stats.totals.allHits + stats.totals.allMisses)) * 100 < 30));

    if (shouldClean) {
      console.log(
        OmniZapColors.warning(
          '🧹 OmniZap: Iniciando limpeza automática inteligente de todos os caches...',
        ),
      );

      let totalRemoved = 0;

      const messageKeys = messagesCache.keys();
      const messageKeysFiltered = messageKeys.filter((k) => k.startsWith('msg_'));

      if (messageKeysFiltered.length > 500) {
        const messagesWithTimestamp = [];

        messageKeysFiltered.forEach((key) => {
          const msg = messagesCache.get(key);
          if (msg && msg._cacheTimestamp) {
            messagesWithTimestamp.push({
              key,
              timestamp: msg._cacheTimestamp,
              lastAccessed: msg._lastAccessed || msg._cacheTimestamp,
            });
          }
        });

        messagesWithTimestamp.sort((a, b) => a.lastAccessed - b.lastAccessed);
        const toRemove = messagesWithTimestamp.slice(0, messagesWithTimestamp.length - 500);

        toRemove.forEach(({ key }) => {
          messagesCache.del(key);
          totalRemoved++;
        });

        console.log(
          OmniZapColors.success(`🧹 OmniZap: ${toRemove.length} mensagens antigas removidas`),
        );
      }

      const eventKeys = eventsCache.keys();
      if (eventKeys.length > 200) {
        const eventsWithTimestamp = [];

        eventKeys.forEach((key) => {
          const event = eventsCache.get(key);
          if (event && event._cacheTimestamp) {
            eventsWithTimestamp.push({
              key,
              timestamp: event._cacheTimestamp,
            });
          }
        });

        eventsWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = eventsWithTimestamp.slice(0, eventsWithTimestamp.length - 200);

        toRemove.forEach(({ key }) => {
          eventsCache.del(key);
          totalRemoved++;
        });

        console.log(
          OmniZapColors.success(`🧹 OmniZap: ${toRemove.length} eventos antigos removidos`),
        );
      }

      const counterKeys = messageKeys.filter((k) => k.startsWith('count_'));
      if (counterKeys.length > 0) {
        counterKeys.forEach((key) => {
          messagesCache.del(key);
          totalRemoved++;
        });
        console.log(OmniZapColors.info(`🧹 OmniZap: ${counterKeys.length} contadores limpos`));
      }

      const groupKeys = groupMetadataCache.keys();
      let groupsRemoved = 0;
      if (groupKeys.length > 100) {
        const groupsWithTimestamp = [];

        groupKeys.forEach((key) => {
          const group = groupMetadataCache.get(key);
          if (group && group._cacheTimestamp) {
            groupsWithTimestamp.push({
              key,
              timestamp: group._cacheTimestamp,
            });
          }
        });

        if (groupsWithTimestamp.length > 100) {
          groupsWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);
          const toRemove = groupsWithTimestamp.slice(0, groupsWithTimestamp.length - 100);

          toRemove.forEach(({ key }) => {
            groupMetadataCache.del(key);
            groupsRemoved++;
            totalRemoved++;
          });
        }

        if (groupsRemoved > 0) {
          console.log(OmniZapColors.info(`🧹 OmniZap: ${groupsRemoved} grupos antigos removidos`));
        }
      }

      const contactKeys = contactsCache.keys();
      let contactsRemoved = 0;
      if (contactKeys.length > 200) {
        const contactsWithTimestamp = [];

        contactKeys.forEach((key) => {
          const contact = contactsCache.get(key);
          if (contact && contact._cacheTimestamp) {
            contactsWithTimestamp.push({
              key,
              timestamp: contact._cacheTimestamp,
            });
          }
        });

        if (contactsWithTimestamp.length > 200) {
          contactsWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);
          const toRemove = contactsWithTimestamp.slice(0, contactsWithTimestamp.length - 200);

          toRemove.forEach(({ key }) => {
            contactsCache.del(key);
            contactsRemoved++;
            totalRemoved++;
          });
        }

        if (contactsRemoved > 0) {
          console.log(
            OmniZapColors.info(`🧹 OmniZap: ${contactsRemoved} contatos antigos removidos`),
          );
        }
      }

      const chatKeys = chatsCache.keys();
      let chatsRemoved = 0;
      if (chatKeys.length > 150) {
        const chatsWithTimestamp = [];

        chatKeys.forEach((key) => {
          const chat = chatsCache.get(key);
          if (chat && chat._cacheTimestamp) {
            chatsWithTimestamp.push({
              key,
              timestamp: chat._cacheTimestamp,
            });
          }
        });

        if (chatsWithTimestamp.length > 150) {
          chatsWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);
          const toRemove = chatsWithTimestamp.slice(0, chatsWithTimestamp.length - 150);

          toRemove.forEach(({ key }) => {
            chatsCache.del(key);
            chatsRemoved++;
            totalRemoved++;
          });
        }

        if (chatsRemoved > 0) {
          console.log(OmniZapColors.info(`🧹 OmniZap: ${chatsRemoved} chats antigos removidos`));
        }
      }

      const newStats = getCacheStats();
      console.log(
        OmniZapColors.success(
          `✅ OmniZap: Limpeza concluída - ${totalRemoved} itens removidos - ${newStats.totals.allKeys} chaves restantes`,
        ),
      );
    } else {
      console.log(
        OmniZapColors.gray('🧹 OmniZap: Todos os caches em bom estado - limpeza não necessária'),
      );
    }
  } catch (error) {
    console.error(OmniZapColors.error('🧹 OmniZap: Erro na limpeza automática:'), error);
  }
}, 2 * 60 * 60 * 1000);

setInterval(() => {
  try {
    const stats = getCacheStats();
    if (stats) {
      const backup = {
        timestamp: new Date().toISOString(),
        stats: stats,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cacheDetails: {
          messages: {
            keys: messagesCache.keys().length,
            size: JSON.stringify(messagesCache.keys()).length,
          },
          events: {
            keys: eventsCache.keys().length,
            size: JSON.stringify(eventsCache.keys()).length,
          },
          groups: {
            keys: groupMetadataCache.keys().length,
            size: JSON.stringify(groupMetadataCache.keys()).length,
          },
          contacts: {
            keys: contactsCache.keys().length,
            size: JSON.stringify(contactsCache.keys()).length,
          },
          chats: {
            keys: chatsCache.keys().length,
            size: JSON.stringify(chatsCache.keys()).length,
          },
        },
      };

      messagesCache.set('omnizap_stats_backup', backup, 86400);
      eventsCache.set('omnizap_stats_backup', backup, 86400);

      console.log(OmniZapColors.gray('💾 OmniZap: Backup completo de estatísticas salvo'));
      console.log(
        OmniZapColors.gray(
          `💾 OmniZap: Total de ${stats.totals.allKeys} chaves em ${
            Object.keys(backup.cacheDetails).length
          } caches`,
        ),
      );
    }
  } catch (error) {
    console.error(OmniZapColors.error('💾 OmniZap: Erro ao salvar backup de estatísticas:'), error);
  }
}, 60 * 60 * 1000);
