/**
 * OmniZap Event Handler
 *
 * Módulo responsável pelo processamento independente de eventos
 * Usa cache local centralizado e persistência em JSON
 *
 * @version 2.0.0
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
    this.cacheDir = path.join(__dirname, '../../temp/cache');
    this.dataDir = path.join(__dirname, '../../temp/data');

    // Cache instances com TTL diferenciados
    this.messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1 hora
    this.groupCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 }); // 2 horas
    this.contactCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 }); // 2 horas
    this.chatCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1 hora
    this.eventCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 }); // 30 minutos

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

      logger.info('🎯 OmniZap Events: Cache local inicializado');
      this.initialized = true;
    } catch (error) {
      logger.error('❌ Erro ao inicializar cache:', error.message);
    }
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
   * Processa eventos de mensagens (messages.upsert)
   */
  async processMessagesUpsert(messageUpdate) {
    setImmediate(async () => {
      try {
        logger.info(`📨 Events: Processando messages.upsert - ${messageUpdate.messages?.length || 0} mensagem(ns)`);

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
              logger.error('Events: Erro ao processar mensagem individual:', {
                error: error.message,
                stack: error.stack,
              });
            }
          }

          if (groupJids.size > 0 && this.omniZapClient) {
            logger.info(`Events: Carregando metadados de ${groupJids.size} grupo(s) detectado(s)`);
            await this.loadGroupsMetadata(Array.from(groupJids));
          }

          logger.info(`Events: ✅ ${processedCount}/${messageUpdate.messages.length} mensagens processadas`);
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de messages.upsert:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de atualização de mensagens (messages.update)
   */
  async processMessagesUpdate(updates) {
    setImmediate(async () => {
      try {
        logger.info(`📝 Events: Processando messages.update - ${updates?.length || 0} atualização(ões)`);

        const eventId = `update_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'messages.update',
          data: updates,
          timestamp: Date.now(),
        });

        updates?.forEach((update, index) => {
          const status = update.update?.status || 'N/A';
          const jid = update.key?.remoteJid?.substring(0, 20) || 'N/A';
          logger.debug(`   ${index + 1}. Status: ${status} | JID: ${jid}...`);

          // Atualiza mensagem no cache se existir
          const messageKey = `${update.key.remoteJid}_${update.key.id}`;
          const existingMessage = this.messageCache.get(messageKey);
          if (existingMessage) {
            this.messageCache.set(messageKey, { ...existingMessage, ...update.update });
          }
        });
      } catch (error) {
        logger.error('Events: Erro no processamento de messages.update:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de exclusão de mensagens (messages.delete)
   */
  async processMessagesDelete(deletion) {
    setImmediate(async () => {
      try {
        logger.warn('🗑️ Events: Processando messages.delete');

        const eventId = `delete_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'messages.delete',
          data: deletion,
          timestamp: Date.now(),
        });

        if (deletion.keys) {
          logger.debug(`   Mensagens deletadas: ${deletion.keys.length}`);
          deletion.keys.forEach((key, index) => {
            const jid = key.remoteJid?.substring(0, 20) || 'N/A';
            const id = key.id?.substring(0, 10) || 'N/A';
            logger.debug(`   ${index + 1}. JID: ${jid}... | ID: ${id}...`);

            // Remove mensagem do cache
            const messageKey = `${key.remoteJid}_${key.id}`;
            this.messageCache.del(messageKey);
          });
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de messages.delete:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de reações (messages.reaction)
   */
  async processMessagesReaction(reactions) {
    setImmediate(async () => {
      try {
        logger.info(`😀 Events: Processando messages.reaction - ${reactions?.length || 0} reação(ões)`);

        const eventId = `reaction_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'messages.reaction',
          data: reactions,
          timestamp: Date.now(),
        });

        reactions?.forEach((reaction, index) => {
          const emoji = reaction.reaction?.text || '❓';
          const jid = reaction.key?.remoteJid?.substring(0, 20) || 'N/A';
          logger.debug(`   ${index + 1}. ${emoji} | JID: ${jid}...`);
        });
      } catch (error) {
        logger.error('Events: Erro no processamento de messages.reaction:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de recibo de mensagem (message-receipt.update)
   */
  async processMessageReceipt(receipts) {
    setImmediate(async () => {
      try {
        logger.info(`📬 Events: Processando message-receipt.update - ${receipts?.length || 0} recibo(s)`);

        const eventId = `receipt_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'message-receipt.update',
          data: receipts,
          timestamp: Date.now(),
        });

        receipts?.forEach((receipt, index) => {
          const status = receipt.receipt?.readTimestamp ? '✓✓ Lida' : receipt.receipt?.receiptTimestamp ? '✓✓ Entregue' : '✓ Enviada';
          const jid = receipt.key?.remoteJid?.substring(0, 20) || 'N/A';
          logger.debug(`   ${index + 1}. ${status} | JID: ${jid}...`);
        });
      } catch (error) {
        logger.error('Events: Erro no processamento de message-receipt.update:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de histórico de mensagens (messaging-history.set)
   */
  async processMessagingHistory(historyData) {
    setImmediate(async () => {
      try {
        logger.info('📚 Events: Processando messaging-history.set');

        const eventId = `history_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'messaging-history.set',
          data: historyData,
          timestamp: Date.now(),
        });

        if (historyData.messages) {
          logger.debug(`   Mensagens no histórico: ${historyData.messages.length}`);
        }
        if (historyData.chats) {
          logger.debug(`   Chats no histórico: ${historyData.chats.length}`);
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de messaging-history.set:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de grupos (groups.update)
   */
  async processGroupsUpdate(updates) {
    setImmediate(async () => {
      try {
        logger.info(`👥 Events: Processando groups.update - ${updates?.length || 0} atualização(ões)`);

        const eventId = `groups_update_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'groups.update',
          data: updates,
          timestamp: Date.now(),
        });

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          logger.debug(`   Grupo atualizado: ${jid}...`);

          if (update.id) {
            // Verifica cache local primeiro
            const cachedGroup = this.groupCache.get(update.id);

            // Atualiza cache com novos dados
            const updatedGroup = cachedGroup ? { ...cachedGroup, ...update } : update;
            this.groupCache.set(update.id, updatedGroup);

            if (cachedGroup) {
              logger.info(`   Cache hit para grupo: ${jid}...`);
            }
          }
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de groups.update:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de grupos (groups.upsert)
   */
  async processGroupsUpsert(groupsMetadata) {
    setImmediate(async () => {
      try {
        logger.info(`👥 Events: Processando groups.upsert - ${groupsMetadata?.length || 0} grupo(s)`);

        const eventId = `groups_upsert_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'groups.upsert',
          data: groupsMetadata,
          timestamp: Date.now(),
        });

        for (const group of groupsMetadata || []) {
          const jid = group.id?.substring(0, 30) || 'N/A';
          const subject = group.subject || 'Sem nome';
          logger.debug(`   ${subject} | JID: ${jid}...`);

          // Salva no cache de grupos
          this.groupCache.set(group.id, {
            ...group,
            _cachedAt: Date.now(),
            _participantCount: group.participants?.length || 0,
          });

          // Busca metadados completos se cliente disponível
          if (this.omniZapClient && group.id) {
            try {
              await this.getOrFetchGroupMetadata(group.id);
            } catch (error) {
              logger.error(`Events: Erro ao buscar metadados do grupo ${subject}:`, error.message);
            }
          }
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de groups.upsert:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de participantes de grupo (group-participants.update)
   */
  async processGroupParticipants(event) {
    setImmediate(async () => {
      try {
        logger.info('👥 Events: Processando group-participants.update');

        const eventId = `participants_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'group-participants.update',
          data: event,
          timestamp: Date.now(),
        });

        const jid = event.id?.substring(0, 30) || 'N/A';
        const action = event.action || 'N/A';
        const participants = event.participants?.length || 0;
        logger.debug(`   Grupo: ${jid}... | Ação: ${action} | Participantes: ${participants}`);

        // Atualiza cache do grupo se existir
        if (event.id) {
          const cachedGroup = this.groupCache.get(event.id);
          if (cachedGroup) {
            const updatedGroup = { ...cachedGroup };
            if (event.action === 'add') {
              updatedGroup.participants = [...(updatedGroup.participants || []), ...event.participants];
            } else if (event.action === 'remove') {
              updatedGroup.participants = (updatedGroup.participants || []).filter((p) => !event.participants.includes(p));
            }
            updatedGroup._participantCount = updatedGroup.participants?.length || 0;
            updatedGroup._lastUpdate = Date.now();
            this.groupCache.set(event.id, updatedGroup);
          }
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de group-participants.update:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de chats (chats.upsert)
   */
  async processChatsUpsert(chats) {
    setImmediate(async () => {
      try {
        logger.info(`💬 Events: Processando chats.upsert - ${chats?.length || 0} chat(s)`);

        const eventId = `chats_upsert_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'chats.upsert',
          data: chats,
          timestamp: Date.now(),
        });

        for (const chat of chats || []) {
          const jid = chat.id?.substring(0, 30) || 'N/A';
          const name = chat.name || 'Sem nome';
          logger.debug(`   ${name} | JID: ${jid}...`);

          // Verifica cache local
          const cachedChat = this.chatCache.get(chat.id);

          // Salva no cache
          this.chatCache.set(chat.id, {
            ...chat,
            _cachedAt: Date.now(),
          });

          if (cachedChat) {
            logger.info(`   Cache hit para chat: ${name}`);
          }
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de chats.upsert:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de chats (chats.update)
   */
  async processChatsUpdate(updates) {
    setImmediate(async () => {
      try {
        logger.info(`💬 Events: Processando chats.update - ${updates?.length || 0} atualização(ões)`);

        const eventId = `chats_update_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'chats.update',
          data: updates,
          timestamp: Date.now(),
        });

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          logger.debug(`   Chat atualizado: ${jid}...`);

          // Verifica cache local
          const cachedChat = this.chatCache.get(update.id);

          // Atualiza cache
          const updatedChat = cachedChat ? { ...cachedChat, ...update } : update;
          updatedChat._lastUpdate = Date.now();
          this.chatCache.set(update.id, updatedChat);

          if (cachedChat) {
            logger.info(`   Cache hit para chat: ${jid}...`);
          }
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de chats.update:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de chats deletados (chats.delete)
   */
  async processChatsDelete(jids) {
    setImmediate(async () => {
      try {
        logger.warn(`💬 Events: Processando chats.delete - ${jids?.length || 0} chat(s) deletado(s)`);

        const eventId = `chats_delete_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'chats.delete',
          data: jids,
          timestamp: Date.now(),
        });

        jids?.forEach((jid, index) => {
          logger.debug(`   ${index + 1}. JID deletado: ${jid.substring(0, 30)}...`);

          // Remove do cache
          this.chatCache.del(jid);
        });
      } catch (error) {
        logger.error('Events: Erro no processamento de chats.delete:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de contatos (contacts.upsert)
   */
  async processContactsUpsert(contacts) {
    setImmediate(async () => {
      try {
        logger.info(`👤 Events: Processando contacts.upsert - ${contacts?.length || 0} contato(s)`);

        const eventId = `contacts_upsert_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'contacts.upsert',
          data: contacts,
          timestamp: Date.now(),
        });

        for (const contact of contacts || []) {
          const jid = contact.id?.substring(0, 30) || 'N/A';
          const name = contact.name || contact.notify || 'Sem nome';
          logger.debug(`   ${name} | JID: ${jid}...`);

          // Verifica cache local
          const cachedContact = this.contactCache.get(contact.id);

          // Salva no cache
          this.contactCache.set(contact.id, {
            ...contact,
            _cachedAt: Date.now(),
          });

          if (cachedContact) {
            logger.info(`   Cache hit para contato: ${name}`);
          }
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de contacts.upsert:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Processa eventos de contatos (contacts.update)
   */
  async processContactsUpdate(updates) {
    setImmediate(async () => {
      try {
        logger.info(`👤 Events: Processando contacts.update - ${updates?.length || 0} atualização(ões)`);

        const eventId = `contacts_update_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: 'contacts.update',
          data: updates,
          timestamp: Date.now(),
        });

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          const name = update.name || update.notify || 'Sem nome';
          logger.debug(`   ${name} | JID: ${jid}...`);

          // Verifica cache local
          const cachedContact = this.contactCache.get(update.id);

          // Atualiza cache
          const updatedContact = cachedContact ? { ...cachedContact, ...update } : update;
          updatedContact._lastUpdate = Date.now();
          this.contactCache.set(update.id, updatedContact);

          if (cachedContact) {
            logger.info(`   Cache hit para contato: ${name}`);
          }
        }
      } catch (error) {
        logger.error('Events: Erro no processamento de contacts.update:', {
          error: error.message,
          stack: error.stack,
        });
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

    if (!this.omniZapClient) {
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
        // 1 hora
        logger.debug(`Cache hit para grupo: ${groupJid.substring(0, 30)}...`);
        return metadata;
      }

      // Busca da API se cliente disponível
      if (this.omniZapClient) {
        try {
          const freshMetadata = await this.omniZapClient.groupMetadata(groupJid);
          const enhancedMetadata = {
            ...freshMetadata,
            _cachedAt: Date.now(),
            _participantCount: freshMetadata.participants?.length || 0,
            _fetchedFromAPI: true,
          };

          this.groupCache.set(groupJid, enhancedMetadata);
          logger.debug(`Metadados atualizados da API para: ${freshMetadata.subject}`);
          return enhancedMetadata;
        } catch (apiError) {
          logger.warn(`Erro ao buscar da API, usando cache: ${apiError.message}`);
          return metadata; // Retorna cache mesmo expirado se API falhar
        }
      }

      return metadata;
    } catch (error) {
      logger.error(`Erro ao obter metadados do grupo ${groupJid}:`, error.message);
      return null;
    }
  }

  /**
   * Processa outros eventos genéricos
   */
  async processGenericEvent(eventType, eventData) {
    setImmediate(async () => {
      try {
        logger.info(`🔄 Events: Processando ${eventType}`);

        const eventId = `${eventType}_${Date.now()}`;
        this.eventCache.set(eventId, {
          type: eventType,
          data: eventData,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error(`Events: Erro no processamento de ${eventType}:`, error.message);
      }
    });
  }

  /**
   * Métodos públicos para acessar cache
   */

  getMessage(remoteJid, messageId) {
    const key = `${remoteJid}_${messageId}`;
    return this.messageCache.get(key);
  }

  getGroup(groupJid) {
    return this.groupCache.get(groupJid);
  }

  getContact(contactJid) {
    return this.contactCache.get(contactJid);
  }

  getChat(chatJid) {
    return this.chatCache.get(chatJid);
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
      memoryUsage: process.memoryUsage(),
    };
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
}

const eventHandler = new EventHandler();

module.exports = {
  eventHandler,
};
