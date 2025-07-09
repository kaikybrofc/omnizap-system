/**
 * OmniZap Cache Manager
 *
 * Módulo responsável pelo gerenciamento avançado de cache
 * Funciona de forma independente e assíncrona
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const NodeCache = require('node-cache');
const logger = require('../utils/logger/loggerModule');
const { cleanEnv, num, bool } = require('envalid');
const fs = require('fs').promises;
const path = require('path');

const env = cleanEnv(process.env, {
  CACHE_MESSAGES_TTL: num({
    default: 3600,
    desc: 'Tempo de vida do cache de mensagens em segundos',
  }),
  CACHE_EVENTS_TTL: num({ default: 1800, desc: 'Tempo de vida do cache de eventos em segundos' }),
  CACHE_GROUPS_TTL: num({ default: 7200, desc: 'Tempo de vida do cache de grupos em segundos' }),
  CACHE_CONTACTS_TTL: num({
    default: 14400,
    desc: 'Tempo de vida do cache de contatos em segundos',
  }),
  CACHE_CHATS_TTL: num({ default: 3600, desc: 'Tempo de vida do cache de chats em segundos' }),

  CACHE_MESSAGES_CHECK: num({
    default: 600,
    desc: 'Período de verificação do cache de mensagens em segundos',
  }),
  CACHE_EVENTS_CHECK: num({
    default: 300,
    desc: 'Período de verificação do cache de eventos em segundos',
  }),
  CACHE_GROUPS_CHECK: num({
    default: 600,
    desc: 'Período de verificação do cache de grupos em segundos',
  }),
  CACHE_CONTACTS_CHECK: num({
    default: 600,
    desc: 'Período de verificação do cache de contatos em segundos',
  }),
  CACHE_CHATS_CHECK: num({
    default: 600,
    desc: 'Período de verificação do cache de chats em segundos',
  }),

  CACHE_USE_CLONES: bool({ default: false, desc: 'Usar clones para objetos no cache' }),

  CACHE_AUTO_CLEAN: bool({ default: true, desc: 'Ativar limpeza automática do cache' }),
  CACHE_MAX_TOTAL_KEYS: num({
    default: 3000,
    desc: 'Número máximo de chaves no cache antes da limpeza',
  }),
  CACHE_MAX_MESSAGES: num({
    default: 1500,
    desc: 'Número máximo de mensagens no cache antes da limpeza',
  }),
  CACHE_MAX_EVENTS: num({
    default: 1000,
    desc: 'Número máximo de eventos no cache antes da limpeza',
  }),
  CACHE_MESSAGES_KEEP: num({ default: 500, desc: 'Número de mensagens a manter após limpeza' }),
  CACHE_EVENTS_KEEP: num({ default: 200, desc: 'Número de eventos a manter após limpeza' }),
});

// Definir caminhos para arquivo de cache persistente de grupos
const TEMP_DIR = path.join(process.cwd(), 'temp');
const GROUP_METADATA_FILE = path.join(TEMP_DIR, 'groupMetadata.json');
const MESSAGES_CACHE_FILE = path.join(TEMP_DIR, 'messagesCache.json');
const EVENTS_CACHE_FILE = path.join(TEMP_DIR, 'eventsCache.json');

const messagesCache = new NodeCache({
  stdTTL: env.CACHE_MESSAGES_TTL,
  checkperiod: env.CACHE_MESSAGES_CHECK,
  useClones: env.CACHE_USE_CLONES,
});

const eventsCache = new NodeCache({
  stdTTL: env.CACHE_EVENTS_TTL,
  checkperiod: env.CACHE_EVENTS_CHECK,
  useClones: env.CACHE_USE_CLONES,
});

const contactsCache = new NodeCache({
  stdTTL: env.CACHE_CONTACTS_TTL,
  checkperiod: env.CACHE_CONTACTS_CHECK,
  useClones: env.CACHE_USE_CLONES,
});

const chatsCache = new NodeCache({
  stdTTL: env.CACHE_CHATS_TTL,
  checkperiod: env.CACHE_CHATS_CHECK,
  useClones: env.CACHE_USE_CLONES,
});

messagesCache.on('expired', (key, value) => {
  logger.debug(`OmniZap Cache: Mensagem expirada: ${key}`);
});

messagesCache.on('flush', () => {
  logger.warn('OmniZap Cache: Cache de mensagens foi limpo');
});

eventsCache.on('expired', (key, value) => {
  logger.debug(`OmniZap Cache: Evento expirado: ${key}`);
});

eventsCache.on('flush', () => {
  logger.warn('OmniZap Cache: Cache de eventos foi limpo');
});

contactsCache.on('expired', (key, value) => {
  logger.debug(`OmniZap Cache: Contato expirado: ${key}`);
});

chatsCache.on('expired', (key, value) => {
  logger.debug(`OmniZap Cache: Chat expirado: ${key}`);
});

/**
 * Classe principal do gerenciador de cache
 */
class CacheManager {
  constructor() {
    this.initialized = false;
    this.init();
  }

