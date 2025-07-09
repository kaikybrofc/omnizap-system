/**
 * OmniZap Cache Manager
 *
 * Módulo responsável pelo gerenciamento avançado de cache
 * Funciona de forma independente e assíncrona
 *
 * @version 1.0.6
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const NodeCache = require('node-cache');
const logger = require('../utils/logger/loggerModule');
const { cleanEnv, num, bool, str } = require('envalid');
const fs = require('fs').promises;
const path = require('path');
const db = require('../database/mysql');

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

const TEMP_DIR = path.join(process.cwd(), 'temp');
const GROUP_METADATA_FILE = path.join(TEMP_DIR, 'groupMetadata.json');

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
      // Inicializar banco de dados MySQL
      logger.info('🔄 OmniZap Cache: Inicializando banco de dados MySQL');
      const dbInitialized = await db.initDatabase();

      if (dbInitialized) {
        logger.info('✅ OmniZap Cache: Banco de dados MySQL inicializado com sucesso');
      } else {
        logger.warn('⚠️ OmniZap Cache: Erro na inicialização do MySQL, usando apenas cache em memória');
      }

      // Manter suporte ao arquivo de metadados para compatibilidade
      await fs.mkdir(TEMP_DIR, { recursive: true });

      try {
        await fs.access(GROUP_METADATA_FILE);
        logger.info('Cache: Arquivo de metadados de grupos encontrado');
      } catch (error) {
        await fs.writeFile(GROUP_METADATA_FILE, JSON.stringify({}, null, 2));
        logger.info('Cache: Arquivo de metadados de grupos criado');
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
   * Salva uma mensagem no cache e no banco de dados (processamento assíncrono)
   */
  async saveMessage(messageInfo) {
    setImmediate(async () => {
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

        // Salvar no cache em memória para acesso rápido
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

        // Extrair texto da mensagem para pesquisa
        let messageText = '';
        if (messageInfo.message) {
          const messageType = Object.keys(messageInfo.message)[0];
          if (messageType === 'conversation') {
            messageText = messageInfo.message.conversation || '';
          } else if (messageType === 'extendedTextMessage') {
            messageText = messageInfo.message.extendedTextMessage?.text || '';
          } else if (messageType === 'imageMessage') {
            messageText = messageInfo.message.imageMessage?.caption || '';
          } else if (messageType === 'videoMessage') {
            messageText = messageInfo.message.videoMessage?.caption || '';
          }
        }

        // Salvar no banco de dados para persistência
        try {
          await db.query(
            `INSERT INTO messages 
            (id, remote_jid, from_me, push_name, timestamp, message_type, message_text, participant, quoted_message_id, raw_data) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            raw_data = VALUES(raw_data),
            updated_at = CURRENT_TIMESTAMP`,
            [messageInfo.key.id, messageInfo.key.remoteJid, messageInfo.key.fromMe ? 1 : 0, messageInfo.pushName || null, messageInfo.messageTimestamp || Date.now() / 1000, enhancedMessage._messageType, messageText, messageInfo.key.participant || null, messageInfo.message?.extendedTextMessage?.contextInfo?.stanzaId || null, JSON.stringify(messageInfo)],
          );

          logger.debug(`Cache: Mensagem salva no banco de dados (${messageInfo.key.id})`);
        } catch (dbError) {
          logger.error('Cache: Erro ao salvar mensagem no banco de dados:', {
            error: dbError.message,
            stack: dbError.stack,
          });
        }

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
   * Salva evento no cache e no banco de dados (processamento assíncrono)
   */
  async saveEvent(eventType, eventData, eventId = null) {
    setImmediate(async () => {
      try {
        if (!eventType || !eventData) {
          logger.warn('Cache: Dados de evento inválidos');
          return;
        }

        const timestamp = Date.now();
        const generatedId = `${eventType}_${timestamp}_${Math.random().toString(36).substring(2, 10)}`;
        const cacheKey = eventId ? `event_${eventType}_${eventId}_${timestamp}` : `event_${eventType}_${timestamp}`;

        const enhancedEvent = {
          ...eventData,
          _eventType: eventType,
          _cached: true,
          _cacheTimestamp: timestamp,
          _eventId: eventId || generatedId,
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

        // Salvar no banco de dados para persistência
        try {
          await db.query(
            `INSERT INTO events 
            (id, event_type, event_id, event_timestamp, event_data) 
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            event_data = VALUES(event_data)`,
            [eventId || generatedId, eventType, eventId, timestamp, JSON.stringify(eventData)],
          );

          logger.debug(`Cache: Evento salvo no banco de dados (${eventType})`);
        } catch (dbError) {
          logger.error('Cache: Erro ao salvar evento no banco de dados:', {
            error: dbError.message,
            stack: dbError.stack,
          });
        }

        logger.debug(`Cache: Evento ${eventType} salvo (${cacheKey.substring(0, 50)}...)`);
      } catch (error) {
        logger.error('Cache: Erro ao salvar evento:', { error: error.message, stack: error.stack });
      }
    });
  }

  /**
   * Salva metadados de grupo no cache persistente (arquivo e banco de dados)
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

      // Salvar no arquivo para compatibilidade
      const allMetadata = await this._readGroupMetadataFile();
      allMetadata[jid] = { ...(allMetadata[jid] || {}), ...enhancedMetadata };
      await this._writeGroupMetadataFile(allMetadata);

      // Salvar no banco de dados
      try {
        // 1. Inserir/atualizar informações do grupo
        await db.query(
          `INSERT INTO \`groups\` 
          (jid, subject, creation_timestamp, owner, description, participant_count, metadata, last_updated) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
          subject = VALUES(subject),
          owner = VALUES(owner),
          description = VALUES(description),
          participant_count = VALUES(participant_count),
          metadata = VALUES(metadata),
          last_updated = VALUES(last_updated)`,
          [jid, metadata.subject || '', metadata.creation || 0, metadata.owner || null, metadata.desc || '', metadata.participants?.length || 0, JSON.stringify(metadata), Date.now()],
        );

        // 2. Atualizar participantes (usar INSERT IGNORE para evitar duplicatas)
        if (metadata.participants && metadata.participants.length > 0) {
          // A cada hora, atualizar todos os participantes usando o método updateGroupParticipants
          const currentHour = Math.floor(Date.now() / 3600000);
          const lastUpdate = parseInt(metadata._lastParticipantFullUpdate || 0);

          if (currentHour > lastUpdate) {
            // Atualização completa de participantes a cada hora
            enhancedMetadata._lastParticipantFullUpdate = currentHour;
            await this.updateGroupParticipants(jid, metadata.participants);
            logger.info(`Cache: Atualização completa de participantes para o grupo ${jid.substring(0, 15)}...`);
          } else {
            // Inserção com IGNORE para novos participantes
            for (const participant of metadata.participants) {
              await db.query(
                `INSERT IGNORE INTO group_participants 
                (group_jid, participant_jid, is_admin, is_super_admin) 
                VALUES (?, ?, ?, ?)`,
                [jid, participant.id, participant.admin === 'admin' ? 1 : 0, participant.admin === 'superadmin' ? 1 : 0],
              );
            }
          }
        }

        logger.debug(`Cache: Grupo salvo no banco de dados (${jid})`);
      } catch (dbError) {
        logger.error('Cache: Erro ao salvar grupo no banco de dados:', {
          error: dbError.message,
          stack: dbError.stack,
        });
      }

      logger.debug(`Cache: Grupo salvo em arquivo (${jid.substring(0, 30)}...)`);
    } catch (error) {
      logger.error('Cache: Erro ao salvar grupo:', { error: error.message, stack: error.stack });
    }
  }

  /**
   * Atualiza o status dos participantes de um grupo no banco de dados
   * @param {string} jid - ID do grupo
   * @param {Array} participants - Lista de participantes
   */
  async updateGroupParticipants(jid, participants) {
    try {
      if (!jid || !participants || !Array.isArray(participants)) {
        return;
      }

      // Usar ON DUPLICATE KEY UPDATE para atualizar os status de admin
      for (const participant of participants) {
        await db.query(
          `INSERT INTO group_participants 
          (group_jid, participant_jid, is_admin, is_super_admin, joined_timestamp) 
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
          is_admin = VALUES(is_admin),
          is_super_admin = VALUES(is_super_admin)`,
          [jid, participant.id, participant.admin === 'admin' ? 1 : 0, participant.admin === 'superadmin' ? 1 : 0, Date.now()],
        );
      }

      logger.debug(`Cache: Status de participantes atualizados para o grupo ${jid.substring(0, 15)}...`);
    } catch (error) {
      logger.error('Cache: Erro ao atualizar participantes do grupo:', {
        error: error.message,
        stack: error.stack,
        groupJid: jid,
      });
    }
  }

  /**
   * Salva contato no cache e no banco de dados
   */
  async saveContact(contact) {
    setImmediate(async () => {
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

        // Salvar no cache em memória
        contactsCache.set(cacheKey, enhancedContact);

        // Salvar no banco de dados
        try {
          await db.query(
            `INSERT INTO contacts 
            (jid, name, notify, verify, short_name, push_name, status, is_business, is_enterprise, metadata, last_updated) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            name = COALESCE(VALUES(name), name),
            notify = COALESCE(VALUES(notify), notify),
            verify = COALESCE(VALUES(verify), verify),
            short_name = COALESCE(VALUES(short_name), short_name),
            push_name = COALESCE(VALUES(push_name), push_name),
            status = COALESCE(VALUES(status), status),
            is_business = VALUES(is_business),
            is_enterprise = VALUES(is_enterprise),
            metadata = VALUES(metadata),
            last_updated = VALUES(last_updated)`,
            [contact.id, contact.name || null, contact.notify || null, contact.verify || null, contact.shortName || null, contact.pushName || null, contact.status || null, contact.isBusiness ? 1 : 0, contact.isEnterprise ? 1 : 0, JSON.stringify(contact), Date.now()],
          );

          logger.debug(`Cache: Contato salvo no banco de dados (${contact.id})`);
        } catch (dbError) {
          logger.error('Cache: Erro ao salvar contato no banco de dados:', {
            error: dbError.message,
            stack: dbError.stack,
          });
        }

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
   * Salva chat no cache e no banco de dados
   */
  async saveChat(chat) {
    setImmediate(async () => {
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

        // Salvar no cache em memória
        chatsCache.set(cacheKey, enhancedChat);

        // Salvar no banco de dados
        try {
          await db.query(
            `INSERT INTO chats 
            (jid, name, unread_count, timestamp, archived, pinned, is_muted, is_group, metadata, last_updated) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            name = COALESCE(VALUES(name), name),
            unread_count = VALUES(unread_count),
            timestamp = VALUES(timestamp),
            archived = VALUES(archived),
            pinned = VALUES(pinned),
            is_muted = VALUES(is_muted),
            is_group = VALUES(is_group),
            metadata = VALUES(metadata),
            last_updated = VALUES(last_updated)`,
            [chat.id, chat.name || null, chat.unreadCount || 0, chat.conversationTimestamp || Date.now(), chat.archived ? 1 : 0, chat.pinned ? 1 : 0, chat.mute > 0 ? 1 : 0, chat.id.endsWith('@g.us') ? 1 : 0, JSON.stringify(chat), Date.now()],
          );

          logger.debug(`Cache: Chat salvo no banco de dados (${chat.id})`);
        } catch (dbError) {
          logger.error('Cache: Erro ao salvar chat no banco de dados:', {
            error: dbError.message,
            stack: dbError.stack,
          });
        }

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

      let groupsCount = 0;
      try {
        const allMetadata = await this._readGroupMetadataFile();
        groupsCount = Object.keys(allMetadata).length;
      } catch (error) {
        logger.error('Cache: Erro ao ler estatísticas de grupos:', {
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
        },
        events: {
          keys: eventsCache.keys().length,
          hits: eventsStats.hits,
          misses: eventsStats.misses,
          hitRate: eventsStats.hits > 0 ? ((eventsStats.hits / (eventsStats.hits + eventsStats.misses)) * 100).toFixed(2) : 0,
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
          allKeys: messagesCache.keys().length + eventsCache.keys().length + groupsCount + contactsCache.keys().length + chatsCache.keys().length,
          allHits: messagesStats.hits + eventsStats.hits + contactsStats.hits + chatsStats.hits,
          allMisses: messagesStats.misses + eventsStats.misses + contactsStats.misses + chatsStats.misses,
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
    if (!env.CACHE_AUTO_CLEAN) {
      return;
    }

    setImmediate(() => {
      try {
        const stats = this.getStats();
        const shouldClean = stats && (stats.totals.allKeys > env.CACHE_MAX_TOTAL_KEYS || stats.messages.keys > env.CACHE_MAX_MESSAGES || stats.events.keys > env.CACHE_MAX_EVENTS);

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

          logger.info(`Cache: Limpeza concluída - ${totalRemoved} itens removidos`);
        }
      } catch (error) {
        logger.error('Cache: Erro na manutenção:', { error: error.message, stack: error.stack });
      }
    });
  }

  /**
   * Busca mensagens no banco de dados
   * @param {Object} options - Opções de busca
   * @param {String} options.remoteJid - JID do chat para filtrar
   * @param {String} options.messageType - Tipo de mensagem
   * @param {String} options.text - Texto para buscar
   * @param {Number} options.limit - Número máximo de resultados
   * @param {Number} options.offset - Offset para paginação
   * @param {Date} options.startDate - Data inicial
   * @param {Date} options.endDate - Data final
   * @returns {Promise<Array>} Array de mensagens
   */
  async searchMessages(options = {}) {
    try {
      const { remoteJid, messageType, text, limit = 100, offset = 0, startDate, endDate, fromMe } = options;

      // Construir a query SQL com condições dinâmicas
      let query = 'SELECT * FROM messages WHERE 1=1';
      const params = [];

      if (remoteJid) {
        query += ' AND remote_jid = ?';
        params.push(remoteJid);
      }

      if (messageType) {
        query += ' AND message_type = ?';
        params.push(messageType);
      }

      if (text) {
        query += ' AND message_text LIKE ?';
        params.push(`%${text}%`);
      }

      if (fromMe !== undefined) {
        query += ' AND from_me = ?';
        params.push(fromMe ? 1 : 0);
      }

      if (startDate) {
        const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
        query += ' AND timestamp >= ?';
        params.push(startTimestamp);
      }

      if (endDate) {
        const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);
        query += ' AND timestamp <= ?';
        params.push(endTimestamp);
      }

      // Ordenar por timestamp descendente e aplicar limite/offset
      query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      // Executar a query
      const messages = await db.query(query, params);

      // Converter os dados JSON de volta para objetos
      return messages.map((msg) => ({
        ...JSON.parse(msg.raw_data),
        _fromDatabase: true,
      }));
    } catch (error) {
      logger.error('Cache: Erro ao buscar mensagens no banco de dados:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Busca eventos no banco de dados
   * @param {Object} options - Opções de busca
   * @param {String} options.eventType - Tipo de evento
   * @param {String} options.eventId - ID do evento
   * @param {Number} options.limit - Número máximo de resultados
   * @param {Number} options.offset - Offset para paginação
   * @param {Date} options.startDate - Data inicial
   * @param {Date} options.endDate - Data final
   * @returns {Promise<Array>} Array de eventos
   */
  async searchEvents(options = {}) {
    try {
      const { eventType, eventId, limit = 100, offset = 0, startDate, endDate } = options;

      // Construir a query SQL com condições dinâmicas
      let query = 'SELECT * FROM events WHERE 1=1';
      const params = [];

      if (eventType) {
        query += ' AND event_type = ?';
        params.push(eventType);
      }

      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }

      if (startDate) {
        const startTimestamp = new Date(startDate).getTime();
        query += ' AND event_timestamp >= ?';
        params.push(startTimestamp);
      }

      if (endDate) {
        const endTimestamp = new Date(endDate).getTime();
        query += ' AND event_timestamp <= ?';
        params.push(endTimestamp);
      }

      // Ordenar por timestamp descendente e aplicar limite/offset
      query += ' ORDER BY event_timestamp DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      // Executar a query
      const events = await db.query(query, params);

      // Converter os dados JSON de volta para objetos
      return events.map((event) => ({
        ...JSON.parse(event.event_data),
        _eventType: event.event_type,
        _eventId: event.event_id,
        _timestamp: event.event_timestamp,
        _fromDatabase: true,
      }));
    } catch (error) {
      logger.error('Cache: Erro ao buscar eventos no banco de dados:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Busca grupos no banco de dados
   * @param {Object} options - Opções de busca
   * @param {String} options.subject - Nome do grupo para filtrar
   * @param {Number} options.minParticipants - Número mínimo de participantes
   * @param {Number} options.limit - Número máximo de resultados
   * @param {Number} options.offset - Offset para paginação
   * @returns {Promise<Array>} Array de grupos
   */
  async searchGroups(options = {}) {
    try {
      const { subject, minParticipants, limit = 50, offset = 0 } = options;

      // Construir a query SQL com condições dinâmicas
      let query = 'SELECT * FROM `groups` WHERE 1=1';
      const params = [];

      if (subject) {
        query += ' AND subject LIKE ?';
        params.push(`%${subject}%`);
      }

      if (minParticipants) {
        query += ' AND participant_count >= ?';
        params.push(minParticipants);
      }

      // Ordenar por último acesso e aplicar limite/offset
      query += ' ORDER BY last_updated DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      // Executar a query
      const groups = await db.query(query, params);

      // Converter os dados JSON de volta para objetos
      return groups.map((group) => ({
        ...JSON.parse(group.metadata),
        _fromDatabase: true,
      }));
    } catch (error) {
      logger.error('Cache: Erro ao buscar grupos no banco de dados:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
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
  searchMessages: (...args) => cacheManager.searchMessages(...args),
  searchEvents: (...args) => cacheManager.searchEvents(...args),
  searchGroups: (...args) => cacheManager.searchGroups(...args),
};
