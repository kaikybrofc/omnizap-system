/**
 * OmniZap Event Handler - Versão Melhorada
 *
 * Módulo responsável pelo processamento independente de eventos
 * Usa cache local centralizado e persistência em JSON
 * Integração bidirecional com socketController
 *
 * @version 2.1.0
 * @author OmniZap Team
 * @license MIT
 */

const fs = require('fs');
const path = require('path');
const NodeCache = require('node-cache');
const logger = require('../utils/logger/loggerModule');

/**
 * Classe principal do processador de eventos com cache local
 */
class EventHandler {
  constructor() {
    this.initialized = false;
    this.omniZapClient = null;
    this.socketController = null;
    this.cacheDir = path.join(__dirname, '../../temp/cache');
    this.dataDir = path.join(__dirname, '../../temp/data');

    // Cache instances com TTL diferenciados
    this.messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1 hora
    this.groupCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 }); // 2 horas
    this.contactCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 }); // 2 horas
    this.chatCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1 hora
    this.eventCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 }); // 30 minutos

    // Sistema de callbacks para comunicação bidirecional
    this.eventCallbacks = new Map();
    this.connectionState = {
      isConnected: false,
      lastConnection: null,
      connectionCount: 0,
      lastDisconnection: null,
    };

    // Estatísticas de performance
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      processedEvents: 0,
      lastReset: Date.now(),
    };

    this.init();
  }

  /**
   * Inicializa o processador de eventos e cache
   */
  init() {
    try {
      // Cria diretórios se não existirem
      [this.cacheDir, this.dataDir].forEach((dir) => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          logger.info(`📁 Cache: Diretório criado: ${dir}`);
        }
      });

      // Carrega dados persistentes
      this.loadPersistedData();

      // Configura auto-save
      this.setupAutoSave();

      logger.info('🎯 OmniZap Events: Cache local inicializado com integração bidirecional');
      this.initialized = true;
    } catch (error) {
      logger.error('❌ Erro ao inicializar cache:', error.message);
    }
  }

  /**
   * Define o controlador de socket para comunicação bidirecional
   * @param {Object} controller - Referência ao socketController
   */
  setSocketController(controller) {
    this.socketController = controller;
    logger.info('🔗 Events: SocketController configurado para comunicação bidirecional');
  }

  /**
   * Registra callback para eventos específicos
   * @param {string} eventType - Tipo do evento
   * @param {Function} callback - Função callback
   */
  registerCallback(eventType, callback) {
    if (!this.eventCallbacks.has(eventType)) {
      this.eventCallbacks.set(eventType, []);
    }
    this.eventCallbacks.get(eventType).push(callback);
    logger.debug(`📞 Events: Callback registrado para ${eventType}`);
  }

  /**
   * Executa callbacks registrados para um evento
   * @param {string} eventType - Tipo do evento
   * @param {*} data - Dados do evento
   */
  async executeCallbacks(eventType, data) {
    const callbacks = this.eventCallbacks.get(eventType) || [];
    if (callbacks.length > 0) {
      logger.debug(`📞 Events: Executando ${callbacks.length} callback(s) para ${eventType}`);

      for (const callback of callbacks) {
        try {
          await callback(data, this);
        } catch (error) {
          logger.error(`❌ Erro no callback para ${eventType}:`, error.message);
        }
      }
    }
  }

  /**
   * Atualiza estado de conexão
   * @param {boolean} isConnected - Estado da conexão
   * @param {Object} metadata - Metadados da conexão
   */
  updateConnectionState(isConnected, metadata = {}) {
    const previousState = this.connectionState.isConnected;
    this.connectionState.isConnected = isConnected;

    if (isConnected && !previousState) {
      this.connectionState.lastConnection = Date.now();
      this.connectionState.connectionCount++;
      logger.info('🟢 Events: Estado de conexão atualizado - CONECTADO');
    } else if (!isConnected && previousState) {
      this.connectionState.lastDisconnection = Date.now();
      logger.info('🔴 Events: Estado de conexão atualizado - DESCONECTADO');
    }

    // Salva estado atualizado
    this.eventCache.set('connection_state', {
      ...this.connectionState,
      ...metadata,
      _lastUpdate: Date.now(),
    });

    // Executa callbacks de mudança de estado
    this.executeCallbacks('connection.state.change', {
      isConnected,
      previousState,
      metadata,
      connectionState: this.connectionState,
    });
  }

  /**
   * Obtém cliente WhatsApp através do socketController
   */
  getWhatsAppClient() {
    if (this.omniZapClient) {
      return this.omniZapClient;
    }

    if (this.socketController && typeof this.socketController.getActiveSocket === 'function') {
      return this.socketController.getActiveSocket();
    }

    return null;
  }

  /**
   * Define o cliente WhatsApp para uso nos eventos
   * @param {Object} client - Cliente WhatsApp
   */
  setWhatsAppClient(client) {
    this.omniZapClient = client;
    logger.info('🎯 Events: Cliente WhatsApp configurado');
  }

  /**
   * Carrega dados persistentes dos arquivos JSON
   */
  loadPersistedData() {
    const dataFiles = {
      groups: path.join(this.dataDir, 'groups.json'),
      contacts: path.join(this.dataDir, 'contacts.json'),
      chats: path.join(this.dataDir, 'chats.json'),
      metadata: path.join(this.dataDir, 'metadata.json'),
    };

    Object.entries(dataFiles).forEach(([type, filePath]) => {
      try {
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const cache = this.getCacheByType(type);

          Object.entries(data).forEach(([key, value]) => {
            cache.set(key, value);
          });

          logger.info(`📂 Cache: ${Object.keys(data).length} ${type} carregados do arquivo`);
        }
      } catch (error) {
        logger.error(`❌ Erro ao carregar ${type}:`, error.message);
      }
    });
  }

  /**
   * Configura salvamento automático periódico
   */
  setupAutoSave() {
    // Salva dados a cada 5 minutos
    setInterval(() => {
      this.savePersistedData();
    }, 5 * 60 * 1000);

    // Salva dados ao encerrar aplicação
    process.on('SIGINT', () => {
      logger.info('🔄 Salvando dados antes de encerrar...');
      this.savePersistedData();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.savePersistedData();
      process.exit(0);
    });
  }

  /**
   * Salva dados persistentes em arquivos JSON
   */
  savePersistedData() {
    try {
      const dataToSave = {
        groups: this.groupCache.keys().reduce((acc, key) => {
          acc[key] = this.groupCache.get(key);
          return acc;
        }, {}),
        contacts: this.contactCache.keys().reduce((acc, key) => {
          acc[key] = this.contactCache.get(key);
          return acc;
        }, {}),
        chats: this.chatCache.keys().reduce((acc, key) => {
          acc[key] = this.chatCache.get(key);
          return acc;
        }, {}),
        metadata: {
          lastSave: Date.now(),
          totalMessages: this.messageCache.keys().length,
          totalGroups: this.groupCache.keys().length,
          totalContacts: this.contactCache.keys().length,
          totalChats: this.chatCache.keys().length,
          stats: this.stats,
          connectionState: this.connectionState,
        },
      };

      Object.entries(dataToSave).forEach(([type, data]) => {
        try {
          const filePath = path.join(this.dataDir, `${type}.json`);
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
          logger.error(`❌ Erro ao salvar ${type}:`, error.message);
        }
      });

      logger.debug('💾 Cache: Dados salvos em arquivos JSON');
    } catch (error) {
      logger.error('❌ Erro geral ao salvar dados:', error.message);
    }
  }

  /**
   * Retorna o cache apropriado baseado no tipo
   */
  getCacheByType(type) {
    const cacheMap = {
      groups: this.groupCache,
      contacts: this.contactCache,
      chats: this.chatCache,
      messages: this.messageCache,
      events: this.eventCache,
    };
    return cacheMap[type] || this.eventCache;
  }

  /**
   * Incrementa estatísticas de cache
   */
  incrementCacheStats(type = 'hit') {
    this.stats[type === 'hit' ? 'cacheHits' : 'cacheMisses']++;
  }

  /**
   * Calcula taxa de acerto do cache
   */
  calculateCacheHitRate() {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    return total > 0 ? ((this.stats.cacheHits / total) * 100).toFixed(2) : 0;
  }

  /**
   * Métodos públicos para acessar cache com estatísticas
   */
  getMessage(remoteJid, messageId) {
    const key = `${remoteJid}_${messageId}`;
    const message = this.messageCache.get(key);

    this.incrementCacheStats(message ? 'hit' : 'miss');

    if (message) {
      logger.debug(`📱 Cache hit para mensagem: ${messageId.substring(0, 10)}...`);
    }

    return message;
  }

  getGroup(groupJid) {
    const group = this.groupCache.get(groupJid);
    this.incrementCacheStats(group ? 'hit' : 'miss');
    return group;
  }

  getContact(contactJid) {
    const contact = this.contactCache.get(contactJid);
    this.incrementCacheStats(contact ? 'hit' : 'miss');
    return contact;
  }

  getChat(chatJid) {
    const chat = this.chatCache.get(chatJid);
    this.incrementCacheStats(chat ? 'hit' : 'miss');
    return chat;
  }

  /**
   * Estatísticas do cache
   */
  getCacheStats() {
    return {
      messages: this.messageCache.keys().length,
      groups: this.groupCache.keys().length,
      contacts: this.contactCache.keys().length,
      chats: this.chatCache.keys().length,
      events: this.eventCache.keys().length,
      cacheHitRate: this.calculateCacheHitRate(),
      performance: this.stats,
      connectionState: this.connectionState,
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * Obtém estatísticas de conexão completas
   */
  getConnectionStats() {
    const baseStats = this.getCacheStats();
    const connectionStats = this.socketController ? (typeof this.socketController.getConnectionStats === 'function' ? this.socketController.getConnectionStats() : {}) : {};

    return {
      ...baseStats,
      ...connectionStats,
      integrationEnabled: this.socketController !== null,
    };
  }

  /**
   * Envia mensagem através do socketController
   * @param {string} jid - JID do destinatário
   * @param {*} content - Conteúdo da mensagem
   * @param {Object} options - Opções da mensagem
   */
  async sendMessage(jid, content, options = {}) {
    if (!this.socketController) {
      throw new Error('SocketController não configurado');
    }

    if (typeof this.socketController.sendMessage === 'function') {
      return await this.socketController.sendMessage(jid, content, options);
    }

    throw new Error('Método sendMessage não disponível no socketController');
  }

  /**
   * Força reconexão através do socketController
   */
  async forceReconnect() {
    if (this.socketController && typeof this.socketController.forceReconnect === 'function') {
      logger.info('🔄 Events: Solicitando reconexão através do socketController');
      return await this.socketController.forceReconnect();
    }

    logger.warn('⚠️ Events: Método forceReconnect não disponível no socketController');
  }

  /**
   * Processa eventos de mensagens (messages.upsert)
   */
  async processMessagesUpsert(messageUpdate) {
    setImmediate(async () => {
      try {
        this.stats.processedEvents++;
        const messageCount = messageUpdate.messages?.length || 0;
        logger.info(`📨 Events: Processando messages.upsert - ${messageCount} mensagem(ns)`);

        // Salva evento no cache
        const eventId = `upsert_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'messages.upsert',
          data: messageUpdate,
          timestamp: Date.now(),
        });

        const groupJids = new Set();

        if (messageUpdate.messages && Array.isArray(messageUpdate.messages)) {
          let processedCount = 0;

          for (const messageInfo of messageUpdate.messages) {
            try {
              const isGroupMessage = messageInfo.key?.remoteJid?.endsWith('@g.us');
              if (isGroupMessage && messageInfo.key.remoteJid) {
                groupJids.add(messageInfo.key.remoteJid);
              }

              const enhancedMessageInfo = {
                ...messageInfo,
                _receivedAt: Date.now(),
                _updateType: messageUpdate.type || 'notify',
                _batchId: Date.now().toString(),
                _isGroupMessage: isGroupMessage,
                _groupJid: isGroupMessage ? messageInfo.key.remoteJid : null,
                _senderJid: isGroupMessage ? messageInfo.key.participant || messageInfo.key.remoteJid : messageInfo.key.remoteJid,
              };

              // Salva mensagem no cache
              const messageKey = `${messageInfo.key.remoteJid}_${messageInfo.key.id}`;
              this.messageCache.set(messageKey, enhancedMessageInfo);
              processedCount++;

              const jid = messageInfo.key?.remoteJid?.substring(0, 20) || 'N/A';
              const messageType = messageInfo.message ? Object.keys(messageInfo.message)[0] : 'unknown';

              if (isGroupMessage) {
                logger.debug(`   ✓ Msg ${processedCount}: ${messageType} | GRUPO ${jid}...`);
              } else {
                logger.debug(`   ✓ Msg ${processedCount}: ${messageType} | ${jid}...`);
              }
            } catch (error) {
              logger.error('Events: Erro ao processar mensagem individual:', error.message);
            }
          }

          // Carrega metadados dos grupos detectados
          if (groupJids.size > 0) {
            logger.info(`Events: Carregando metadados de ${groupJids.size} grupo(s) detectado(s)`);
            await this.loadGroupsMetadata(Array.from(groupJids));
          }

          logger.info(`Events: ✅ ${processedCount}/${messageUpdate.messages.length} mensagens processadas`);
        }

        // Executa callbacks para novas mensagens
        await this.executeCallbacks('messages.received', {
          messages: messageUpdate.messages,
          groupJids: Array.from(groupJids),
          processedCount: messageUpdate.messages?.length || 0,
        });
      } catch (error) {
        logger.error('Events: Erro no processamento de messages.upsert:', error.message);
      }
    });
  }

  /**
   * Carrega metadados de grupos em lote
   * @param {Array} groupJids - Array de JIDs de grupos
   */
  async loadGroupsMetadata(groupJids) {
    if (!Array.isArray(groupJids) || groupJids.length === 0) {
      return;
    }

    const client = this.getWhatsAppClient();
    if (!client) {
      logger.warn('Events: Cliente WhatsApp não disponível para carregar metadados');
      return;
    }

    try {
      logger.info(`Events: Iniciando carregamento de metadados para ${groupJids.length} grupo(s)`);

      const promises = groupJids.map(async (groupJid, index) => {
        try {
          await new Promise((resolve) => setTimeout(resolve, index * 100));

          const metadata = await this.getOrFetchGroupMetadata(groupJid);

          if (metadata) {
            logger.info(`Events: Metadados carregados para "${metadata.subject}" (${metadata._participantCount || 0} participantes)`);
            return { success: true, groupJid, metadata };
          } else {
            logger.warn(`Events: Não foi possível carregar metadados do grupo ${groupJid}`);
            return { success: false, groupJid, error: 'Metadados não encontrados' };
          }
        } catch (error) {
          logger.error(`Events: Erro ao carregar metadados do grupo ${groupJid}:`, error.message);
          return { success: false, groupJid, error: error.message };
        }
      });

      const results = await Promise.allSettled(promises);
      const successful = results.filter((result) => result.status === 'fulfilled' && result.value.success).length;
      const failed = results.length - successful;

      if (successful > 0) {
        logger.info(`Events: ✅ Carregamento concluído - ${successful} sucessos, ${failed} falhas`);
      }

      if (failed > 0) {
        logger.warn(`Events: ⚠️ ${failed} grupo(s) não puderam ter metadados carregados`);
      }
    } catch (error) {
      logger.error('Events: Erro geral no carregamento de metadados:', error.message);
    }
  }

  /**
   * Busca ou obtém metadados de grupo do cache/API
   * @param {string} groupJid - JID do grupo
   * @returns {Object|null} Metadados do grupo
   */
  async getOrFetchGroupMetadata(groupJid) {
    try {
      // Verifica cache primeiro
      let metadata = this.groupCache.get(groupJid);

      if (metadata && metadata._cachedAt && Date.now() - metadata._cachedAt < 3600000) {
        logger.debug(`Cache hit para grupo: ${groupJid.substring(0, 30)}...`);
        return metadata;
      }

      // Busca da API se não estiver em cache ou estiver expirado
      const client = this.getWhatsAppClient();
      if (!client) {
        logger.warn(`Events: Cliente não disponível para buscar metadados do grupo ${groupJid}`);
        return metadata || null;
      }

      logger.debug(`Buscando metadados do grupo via API: ${groupJid.substring(0, 30)}...`);

      const fetchedMetadata = await client.groupMetadata(groupJid);
      if (fetchedMetadata) {
        // Enriquece com dados calculados
        const enrichedMetadata = {
          ...fetchedMetadata,
          _cachedAt: Date.now(),
          _participantCount: fetchedMetadata.participants?.length || 0,
          _adminCount: fetchedMetadata.participants?.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').length || 0,
          _lastFetch: Date.now(),
        };

        // Salva no cache
        this.groupCache.set(groupJid, enrichedMetadata);
        logger.info(`Cache atualizado para grupo: ${enrichedMetadata.subject || 'Sem nome'}`);

        // Executa callbacks de metadados atualizados
        await this.executeCallbacks('group.metadata.updated', {
          groupJid,
          metadata: enrichedMetadata,
          wasFromCache: false,
        });

        return enrichedMetadata;
      }

      logger.warn(`Events: Não foi possível buscar metadados para ${groupJid}`);
      return metadata || null;
    } catch (error) {
      logger.error(`Events: Erro ao buscar metadados do grupo ${groupJid}:`, error.message);
      return this.groupCache.get(groupJid) || null;
    }
  }

  /**
   * Processa eventos genéricos
   */
  async processGenericEvent(eventType, eventData) {
    setImmediate(async () => {
      try {
        this.stats.processedEvents++;
        logger.info(`🔄 Events: Processando ${eventType}`);

        const eventId = `${eventType}_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: eventType,
          data: eventData,
          timestamp: Date.now(),
        });

        // Executa callbacks para eventos genéricos
        await this.executeCallbacks(eventType, eventData);
      } catch (error) {
        logger.error(`Events: Erro no processamento de ${eventType}:`, error.message);
      }
    });
  }

  /**
   * Limpa cache específico
   */
  clearCache(type = 'all') {
    switch (type) {
      case 'messages':
        this.messageCache.flushAll();
        break;
      case 'groups':
        this.groupCache.flushAll();
        break;
      case 'contacts':
        this.contactCache.flushAll();
        break;
      case 'chats':
        this.chatCache.flushAll();
        break;
      case 'events':
        this.eventCache.flushAll();
        break;
      case 'all':
        this.messageCache.flushAll();
        this.groupCache.flushAll();
        this.contactCache.flushAll();
        this.chatCache.flushAll();
        this.eventCache.flushAll();
        break;
    }
    logger.info(`🧹 Cache ${type} limpo`);
  }

  /**
   * Valida se um JID está em cache
   */
  isJidKnown(jid) {
    return this.contactCache.has(jid) || this.groupCache.has(jid) || this.chatCache.has(jid);
  }

  /**
   * Limpa dados antigos baseado em timestamp
   */
  cleanOldData(maxAge = 24 * 60 * 60 * 1000) {
    try {
      const now = Date.now();
      let cleaned = 0;

      // Limpa mensagens antigas
      this.messageCache.keys().forEach((key) => {
        const message = this.messageCache.get(key);
        if (message && message._receivedAt && now - message._receivedAt > maxAge) {
          this.messageCache.del(key);
          cleaned++;
        }
      });

      // Limpa eventos antigos
      this.eventCache.keys().forEach((key) => {
        const event = this.eventCache.get(key);
        if (event && event.timestamp && now - event.timestamp > maxAge) {
          this.eventCache.del(key);
          cleaned++;
        }
      });

      if (cleaned > 0) {
        logger.info(`🧹 Limpeza: ${cleaned} itens antigos removidos`);
      }

      return cleaned;
    } catch (error) {
      logger.error('Erro na limpeza de dados antigos:', error.message);
      return 0;
    }
  }

  /**
   * Exporta dados do cache para backup
   */
  exportCacheData() {
    try {
      return {
        timestamp: Date.now(),
        version: '2.1.0',
        data: {
          messages: this.messageCache.keys().length,
          groups: this.groupCache.keys().reduce((acc, key) => {
            acc[key] = this.groupCache.get(key);
            return acc;
          }, {}),
          contacts: this.contactCache.keys().reduce((acc, key) => {
            acc[key] = this.contactCache.get(key);
            return acc;
          }, {}),
          chats: this.chatCache.keys().reduce((acc, key) => {
            acc[key] = this.chatCache.get(key);
            return acc;
          }, {}),
          stats: this.getCacheStats(),
        },
      };
    } catch (error) {
      logger.error('Erro ao exportar dados:', error.message);
      return null;
    }
  }
}

// Instância única do EventHandler
const eventHandler = new EventHandler();

module.exports = {
  eventHandler,
  EventHandler,
};