  /**
   * Inicializa o gerenciador de cache
   */
  async init() {
    logger.info('🔄 OmniZap Cache: Sistema inicializado');
    logger.info('📊 Configurações de cache carregadas das variáveis de ambiente');

    logger.debug(`🔄 TTL (segundos): Msgs=${env.CACHE_MESSAGES_TTL} | Eventos=${env.CACHE_EVENTS_TTL} | Grupos=${env.CACHE_GROUPS_TTL} | Contatos=${env.CACHE_CONTACTS_TTL} | Chats=${env.CACHE_CHATS_TTL}`);

    logger.debug(`🔄 Verificação (segundos): Msgs=${env.CACHE_MESSAGES_CHECK} | Eventos=${env.CACHE_EVENTS_CHECK} | Grupos=${env.CACHE_GROUPS_CHECK} | Contatos=${env.CACHE_CONTACTS_CHECK} | Chats=${env.CACHE_CHATS_CHECK}`);

    logger.debug(`🔄 Limpeza automática: ${env.CACHE_AUTO_CLEAN ? 'Ativada' : 'Desativada'}`);
    if (env.CACHE_AUTO_CLEAN) {
      logger.debug(`🔄 Limites de limpeza: Total=${env.CACHE_MAX_TOTAL_KEYS} | Msgs=${env.CACHE_MAX_MESSAGES} | Eventos=${env.CACHE_MAX_EVENTS}`);
      logger.debug(`🔄 Manter após limpeza: Msgs=${env.CACHE_MESSAGES_KEEP} | Eventos=${env.CACHE_EVENTS_KEEP}`);
    }

    try {
      await fs.mkdir(TEMP_DIR, { recursive: true });

      // Verifica e cria o arquivo de metadados de grupos
      try {
        await fs.access(GROUP_METADATA_FILE);
        logger.info('Cache: Arquivo de metadados de grupos encontrado');
      } catch (error) {
        await fs.writeFile(GROUP_METADATA_FILE, JSON.stringify({}, null, 2));
        logger.info('Cache: Arquivo de metadados de grupos criado');
      }

      // Verifica e cria o arquivo de cache de mensagens
      try {
        await fs.access(MESSAGES_CACHE_FILE);
        logger.info('Cache: Arquivo de cache de mensagens encontrado');
      } catch (error) {
        await fs.writeFile(
          MESSAGES_CACHE_FILE,
          JSON.stringify(
            {
              messages: {},
              recentByChat: {},
              counters: {},
            },
            null,
            2,
          ),
        );
        logger.info('Cache: Arquivo de cache de mensagens criado');
      }

      // Verifica e cria o arquivo de cache de eventos
      try {
        await fs.access(EVENTS_CACHE_FILE);
        logger.info('Cache: Arquivo de cache de eventos encontrado');
      } catch (error) {
        await fs.writeFile(
          EVENTS_CACHE_FILE,
          JSON.stringify(
            {
              events: {},
              recentByType: {},
            },
            null,
            2,
          ),
        );
        logger.info('Cache: Arquivo de cache de eventos criado');
      }
    } catch (error) {
      logger.error('Cache: Erro ao verificar diretórios e arquivos:', {
        error: error.message,
        stack: error.stack,
      });
    }

    this.initialized = true;
  }

