/**
 * OmniZap Cache Manager
 *
 * Módulo responsável pelo gerenciamento avançado de cache
 * Funciona de forma independente e assíncrona
 *
 * @version 1.0.2
 * @author OmniZap Team
 * @license MIT
 */

const NodeCache = require('node-cache');
const chalk = require('chalk');

// Configuração de cores
const OmniZapColors = {
  primary: (text) => chalk.cyan(text),
  error: (text) => chalk.red(text),
  warning: (text) => chalk.yellow(text),
  success: (text) => chalk.green(text),
  info: (text) => chalk.blue(text),
  gray: (text) => chalk.gray(text),
  white: (text) => chalk.white(text),
};

// Inicialização dos caches
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

// Event listeners para os caches
messagesCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`OmniZap Cache: Mensagem expirada: ${key}`));
});

messagesCache.on('flush', () => {
  console.log(OmniZapColors.warning('OmniZap Cache: Cache de mensagens foi limpo'));
});

eventsCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`OmniZap Cache: Evento expirado: ${key}`));
});

eventsCache.on('flush', () => {
  console.log(OmniZapColors.warning('OmniZap Cache: Cache de eventos foi limpo'));
});

groupMetadataCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`OmniZap Cache: Metadados de grupo expirados: ${key}`));
});

contactsCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`OmniZap Cache: Contato expirado: ${key}`));
});

chatsCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`OmniZap Cache: Chat expirado: ${key}`));
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
    console.log(OmniZapColors.info('🔄 OmniZap Cache: Sistema inicializado'));
    console.log(
      OmniZapColors.gray('🔄 TTL: Msgs=1h | Eventos=30min | Grupos=2h | Contatos=4h | Chats=1h'),
    );

    this.initialized = true;
    this.startMaintenanceTasks();
  }

  /**
   * Salva uma mensagem no cache (processamento assíncrono)
   */
  async saveMessage(messageInfo) {
    // Processo assíncrono - não bloqueia
    setImmediate(() => {
      try {
        if (!messageInfo || !messageInfo.key || !messageInfo.key.remoteJid || !messageInfo.key.id) {
          console.warn(OmniZapColors.warning('Cache: Dados de mensagem inválidos'));
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

        // Gerencia mensagens recentes
        const recentMessagesKey = `recent_${remoteJid}`;
        let recentMessages = messagesCache.get(recentMessagesKey) || [];
        recentMessages.unshift(enhancedMessage);

        if (recentMessages.length > 100) {
          recentMessages = recentMessages.slice(0, 100);
        }

        messagesCache.set(recentMessagesKey, recentMessages, 7200);

        // Contador de mensagens
        const counterKey = `count_${remoteJid}`;
        const currentCount = messagesCache.get(counterKey) || 0;
        messagesCache.set(counterKey, currentCount + 1, 86400);

        console.log(
          OmniZapColors.success(`Cache: Mensagem salva (${cacheKey.substring(0, 50)}...)`),
        );
      } catch (error) {
        console.error(OmniZapColors.error('Cache: Erro ao salvar mensagem:'), error);
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
          console.warn(OmniZapColors.warning('Cache: Dados de evento inválidos'));
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

        // Gerencia eventos recentes
        const recentEventsKey = `recent_events_${eventType}`;
        let recentEvents = eventsCache.get(recentEventsKey) || [];
        recentEvents.unshift(enhancedEvent);

        if (recentEvents.length > 50) {
          recentEvents = recentEvents.slice(0, 50);
        }

        eventsCache.set(recentEventsKey, recentEvents, 3600);

        console.log(
          OmniZapColors.success(
            `Cache: Evento ${eventType} salvo (${cacheKey.substring(0, 50)}...)`,
          ),
        );
      } catch (error) {
        console.error(OmniZapColors.error('Cache: Erro ao salvar evento:'), error);
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
          console.warn(OmniZapColors.warning('Cache: Dados de grupo inválidos'));
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
        console.log(OmniZapColors.success(`Cache: Grupo salvo (${jid.substring(0, 30)}...)`));
      } catch (error) {
        console.error(OmniZapColors.error('Cache: Erro ao salvar grupo:'), error);
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
          console.warn(OmniZapColors.warning('Cache: Dados de contato inválidos'));
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
          OmniZapColors.success(`Cache: Contato salvo (${contact.id.substring(0, 30)}...)`),
        );
      } catch (error) {
        console.error(OmniZapColors.error('Cache: Erro ao salvar contato:'), error);
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
          console.warn(OmniZapColors.warning('Cache: Dados de chat inválidos'));
          return;
        }

        const cacheKey = `chat_${chat.id}`;
        const enhancedChat = {
          ...chat,
          _cached: true,
          _cacheTimestamp: Date.now(),
        };

        chatsCache.set(cacheKey, enhancedChat);
        console.log(OmniZapColors.success(`Cache: Chat salvo (${chat.id.substring(0, 30)}...)`));
      } catch (error) {
        console.error(OmniZapColors.error('Cache: Erro ao salvar chat:'), error);
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
        console.log(
          OmniZapColors.success(`Cache: Mensagem recuperada (${cacheKey.substring(0, 50)}...)`),
        );
        cachedMessage._lastAccessed = Date.now();
        messagesCache.set(cacheKey, cachedMessage);
        return cachedMessage;
      }

      // Busca em mensagens recentes
      const recentMessagesKey = `recent_${key.remoteJid}`;
      const recentMessages = messagesCache.get(recentMessagesKey) || [];
      const foundMessage = recentMessages.find((msg) => msg && msg.key && msg.key.id === key.id);

      if (foundMessage) {
        console.log(OmniZapColors.info('Cache: Mensagem encontrada em recentes'));
        foundMessage._lastAccessed = Date.now();
        foundMessage._foundInRecent = true;
        messagesCache.set(cacheKey, foundMessage);
        return foundMessage;
      }

      return undefined;
    } catch (error) {
      console.error(OmniZapColors.error('Cache: Erro ao recuperar mensagem:'), error);
      return undefined;
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
      console.error(OmniZapColors.error('Cache: Erro ao obter estatísticas:'), error);
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
          console.log(OmniZapColors.warning('Cache: Iniciando limpeza automática...'));

          let totalRemoved = 0;

          // Limpa mensagens antigas
          const messageKeys = messagesCache.keys().filter((k) => k.startsWith('msg_'));
          if (messageKeys.length > 500) {
            const messagesToRemove = messageKeys.slice(500);
            messagesToRemove.forEach((key) => {
              messagesCache.del(key);
              totalRemoved++;
            });
          }

          // Limpa eventos antigos
          const eventKeys = eventsCache.keys();
          if (eventKeys.length > 200) {
            const eventsToRemove = eventKeys.slice(200);
            eventsToRemove.forEach((key) => {
              eventsCache.del(key);
              totalRemoved++;
            });
          }

          console.log(
            OmniZapColors.success(`Cache: Limpeza concluída - ${totalRemoved} itens removidos`),
          );
        }
      } catch (error) {
        console.error(OmniZapColors.error('Cache: Erro na manutenção:'), error);
      }
    });
  }

  /**
   * Inicia tarefas de manutenção automática
   */
  startMaintenanceTasks() {
    // Estatísticas a cada 30 minutos
    setInterval(() => {
      const stats = this.getStats();
      if (stats) {
        console.log(OmniZapColors.primary('📊 Cache Stats:'));
        console.log(
          OmniZapColors.info(
            `   Mensagens: ${stats.messages.keys} (${stats.messages.hitRate}% hit)`,
          ),
        );
        console.log(
          OmniZapColors.info(`   Eventos: ${stats.events.keys} (${stats.events.hitRate}% hit)`),
        );
        console.log(OmniZapColors.info(`   Total: ${stats.totals.allKeys} chaves`));
      }
    }, 30 * 60 * 1000);

    // Limpeza a cada 2 horas
    setInterval(() => {
      this.performMaintenance();
    }, 2 * 60 * 60 * 1000);

    // Backup a cada hora
    setInterval(() => {
      const stats = this.getStats();
      if (stats) {
        const backup = {
          timestamp: new Date().toISOString(),
          stats: stats,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        };
        messagesCache.set('omnizap_stats_backup', backup, 86400);
        console.log(OmniZapColors.gray('Cache: Backup de estatísticas salvo'));
      }
    }, 60 * 60 * 1000);
  }
}

// Instância singleton
const cacheManager = new CacheManager();

module.exports = {
  cacheManager,
  messagesCache,
  eventsCache,
  groupMetadataCache,
  contactsCache,
  chatsCache,
};

console.log(OmniZapColors.success('🚀 OmniZap Cache Manager: Módulo inicializado!'));
