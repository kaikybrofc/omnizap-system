/**
 * OmniZap Cache Manager
 *
 * Módulo responsável pelo gerenciamento avançado de cache
 * Funciona de forma independente e assíncrona
 *
 * @version 1.0.3
 * @author OmniZap Team
 * @license MIT
 */

const NodeCache = require('node-cache');
const chalk = require('chalk');
const logger = require('../utils/logger/loggerModule');

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

groupMetadataCache.on('expired', (key, value) => {
  logger.debug(`OmniZap Cache: Metadados de grupo expirados: ${key}`);
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
  init() {
    logger.info('🔄 OmniZap Cache: Sistema inicializado');
    logger.debug('🔄 TTL: Msgs=1h | Eventos=30min | Grupos=2h | Contatos=4h | Chats=1h');

    this.initialized = true;
  }

  /**
   * Salva uma mensagem no cache (processamento assíncrono)
   */
  async saveMessage(messageInfo) {
    setImmediate(() => {
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

        logger.debug(`Cache: Mensagem salva (${cacheKey.substring(0, 50)}...)`);
      } catch (error) {
        logger.error('Cache: Erro ao salvar mensagem:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Salva evento no cache (processamento assíncrono)
   */
  async saveEvent(eventType, eventData, eventId = null) {
    setImmediate(() => {
      try {
        if (!eventType || !eventData) {
          logger.warn('Cache: Dados de evento inválidos');
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

        logger.debug(`Cache: Evento ${eventType} salvo (${cacheKey.substring(0, 50)}...)`);
      } catch (error) {
        logger.error('Cache: Erro ao salvar evento:', { error: error.message, stack: error.stack });
      }
    });
  }

  /**
   * Salva metadados de grupo no cache
   */
  async saveGroupMetadata(jid, metadata) {
    setImmediate(() => {
      try {
        if (!jid || !metadata) {
          logger.warn('Cache: Dados de grupo inválidos');
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
        logger.debug(`Cache: Grupo salvo (${jid.substring(0, 30)}...)`);
      } catch (error) {
        logger.error('Cache: Erro ao salvar grupo:', { error: error.message, stack: error.stack });
      }
    });
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
   * Recupera mensagem do cache
   */
  async getMessage(key) {
    try {
      if (!key || !key.remoteJid || !key.id) {
        return undefined;
      }

      const cacheKey = `msg_${key.remoteJid}_${key.id}`;
      const cachedMessage = messagesCache.get(cacheKey);

      if (cachedMessage) {
        logger.debug(`Cache: Mensagem recuperada (${cacheKey.substring(0, 50)}...)`);
        cachedMessage._lastAccessed = Date.now();
        messagesCache.set(cacheKey, cachedMessage);
        return cachedMessage;
      }

      const recentMessagesKey = `recent_${key.remoteJid}`;
      const recentMessages = messagesCache.get(recentMessagesKey) || [];
      const foundMessage = recentMessages.find((msg) => msg && msg.key && msg.key.id === key.id);

      if (foundMessage) {
        logger.debug('Cache: Mensagem encontrada em recentes');
        foundMessage._lastAccessed = Date.now();
        foundMessage._foundInRecent = true;
        messagesCache.set(cacheKey, foundMessage);
        return foundMessage;
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
   * Recupera metadados de grupo do cache
   */
  async getGroupMetadata(jid) {
    try {
      if (!jid) {
        return undefined;
      }

      const cacheKey = `group_metadata_${jid}`;
      const cachedGroup = groupMetadataCache.get(cacheKey);

      if (cachedGroup) {
        logger.debug(`Cache: Grupo recuperado (${jid.substring(0, 30)}...)`);
        cachedGroup._lastAccessed = Date.now();
        groupMetadataCache.set(cacheKey, cachedGroup);
        return cachedGroup;
      }

      return undefined;
    } catch (error) {
      logger.error('Cache: Erro ao recuperar grupo:', { error: error.message, stack: error.stack });
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
          logger.debug(
            `Cache: Metadados de grupo válidos (idade: ${Math.round(cacheAge / 60000)}min)`,
          );
          return cachedMetadata;
        } else {
          logger.warn(
            `Cache: Metadados de grupo expirados (idade: ${Math.round(cacheAge / 60000)}min)`,
          );
        }
      }

      logger.info(
        `Cache: Buscando metadados do grupo ${groupJid.substring(0, 30)}... do cliente WhatsApp`,
      );

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

        logger.info(
          `Cache: Metadados de grupo "${freshMetadata.subject}" salvos (${enhancedMetadata._participantCount} participantes)`,
        );

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
   * Verifica se metadados de grupo existem no cache e se são válidos
   *
   * @param {String} groupJid - JID do grupo
   * @returns {Boolean} True se existir e for válido, false caso contrário
   */
  hasValidGroupMetadata(groupJid) {
    try {
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        return false;
      }

      const cacheKey = `group_metadata_${groupJid}`;
      const cachedGroup = groupMetadataCache.get(cacheKey);

      if (!cachedGroup) {
        return false;
      }

      const cacheAge = Date.now() - (cachedGroup._cacheTimestamp || 0);
      const maxAge = 30 * 60 * 1000;

      return cacheAge < maxAge;
    } catch (error) {
      logger.error('Cache: Erro ao verificar grupo:', { error: error.message, stack: error.stack });
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
          if (!this.hasValidGroupMetadata(groupJid)) {
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
      const groupKeys = groupMetadataCache
        .keys()
        .filter((key) => key.startsWith('group_metadata_'));
      const groups = [];

      for (const key of groupKeys) {
        const group = groupMetadataCache.get(key);
        if (group) {
          groups.push(group);
        }
      }

      logger.info(`Cache: ${groups.length} grupos listados`);
      return groups;
    } catch (error) {
      logger.error('Cache: Erro ao listar grupos:', { error: error.message, stack: error.stack });
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
  getStats() {
    try {
      const messagesStats = messagesCache.getStats();
      const eventsStats = eventsCache.getStats();
      const groupsStats = groupMetadataCache.getStats();
      const contactsStats = contactsCache.getStats();
      const chatsStats = chatsCache.getStats();

      return {
        messages: {
          keys: messagesCache.keys().length,
          hits: messagesStats.hits,
          misses: messagesStats.misses,
          hitRate:
            messagesStats.hits > 0
              ? ((messagesStats.hits / (messagesStats.hits + messagesStats.misses)) * 100).toFixed(
                  2,
                )
              : 0,
        },
        events: {
          keys: eventsCache.keys().length,
          hits: eventsStats.hits,
          misses: eventsStats.misses,
          hitRate:
            eventsStats.hits > 0
              ? ((eventsStats.hits / (eventsStats.hits + eventsStats.misses)) * 100).toFixed(2)
              : 0,
        },
        groups: {
          keys: groupMetadataCache.keys().length,
          hits: groupsStats.hits,
          misses: groupsStats.misses,
          hitRate:
            groupsStats.hits > 0
              ? ((groupsStats.hits / (groupsStats.hits + groupsStats.misses)) * 100).toFixed(2)
              : 0,
        },
        contacts: {
          keys: contactsCache.keys().length,
          hits: contactsStats.hits,
          misses: contactsStats.misses,
          hitRate:
            contactsStats.hits > 0
              ? ((contactsStats.hits / (contactsStats.hits + contactsStats.misses)) * 100).toFixed(
                  2,
                )
              : 0,
        },
        chats: {
          keys: chatsCache.keys().length,
          hits: chatsStats.hits,
          misses: chatsStats.misses,
          hitRate:
            chatsStats.hits > 0
              ? ((chatsStats.hits / (chatsStats.hits + chatsStats.misses)) * 100).toFixed(2)
              : 0,
        },
        totals: {
          allKeys:
            messagesCache.keys().length +
            eventsCache.keys().length +
            groupMetadataCache.keys().length +
            contactsCache.keys().length +
            chatsCache.keys().length,
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
  performMaintenance() {
    setImmediate(() => {
      try {
        const stats = this.getStats();
        const shouldClean =
          stats &&
          (stats.totals.allKeys > 3000 || stats.messages.keys > 1500 || stats.events.keys > 1000);

        if (shouldClean) {
          logger.warn('Cache: Iniciando limpeza automática...');

          let totalRemoved = 0;

          const messageKeys = messagesCache.keys().filter((k) => k.startsWith('msg_'));
          if (messageKeys.length > 500) {
            const messagesToRemove = messageKeys.slice(500);
            messagesToRemove.forEach((key) => {
              messagesCache.del(key);
              totalRemoved++;
            });
          }

          const eventKeys = eventsCache.keys();
          if (eventKeys.length > 200) {
            const eventsToRemove = eventKeys.slice(200);
            eventsToRemove.forEach((key) => {
              eventsCache.del(key);
              totalRemoved++;
            });
          }

          logger.info(`Cache: Limpeza concluída - ${totalRemoved} itens removidos`);
        }
      } catch (error) {
        logger.error('Cache: Erro na manutenção:', { error: error.message, stack: error.stack });
      }
    });
  }
}

const cacheManager = new CacheManager();

module.exports = {
  cacheManager,
  messagesCache,
  eventsCache,
  groupMetadataCache,
  contactsCache,
  chatsCache,
};