  /**
   * Lê o arquivo de metadados de grupos
   * @private
   * @returns {Promise<Object>} Objeto com todos os metadados de grupos
   */
  async _readGroupMetadataFile() {
    try {
      const data = await fs.readFile(GROUP_METADATA_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Cache: Erro ao ler arquivo de metadados de grupos:', {
        error: error.message,
        stack: error.stack,
      });
      return {};
    }
  }

  /**
   * Escreve no arquivo de metadados de grupos
   * @private
   * @param {Object} data - Dados a serem escritos
   */
  async _writeGroupMetadataFile(data) {
    try {
      await fs.writeFile(GROUP_METADATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Cache: Erro ao escrever no arquivo de metadados de grupos:', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Lê o arquivo de cache de mensagens
   * @private
   * @returns {Promise<Object>} Objeto com todas as mensagens em cache
   */
  async _readMessagesCacheFile() {
    try {
      const data = await fs.readFile(MESSAGES_CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Cache: Erro ao ler arquivo de cache de mensagens:', {
        error: error.message,
        stack: error.stack,
      });
      return { messages: {}, recentByChat: {}, counters: {} };
    }
  }

  /**
   * Escreve no arquivo de cache de mensagens
   * @private
   * @param {Object} data - Dados a serem escritos
   */
  async _writeMessagesCacheFile(data) {
    try {
      await fs.writeFile(MESSAGES_CACHE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Cache: Erro ao escrever no arquivo de cache de mensagens:', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Lê o arquivo de cache de eventos
   * @private
   * @returns {Promise<Object>} Objeto com todos os eventos em cache
   */
  async _readEventsCacheFile() {
    try {
      const data = await fs.readFile(EVENTS_CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Cache: Erro ao ler arquivo de cache de eventos:', {
        error: error.message,
        stack: error.stack,
      });
      return { events: {}, recentByType: {} };
    }
  }

  /**
   * Escreve no arquivo de cache de eventos
   * @private
   * @param {Object} data - Dados a serem escritos
   */
  async _writeEventsCacheFile(data) {
    try {
      await fs.writeFile(EVENTS_CACHE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Cache: Erro ao escrever no arquivo de cache de eventos:', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Salva uma mensagem no cache e em arquivo para persistência
   */
  async saveMessage(messageInfo) {
    try {
      if (!messageInfo || !messageInfo.key || !messageInfo.key.remoteJid || !messageInfo.key.id) {
        logger.warn('Cache: Dados de mensagem inválidos');
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

      // Salvar no cache em memória
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

      // Salvar em arquivo para persistência
      setImmediate(async () => {
        try {
          // Ler o arquivo atual
          const allMessages = await this._readMessagesCacheFile();

          // Adicionar a nova mensagem
          allMessages.messages[cacheKey] = enhancedMessage;

          // Atualizar mensagens recentes para este chat
          if (!allMessages.recentByChat[remoteJid]) {
            allMessages.recentByChat[remoteJid] = [];
          }

          allMessages.recentByChat[remoteJid].unshift({
            id: messageInfo.key.id,
            timestamp: enhancedMessage._cacheTimestamp,
            messageType: enhancedMessage._messageType,
            key: cacheKey,
          });

          // Manter apenas as 100 mensagens mais recentes por chat
          if (allMessages.recentByChat[remoteJid].length > 100) {
            allMessages.recentByChat[remoteJid] = allMessages.recentByChat[remoteJid].slice(0, 100);
          }

          // Atualizar contadores
          if (!allMessages.counters[remoteJid]) {
            allMessages.counters[remoteJid] = 0;
          }
          allMessages.counters[remoteJid]++;

          // Salvar de volta no arquivo
          await this._writeMessagesCacheFile(allMessages);

          logger.debug(`Cache: Mensagem salva em arquivo (${cacheKey.substring(0, 50)}...)`);
        } catch (error) {
          logger.error('Cache: Erro ao salvar mensagem em arquivo:', {
            error: error.message,
            stack: error.stack,
          });
        }
      });

      logger.debug(`Cache: Mensagem salva (${cacheKey.substring(0, 50)}...)`);
    } catch (error) {
      logger.error('Cache: Erro ao salvar mensagem:', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Salva evento no cache e em arquivo para persistência
   */
  async saveEvent(eventType, eventData, eventId = null) {
    try {
      if (!eventType || !eventData) {
        logger.warn('Cache: Dados de evento inválidos');
        return;
      }

      const timestamp = Date.now();
      const cacheKey = eventId ? `event_${eventType}_${eventId}_${timestamp}` : `event_${eventType}_${timestamp}`;

      const enhancedEvent = {
        ...eventData,
        _eventType: eventType,
        _cached: true,
        _cacheTimestamp: timestamp,
        _eventId: eventId,
      };

      // Salvar no cache em memória
      eventsCache.set(cacheKey, enhancedEvent);

      const recentEventsKey = `recent_events_${eventType}`;
      let recentEvents = eventsCache.get(recentEventsKey) || [];
      recentEvents.unshift(enhancedEvent);

      if (recentEvents.length > 50) {
        recentEvents = recentEvents.slice(0, 50);
      }

      eventsCache.set(recentEventsKey, recentEvents, 3600);

      // Salvar em arquivo para persistência
      setImmediate(async () => {
        try {
          // Ler o arquivo atual
          const allEvents = await this._readEventsCacheFile();

          // Adicionar o novo evento
          allEvents.events[cacheKey] = enhancedEvent;

          // Atualizar eventos recentes para este tipo
          if (!allEvents.recentByType[eventType]) {
            allEvents.recentByType[eventType] = [];
          }

          allEvents.recentByType[eventType].unshift({
            id: eventId || timestamp.toString(),
            timestamp: timestamp,
            key: cacheKey,
          });

          // Manter apenas os 50 eventos mais recentes por tipo
          if (allEvents.recentByType[eventType].length > 50) {
            allEvents.recentByType[eventType] = allEvents.recentByType[eventType].slice(0, 50);
          }

          // Salvar de volta no arquivo
          await this._writeEventsCacheFile(allEvents);

          logger.debug(`Cache: Evento ${eventType} salvo em arquivo (${cacheKey.substring(0, 50)}...)`);
        } catch (error) {
          logger.error('Cache: Erro ao salvar evento em arquivo:', {
            error: error.message,
            stack: error.stack,
          });
        }
      });

      logger.debug(`Cache: Evento ${eventType} salvo (${cacheKey.substring(0, 50)}...)`);
    } catch (error) {
      logger.error('Cache: Erro ao salvar evento:', { error: error.message, stack: error.stack });
    }
  }

  /**
   * Salva metadados de grupo no cache persistente em arquivo
   */
  async saveGroupMetadata(jid, metadata) {
    try {
      if (!jid || !metadata) {
        logger.warn('Cache: Dados de grupo inválidos');
        return;
      }

      const enhancedMetadata = {
        ...metadata,
        _cached: true,
        _cacheTimestamp: Date.now(),
        _jid: jid,
      };

      const allMetadata = await this._readGroupMetadataFile();

      allMetadata[jid] = { ...(allMetadata[jid] || {}), ...enhancedMetadata };

      await this._writeGroupMetadataFile(allMetadata);

      logger.debug(`Cache: Grupo salvo em arquivo (${jid.substring(0, 30)}...)`);
    } catch (error) {
      logger.error('Cache: Erro ao salvar grupo:', { error: error.message, stack: error.stack });
    }
  }

  /**
   * Salva contato no cache
   */
  async saveContact(contact) {
    setImmediate(() => {
      try {
        if (!contact || !contact.id) {
          logger.warn('Cache: Dados de contato inválidos');
          return;
        }

        const cacheKey = `contact_${contact.id}`;
        const enhancedContact = {
          ...contact,
          _cached: true,
          _cacheTimestamp: Date.now(),
        };

        contactsCache.set(cacheKey, enhancedContact);
        logger.debug(`Cache: Contato salvo (${contact.id.substring(0, 30)}...)`);
      } catch (error) {
        logger.error('Cache: Erro ao salvar contato:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Salva chat no cache
   */
  async saveChat(chat) {
    setImmediate(() => {
      try {
        if (!chat || !chat.id) {
          logger.warn('Cache: Dados de chat inválidos');
          return;
        }

        const cacheKey = `chat_${chat.id}`;
        const enhancedChat = {
          ...chat,
          _cached: true,
          _cacheTimestamp: Date.now(),
        };

        chatsCache.set(cacheKey, enhancedChat);
        logger.debug(`Cache: Chat salvo (${chat.id.substring(0, 30)}...)`);
      } catch (error) {
        logger.error('Cache: Erro ao salvar chat:', { error: error.message, stack: error.stack });
      }
    });
  }

  /**
   * Recupera mensagem do cache com fallback para arquivo persistente
   */
  async getMessage(key) {
    try {
      if (!key || !key.remoteJid || !key.id) {
        return undefined;
      }

      const cacheKey = `msg_${key.remoteJid}_${key.id}`;
      const cachedMessage = messagesCache.get(cacheKey);

      if (cachedMessage) {
        logger.debug(`Cache: Mensagem recuperada da memória (${cacheKey.substring(0, 50)}...)`);
        cachedMessage._lastAccessed = Date.now();
        messagesCache.set(cacheKey, cachedMessage);
        return cachedMessage;
      }

      const recentMessagesKey = `recent_${key.remoteJid}`;
      const recentMessages = messagesCache.get(recentMessagesKey) || [];
      const foundMessage = recentMessages.find((msg) => msg && msg.key && msg.key.id === key.id);

      if (foundMessage) {
        logger.debug('Cache: Mensagem encontrada em recentes (memória)');
        foundMessage._lastAccessed = Date.now();
        foundMessage._foundInRecent = true;
        messagesCache.set(cacheKey, foundMessage);
        return foundMessage;
      }

      // Se não estiver na memória, tentar recuperar do arquivo
      logger.debug(`Cache: Mensagem não encontrada na memória, verificando arquivo...`);
      const fileMessage = await this.getMessageFromFile(key);

      if (fileMessage) {
        fileMessage._loadedFromFile = true;
        fileMessage._lastAccessed = Date.now();
        // Atualizar o cache em memória
        messagesCache.set(cacheKey, fileMessage);
        return fileMessage;
      }

      return undefined;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar mensagem:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Recupera metadados de grupo do cache persistente
   */
  async getGroupMetadata(jid) {
    try {
      if (!jid) {
        return undefined;
      }

      const allMetadata = await this._readGroupMetadataFile();
      const cachedGroup = allMetadata[jid];

      if (cachedGroup) {
        logger.debug(`Cache: Grupo recuperado do arquivo (${jid.substring(0, 30)}...)`);

        cachedGroup._lastAccessed = Date.now();
        allMetadata[jid] = cachedGroup;

        return cachedGroup;
      }

      return undefined;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar grupo de arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Busca metadados de grupo com cache inteligente
   * Se não estiver no cache ou estiver expirado, busca do cliente WhatsApp
   *
   * @param {String} groupJid - JID do grupo
   * @param {Object} omniZapClient - Cliente WhatsApp para buscar metadados
   * @returns {Promise<Object|null>} Metadados do grupo ou null em caso de erro
   */
  async getOrFetchGroupMetadata(groupJid, omniZapClient) {
    try {
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        logger.warn('Cache: JID de grupo inválido');
        return null;
      }

      if (!omniZapClient) {
        logger.warn('Cache: Cliente WhatsApp não fornecido');
        return null;
      }

      const cachedMetadata = await this.getGroupMetadata(groupJid);

      if (cachedMetadata) {
        const cacheAge = Date.now() - (cachedMetadata._cacheTimestamp || 0);
        const maxAge = 30 * 60 * 1000;

        if (cacheAge < maxAge) {
          logger.debug(`Cache: Metadados de grupo válidos (idade: ${Math.round(cacheAge / 60000)}min)`);
          return cachedMetadata;
        } else {
          logger.warn(`Cache: Metadados de grupo expirados (idade: ${Math.round(cacheAge / 60000)}min)`);
        }
      }

      logger.info(`Cache: Buscando metadados do grupo ${groupJid.substring(0, 30)}... do cliente WhatsApp`);

      const freshMetadata = await omniZapClient.groupMetadata(groupJid);

      if (freshMetadata) {
        const enhancedMetadata = {
          ...freshMetadata,
          _cached: true,
          _cacheTimestamp: Date.now(),
          _lastAccessed: Date.now(),
          _fetchedFromClient: true,
          _participantCount: freshMetadata.participants?.length || 0,
        };

        await this.saveGroupMetadata(groupJid, enhancedMetadata);

        logger.info(`Cache: Metadados de grupo "${freshMetadata.subject}" salvos (${enhancedMetadata._participantCount} participantes)`);

        return enhancedMetadata;
      } else {
        logger.warn('Cache: Não foi possível obter metadados do grupo');
        return null;
      }
    } catch (error) {
      logger.error('Cache: Erro ao buscar metadados de grupo:', {
        error: error.message,
        stack: error.stack,
      });
      const fallbackMetadata = await this.getGroupMetadata(groupJid);
      if (fallbackMetadata) {
        logger.warn('Cache: Usando metadados expirados como fallback');
        return fallbackMetadata;
      }

      return null;
    }
  }

  /**
   * Recupera contato do cache
   */
  async getContact(contactId) {
    try {
      if (!contactId) {
        return undefined;
      }

      const cacheKey = `contact_${contactId}`;
      const cachedContact = contactsCache.get(cacheKey);

      if (cachedContact) {
        logger.debug(`Cache: Contato recuperado (${contactId.substring(0, 30)}...)`);
        cachedContact._lastAccessed = Date.now();
        contactsCache.set(cacheKey, cachedContact);
        return cachedContact;
      }

      return undefined;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar contato:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Recupera chat do cache
   */
  async getChat(chatId) {
    try {
      if (!chatId) {
        return undefined;
      }

      const cacheKey = `chat_${chatId}`;
      const cachedChat = chatsCache.get(cacheKey);

      if (cachedChat) {
        logger.debug(`Cache: Chat recuperado (${chatId.substring(0, 30)}...)`);
        cachedChat._lastAccessed = Date.now();
        chatsCache.set(cacheKey, cachedChat);
        return cachedChat;
      }

      return undefined;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar chat:', { error: error.message, stack: error.stack });
      return undefined;
    }
  }

  /**
   * Recupera mensagem do arquivo de cache persistente
   */
  async getMessageFromFile(key) {
    try {
      if (!key || !key.remoteJid || !key.id) {
        return undefined;
      }

      const cacheKey = `msg_${key.remoteJid}_${key.id}`;
      const allMessages = await this._readMessagesCacheFile();
      const cachedMessage = allMessages.messages[cacheKey];

      if (cachedMessage) {
        logger.debug(`Cache: Mensagem recuperada do arquivo (${cacheKey.substring(0, 50)}...)`);

        // Atualizar o cache em memória para acesso mais rápido
        messagesCache.set(cacheKey, cachedMessage);

        return cachedMessage;
      }

      return undefined;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar mensagem do arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Recupera mensagens recentes de um chat do arquivo
   *
   * @param {String} chatJid - JID do chat
   * @param {Number} limit - Número máximo de mensagens a retornar
   * @returns {Promise<Array>} Array com mensagens recentes
   */
  async getRecentMessagesFromFile(chatJid, limit = 50) {
    try {
      if (!chatJid) {
        return [];
      }

      const allMessages = await this._readMessagesCacheFile();
      const recentKeys = allMessages.recentByChat[chatJid] || [];

      // Obter apenas as mensagens mais recentes, limitado pelo parâmetro
      const limitedKeys = recentKeys.slice(0, limit);
      const messages = [];

      for (const entry of limitedKeys) {
        const message = allMessages.messages[entry.key];
        if (message) {
          messages.push(message);
        }
      }

      logger.debug(`Cache: ${messages.length} mensagens recentes recuperadas do arquivo para ${chatJid}`);
      return messages;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar mensagens recentes do arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Recupera evento do arquivo de cache persistente
   */
  async getEventFromFile(eventType, eventId) {
    try {
      if (!eventType || !eventId) {
        return undefined;
      }

      const allEvents = await this._readEventsCacheFile();

      // Procurar em todos os eventos deste tipo
      const recentKeys = allEvents.recentByType[eventType] || [];
      const matchingEntry = recentKeys.find((entry) => entry.id === eventId);

      if (matchingEntry && matchingEntry.key) {
        const cachedEvent = allEvents.events[matchingEntry.key];

        if (cachedEvent) {
          logger.debug(`Cache: Evento ${eventType} recuperado do arquivo`);

          // Atualizar o cache em memória para acesso mais rápido
          eventsCache.set(matchingEntry.key, cachedEvent);

          return cachedEvent;
        }
      }

      return undefined;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar evento do arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Recupera eventos recentes de um tipo do arquivo
   *
   * @param {String} eventType - Tipo de evento
   * @param {Number} limit - Número máximo de eventos a retornar
   * @returns {Promise<Array>} Array com eventos recentes
   */
  async getRecentEventsFromFile(eventType, limit = 20) {
    try {
      if (!eventType) {
        return [];
      }

      const allEvents = await this._readEventsCacheFile();
      const recentKeys = allEvents.recentByType[eventType] || [];

      // Obter apenas os eventos mais recentes, limitado pelo parâmetro
      const limitedKeys = recentKeys.slice(0, limit);
      const events = [];

      for (const entry of limitedKeys) {
        const event = allEvents.events[entry.key];
        if (event) {
          events.push(event);
        }
      }

      logger.debug(`Cache: ${events.length} eventos recentes do tipo ${eventType} recuperados do arquivo`);
      return events;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar eventos recentes do arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Verifica se metadados de grupo existem no cache e se são válidos
   *
   * @param {String} groupJid - JID do grupo
   * @returns {Promise<Boolean>} True se existir e for válido, false caso contrário
   */
  async hasValidGroupMetadata(groupJid) {
    try {
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        return false;
      }

      const allMetadata = await this._readGroupMetadataFile();
      const cachedGroup = allMetadata[groupJid];

      if (!cachedGroup) {
        return false;
      }

      const cacheAge = Date.now() - (cachedGroup._cacheTimestamp || 0);
      const maxAge = 30 * 60 * 1000;

      return cacheAge < maxAge;
    } catch (error) {
      logger.error('Cache: Erro ao verificar grupo em arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  /**
   * Pré-carrega metadados de grupos em lote
   *
   * @param {Array} groupJids - Array de JIDs de grupos
   * @param {Object} omniZapClient - Cliente WhatsApp
   */
  async preloadGroupsMetadata(groupJids, omniZapClient) {
    if (!Array.isArray(groupJids) || groupJids.length === 0) {
      return;
    }

    logger.info(`Cache: Pré-carregando metadados de ${groupJids.length} grupos`);

    const promises = groupJids
      .filter((jid) => jid && jid.endsWith('@g.us'))
      .map(async (groupJid) => {
        try {
          if (!(await this.hasValidGroupMetadata(groupJid))) {
            await this.getOrFetchGroupMetadata(groupJid, omniZapClient);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          logger.error(`Cache: Erro ao pré-carregar grupo ${groupJid}:`, {
            error: error.message,
            stack: error.stack,
          });
        }
      });

    await Promise.allSettled(promises);
    logger.info('Cache: Pré-carregamento de grupos concluído');
  }
  async listGroups() {
    try {
      const allMetadata = await this._readGroupMetadataFile();
      const groups = Object.values(allMetadata);

      logger.info(`Cache: ${groups.length} grupos listados do arquivo`);
      return groups;
    } catch (error) {
      logger.error('Cache: Erro ao listar grupos do arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Lista todos os contatos em cache
   */
  async listContacts() {
    try {
      const contactKeys = contactsCache.keys().filter((key) => key.startsWith('contact_'));
      const contacts = [];

      for (const key of contactKeys) {
        const contact = contactsCache.get(key);
        if (contact) {
          contacts.push(contact);
        }
      }

      logger.info(`Cache: ${contacts.length} contatos listados`);
      return contacts;
    } catch (error) {
      logger.error('Cache: Erro ao listar contatos:', { error: error.message, stack: error.stack });
      return [];
    }
  }

  /**
   * Lista todos os chats em cache
   */
  async listChats() {
    try {
      const chatKeys = chatsCache.keys().filter((key) => key.startsWith('chat_'));
      const chats = [];

      for (const key of chatKeys) {
        const chat = chatsCache.get(key);
        if (chat) {
          chats.push(chat);
        }
      }

      logger.info(`Cache: ${chats.length} chats listados`);
      return chats;
    } catch (error) {
      logger.error('Cache: Erro ao listar chats:', { error: error.message, stack: error.stack });
      return [];
    }
  }

  /**
   * Obtém estatísticas do cache
   */
  async getStats() {
    try {
      const messagesStats = messagesCache.getStats();
      const eventsStats = eventsCache.getStats();
      const contactsStats = contactsCache.getStats();
      const chatsStats = chatsCache.getStats();

      // Estatísticas para os caches baseados em arquivo
      let groupsCount = 0;
      let messagesFileCount = 0;
      let eventsFileCount = 0;
      let messagesRecentCount = 0;
      let eventsRecentCount = 0;

      try {
        const allMetadata = await this._readGroupMetadataFile();
        groupsCount = Object.keys(allMetadata).length;

        const allMessages = await this._readMessagesCacheFile();
        messagesFileCount = Object.keys(allMessages.messages).length;
        messagesRecentCount = Object.keys(allMessages.recentByChat).reduce((total, chat) => total + allMessages.recentByChat[chat].length, 0);

        const allEvents = await this._readEventsCacheFile();
        eventsFileCount = Object.keys(allEvents.events).length;
        eventsRecentCount = Object.keys(allEvents.recentByType).reduce((total, type) => total + allEvents.recentByType[type].length, 0);
      } catch (error) {
        logger.error('Cache: Erro ao ler estatísticas de arquivos:', {
          error: error.message,
          stack: error.stack,
        });
      }

      return {
        messages: {
          keys: messagesCache.keys().length,
          hits: messagesStats.hits,
          misses: messagesStats.misses,
          hitRate: messagesStats.hits > 0 ? ((messagesStats.hits / (messagesStats.hits + messagesStats.misses)) * 100).toFixed(2) : 0,
          file: {
            storage: 'file',
            path: MESSAGES_CACHE_FILE,
            count: messagesFileCount,
            recentEntriesCount: messagesRecentCount,
          },
        },
        events: {
          keys: eventsCache.keys().length,
          hits: eventsStats.hits,
          misses: eventsStats.misses,
          hitRate: eventsStats.hits > 0 ? ((eventsStats.hits / (eventsStats.hits + eventsStats.misses)) * 100).toFixed(2) : 0,
          file: {
            storage: 'file',
            path: EVENTS_CACHE_FILE,
            count: eventsFileCount,
            recentEntriesCount: eventsRecentCount,
          },
        },
        groups: {
          keys: groupsCount,
          storage: 'file',
          path: GROUP_METADATA_FILE,
        },
        contacts: {
          keys: contactsCache.keys().length,
          hits: contactsStats.hits,
          misses: contactsStats.misses,
          hitRate: contactsStats.hits > 0 ? ((contactsStats.hits / (contactsStats.hits + contactsStats.misses)) * 100).toFixed(2) : 0,
        },
        chats: {
          keys: chatsCache.keys().length,
          hits: chatsStats.hits,
          misses: chatsStats.misses,
          hitRate: chatsStats.hits > 0 ? ((chatsStats.hits / (chatsStats.hits + chatsStats.misses)) * 100).toFixed(2) : 0,
        },
        totals: {
          memory: {
            keys: messagesCache.keys().length + eventsCache.keys().length + contactsCache.keys().length + chatsCache.keys().length,
            hits: messagesStats.hits + eventsStats.hits + contactsStats.hits + chatsStats.hits,
            misses: messagesStats.misses + eventsStats.misses + contactsStats.misses + chatsStats.misses,
          },
          file: {
            keys: groupsCount + messagesFileCount + eventsFileCount,
          },
          all: {
            keys: messagesCache.keys().length + eventsCache.keys().length + contactsCache.keys().length + chatsCache.keys().length + groupsCount + messagesFileCount + eventsFileCount,
          },
        },
      };
    } catch (error) {
      logger.error('Cache: Erro ao obter estatísticas:', {
        error: error.message,
        stack: error.stack,
      });
      return null;
    }
  }

  /**
   * Limpeza automática do cache
   */
  async performMaintenance() {
    if (!env.CACHE_AUTO_CLEAN) {
      return;
    }

    try {
      const stats = await this.getStats();
      const shouldClean = stats && (stats.totals.memory.keys > env.CACHE_MAX_TOTAL_KEYS || stats.messages.keys > env.CACHE_MAX_MESSAGES || stats.events.keys > env.CACHE_MAX_EVENTS);

      if (shouldClean) {
        logger.warn('Cache: Iniciando limpeza automática...');

        let totalRemoved = 0;

        const messageKeys = messagesCache.keys().filter((k) => k.startsWith('msg_'));
        if (messageKeys.length > env.CACHE_MESSAGES_KEEP) {
          const messagesToRemove = messageKeys.slice(env.CACHE_MESSAGES_KEEP);
          messagesToRemove.forEach((key) => {
            messagesCache.del(key);
            totalRemoved++;
          });
        }

        const eventKeys = eventsCache.keys();
        if (eventKeys.length > env.CACHE_EVENTS_KEEP) {
          const eventsToRemove = eventKeys.slice(env.CACHE_EVENTS_KEEP);
          eventsToRemove.forEach((key) => {
            eventsCache.del(key);
            totalRemoved++;
          });
        }

        logger.info(`Cache: Limpeza em memória concluída - ${totalRemoved} itens removidos`);

        // Limpar também os caches em arquivo a cada 24 horas
        const now = Date.now();
        const lastFileCacheCleanup = this._lastFileCacheCleanup || 0;

        if (now - lastFileCacheCleanup > 24 * 60 * 60 * 1000) {
          logger.info('Cache: Iniciando limpeza de caches em arquivo...');

          const fileCleanupStats = await this.cleanFileCaches({
            maxMessagesAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
            maxEventsAge: 14 * 24 * 60 * 60 * 1000, // 14 dias
            maxMessagesCount: 10000,
            maxEventsCount: 5000,
          });

          this._lastFileCacheCleanup = now;

          logger.info(`Cache: Limpeza de arquivos concluída - ${fileCleanupStats.messagesRemoved} mensagens e ${fileCleanupStats.eventsRemoved} eventos removidos`);
        }
      }
    } catch (error) {
      logger.error('Cache: Erro na manutenção:', { error: error.message, stack: error.stack });
    }
  }

  /**
   * Busca mensagens por critérios específicos nos arquivos de cache
   * Útil para análises históricas
   *
   * @param {Object} criteria - Critérios de busca
   * @param {String} criteria.chatJid - JID do chat (opcional)
   * @param {String} criteria.messageType - Tipo de mensagem (opcional)
   * @param {Number} criteria.startTime - Timestamp inicial (opcional)
   * @param {Number} criteria.endTime - Timestamp final (opcional)
   * @param {Number} criteria.limit - Limite de resultados (opcional, default: 100)
   * @returns {Promise<Array>} - Mensagens encontradas
   */
  async searchMessages(criteria = {}) {
    try {
      const { chatJid, messageType, startTime, endTime, limit = 100 } = criteria;
      const allMessages = await this._readMessagesCacheFile();
      const results = [];

      // Converter todas as mensagens em array
      const messagesArray = Object.values(allMessages.messages);

      // Filtrar mensagens de acordo com os critérios
      for (const message of messagesArray) {
        let match = true;

        if (chatJid && message.key.remoteJid !== chatJid) {
          match = false;
        }

        if (messageType && message._messageType !== messageType) {
          match = false;
        }

        if (startTime && message._cacheTimestamp < startTime) {
          match = false;
        }

        if (endTime && message._cacheTimestamp > endTime) {
          match = false;
        }

        if (match) {
          results.push(message);

          if (results.length >= limit) {
            break;
          }
        }
      }

      logger.info(`Cache: Busca de mensagens retornou ${results.length} resultados`);
      return results;
    } catch (error) {
      logger.error('Cache: Erro ao buscar mensagens:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Busca eventos por critérios específicos nos arquivos de cache
   * Útil para análises históricas
   *
   * @param {Object} criteria - Critérios de busca
   * @param {String} criteria.eventType - Tipo de evento (opcional)
   * @param {Number} criteria.startTime - Timestamp inicial (opcional)
   * @param {Number} criteria.endTime - Timestamp final (opcional)
   * @param {Number} criteria.limit - Limite de resultados (opcional, default: 100)
   * @returns {Promise<Array>} - Eventos encontrados
   */
  async searchEvents(criteria = {}) {
    try {
      const { eventType, startTime, endTime, limit = 100 } = criteria;
      const allEvents = await this._readEventsCacheFile();
      const results = [];

      // Converter todos os eventos em array
      const eventsArray = Object.values(allEvents.events);

      // Filtrar eventos de acordo com os critérios
      for (const event of eventsArray) {
        let match = true;

        if (eventType && event._eventType !== eventType) {
          match = false;
        }

        if (startTime && event._cacheTimestamp < startTime) {
          match = false;
        }

        if (endTime && event._cacheTimestamp > endTime) {
          match = false;
        }

        if (match) {
          results.push(event);

          if (results.length >= limit) {
            break;
          }
        }
      }

      logger.info(`Cache: Busca de eventos retornou ${results.length} resultados`);
      return results;
    } catch (error) {
      logger.error('Cache: Erro ao buscar eventos:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Limpa arquivos de cache antigos para economizar espaço
   *
   * @param {Object} options - Opções de limpeza
   * @param {Number} options.maxMessagesAge - Idade máxima em milissegundos para mensagens (opcional)
   * @param {Number} options.maxEventsAge - Idade máxima em milissegundos para eventos (opcional)
   * @param {Number} options.maxMessagesCount - Número máximo de mensagens a manter (opcional)
   * @param {Number} options.maxEventsCount - Número máximo de eventos a manter (opcional)
   * @returns {Promise<Object>} - Estatísticas da limpeza
   */
  async cleanFileCaches(options = {}) {
    const {
      maxMessagesAge = 7 * 24 * 60 * 60 * 1000, // 7 dias por padrão
      maxEventsAge = 14 * 24 * 60 * 60 * 1000, // 14 dias por padrão
      maxMessagesCount = 10000, // 10000 mensagens por padrão
      maxEventsCount = 5000, // 5000 eventos por padrão
    } = options;

    const now = Date.now();
    const stats = { messagesRemoved: 0, eventsRemoved: 0 };

    try {
      // Limpar mensagens antigas
      const allMessages = await this._readMessagesCacheFile();
      const messageKeys = Object.keys(allMessages.messages);

      // Se temos mais mensagens que o limite, precisamos limpar
      if (messageKeys.length > maxMessagesCount) {
        // Ordenar mensagens por timestamp
        const messagesWithTimestamp = messageKeys.map((key) => ({
          key,
          timestamp: allMessages.messages[key]._cacheTimestamp || 0,
        }));

        messagesWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);

        // Remover as mensagens mais antigas
        const keysToRemove = messagesWithTimestamp.slice(0, messagesWithTimestamp.length - maxMessagesCount).map((item) => item.key);

        for (const key of keysToRemove) {
          delete allMessages.messages[key];
          stats.messagesRemoved++;
        }
      }

      // Remover mensagens mais antigas que maxMessagesAge
      for (const key of Object.keys(allMessages.messages)) {
        const message = allMessages.messages[key];
        if (now - (message._cacheTimestamp || 0) > maxMessagesAge) {
          delete allMessages.messages[key];
          stats.messagesRemoved++;
        }
      }

      // Atualizar referências de recentes
      for (const chatJid of Object.keys(allMessages.recentByChat)) {
        allMessages.recentByChat[chatJid] = allMessages.recentByChat[chatJid].filter((item) => allMessages.messages[item.key]);
      }

      await this._writeMessagesCacheFile(allMessages);

      // Limpar eventos antigos
      const allEvents = await this._readEventsCacheFile();
      const eventKeys = Object.keys(allEvents.events);

      // Se temos mais eventos que o limite, precisamos limpar
      if (eventKeys.length > maxEventsCount) {
        // Ordenar eventos por timestamp
        const eventsWithTimestamp = eventKeys.map((key) => ({
          key,
          timestamp: allEvents.events[key]._cacheTimestamp || 0,
        }));

        eventsWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);

        // Remover os eventos mais antigos
        const keysToRemove = eventsWithTimestamp.slice(0, eventsWithTimestamp.length - maxEventsCount).map((item) => item.key);

        for (const key of keysToRemove) {
          delete allEvents.events[key];
          stats.eventsRemoved++;
        }
      }

      // Remover eventos mais antigos que maxEventsAge
      for (const key of Object.keys(allEvents.events)) {
        const event = allEvents.events[key];
        if (now - (event._cacheTimestamp || 0) > maxEventsAge) {
          delete allEvents.events[key];
          stats.eventsRemoved++;
        }
      }

      // Atualizar referências de recentes
      for (const eventType of Object.keys(allEvents.recentByType)) {
        allEvents.recentByType[eventType] = allEvents.recentByType[eventType].filter((item) => allEvents.events[item.key]);
      }

      await this._writeEventsCacheFile(allEvents);

      logger.info(`Cache: Limpeza concluída - Removidas ${stats.messagesRemoved} mensagens e ${stats.eventsRemoved} eventos`);
      return stats;
    } catch (error) {
      logger.error('Cache: Erro ao limpar caches em arquivo:', {
        error: error.message,
        stack: error.stack,
      });
      return stats;
    }
  }
}

const cacheManager = new CacheManager();

module.exports = {
  cacheManager,
  messagesCache,
  eventsCache,
  contactsCache,
  chatsCache,
  GROUP_METADATA_FILE,
  MESSAGES_CACHE_FILE,
  EVENTS_CACHE_FILE,
};
