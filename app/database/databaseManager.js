/**
 * OmniZap Database Manager
 *
 * Módulo responsável pelo gerenciamento do banco de dados
 * Substitui o antigo sistema de cache em memória por armazenamento persistente
 *
 * Principais recursos:
 * - Armazenamento de mensagens, eventos, grupos, contatos e chats no MySQL
 * - Manutenção automática de dados antigos
 * - Compatibilidade com APIs do antigo sistema de cache
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const logger = require('../utils/logger/loggerModule');
const { cleanEnv, num, bool } = require('envalid');
const fs = require('fs').promises;
const path = require('path');
const db = require('./mysql');

const env = cleanEnv(process.env, {
  DB_DATA_RETENTION_DAYS: num({
    default: 30,
    desc: 'Número de dias para retenção de dados no banco',
  }),
  DB_CLEANUP_INTERVAL_HOURS: num({
    default: 24,
    desc: 'Intervalo em horas para limpeza automática de dados antigos',
  }),
  DB_ENABLE_AUTO_CLEANUP: bool({
    default: true,
    desc: 'Ativar limpeza automática de dados antigos',
  }),
});

const TEMP_DIR = path.join(process.cwd(), 'temp');
const GROUP_METADATA_FILE = path.join(TEMP_DIR, 'groupMetadata.json');

/**
 * Classe principal do gerenciador de banco de dados
 */
class DatabaseManager {
  constructor() {
    this.initialized = false;
    this.cleanupInterval = null;
    this.init();
  }

  /**
   * Inicializa o gerenciador de dados
   */
  async init() {
    logger.info('🔄 OmniZap Database Manager: Sistema inicializado');
    logger.info('📊 Configurações de banco de dados carregadas das variáveis de ambiente');

    logger.debug(`🔄 Retenção de dados: ${env.DB_DATA_RETENTION_DAYS} dias`);
    logger.debug(`🔄 Intervalo de limpeza: ${env.DB_CLEANUP_INTERVAL_HOURS} horas`);
    logger.debug(`🔄 Limpeza automática: ${env.DB_ENABLE_AUTO_CLEANUP ? 'Ativada' : 'Desativada'}`);

    try {
      logger.info('🔄 OmniZap Database Manager: Inicializando banco de dados MySQL');
      const dbInitialized = await db.initDatabase();

      if (dbInitialized) {
        logger.info('✅ OmniZap Database Manager: Banco de dados MySQL inicializado com sucesso');

        if (env.DB_ENABLE_AUTO_CLEANUP) {
          const cleanupIntervalMs = env.DB_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
          this.cleanupInterval = setInterval(() => this.cleanupOldData(), cleanupIntervalMs);
          logger.info(`🧹 OmniZap Database Manager: Limpeza automática configurada a cada ${env.DB_CLEANUP_INTERVAL_HOURS} horas`);

          this.cleanupOldData();
        }
      } else {
        logger.error('❌ OmniZap Database Manager: Erro na inicialização do MySQL');
        throw new Error('Falha ao inicializar banco de dados MySQL');
      }

      await fs.mkdir(TEMP_DIR, { recursive: true });

      try {
        await fs.access(GROUP_METADATA_FILE);
        logger.info('Database Manager: Arquivo de metadados de grupos encontrado');
      } catch (error) {
        await fs.writeFile(GROUP_METADATA_FILE, JSON.stringify({}, null, 2));
        logger.info('Database Manager: Arquivo de metadados de grupos criado');
      }
    } catch (error) {
      logger.error('Database Manager: Erro ao verificar diretórios e arquivos:', {
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
      logger.error('Database Manager: Erro ao ler arquivo de metadados de grupos:', {
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
      logger.error('Database Manager: Erro ao escrever no arquivo de metadados de grupos:', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Salva uma mensagem no banco de dados (processamento assíncrono)
   */
  async saveMessage(messageInfo) {
    setImmediate(async () => {
      try {
        if (!messageInfo || !messageInfo.key || !messageInfo.key.remoteJid || !messageInfo.key.id) {
          logger.warn('Database Manager: Dados de mensagem inválidos');
          return;
        }

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

        const messageType = messageInfo.message ? Object.keys(messageInfo.message)[0] : 'unknown';

        await db.query(
          `INSERT INTO messages 
          (id, remote_jid, from_me, push_name, timestamp, message_type, message_text, participant, quoted_message_id, raw_data) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
          raw_data = VALUES(raw_data),
          updated_at = CURRENT_TIMESTAMP`,
          [messageInfo.key.id, messageInfo.key.remoteJid, messageInfo.key.fromMe ? 1 : 0, messageInfo.pushName || null, messageInfo.messageTimestamp || Math.floor(Date.now() / 1000), messageType, messageText, messageInfo.key.participant || null, messageInfo.message?.extendedTextMessage?.contextInfo?.stanzaId || null, JSON.stringify(messageInfo)],
        );

        logger.debug(`Database Manager: Mensagem salva no banco de dados (${messageInfo.key.id})`);
      } catch (error) {
        logger.error('Database Manager: Erro ao salvar mensagem:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Salva evento no banco de dados (processamento assíncrono)
   */
  async saveEvent(eventType, eventData, eventId = null) {
    setImmediate(async () => {
      try {
        if (!eventType || !eventData) {
          logger.warn('Database Manager: Dados de evento inválidos');
          return;
        }

        const timestamp = Date.now();
        const generatedId = `${eventType}_${timestamp}_${Math.random().toString(36).substring(2, 10)}`;

        try {
          await db.query(
            `INSERT INTO events 
            (id, event_type, event_id, event_timestamp, event_data) 
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            event_data = VALUES(event_data)`,
            [eventId || generatedId, eventType, eventId, timestamp, JSON.stringify(eventData)],
          );

          logger.debug(`Database Manager: Evento salvo no banco de dados (${eventType})`);
        } catch (dbError) {
          logger.error('Database Manager: Erro ao salvar evento no banco de dados:', {
            error: dbError.message,
            stack: dbError.stack,
          });
        }

        logger.debug(`Database Manager: Evento ${eventType} salvo no banco de dados`);
      } catch (error) {
        logger.error('Database Manager: Erro ao salvar evento:', { error: error.message, stack: error.stack });
      }
    });
  }

  /**
   * Salva metadados de grupo no banco de dados e no arquivo (para compatibilidade)
   */
  async saveGroupMetadata(jid, metadata) {
    try {
      if (!jid || !metadata) {
        logger.warn('Database Manager: Dados de grupo inválidos');
        return;
      }

      const enhancedMetadata = {
        ...metadata,
        _timestamp: Date.now(),
        _jid: jid,
      };

      const allMetadata = await this._readGroupMetadataFile();
      allMetadata[jid] = { ...(allMetadata[jid] || {}), ...enhancedMetadata };
      await this._writeGroupMetadataFile(allMetadata);

      try {
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

        if (metadata.participants && metadata.participants.length > 0) {
          const currentHour = Math.floor(Date.now() / 3600000);
          const lastUpdate = parseInt(metadata._lastParticipantFullUpdate || 0);

          if (currentHour > lastUpdate) {
            enhancedMetadata._lastParticipantFullUpdate = currentHour;
            await this.updateGroupParticipants(jid, metadata.participants);
            logger.info(`Database Manager: Atualização completa de participantes para o grupo ${jid.substring(0, 15)}...`);
          } else {
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

        logger.debug(`Database Manager: Grupo salvo no banco de dados (${jid})`);
      } catch (dbError) {
        logger.error('Database Manager: Erro ao salvar grupo no banco de dados:', {
          error: dbError.message,
          stack: dbError.stack,
        });
      }

      logger.debug(`Database Manager: Grupo salvo em arquivo (${jid.substring(0, 30)}...)`);
    } catch (error) {
      logger.error('Database Manager: Erro ao salvar grupo:', { error: error.message, stack: error.stack });
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

      logger.debug(`Database Manager: Status de participantes atualizados para o grupo ${jid.substring(0, 15)}...`);
    } catch (error) {
      logger.error('Database Manager: Erro ao atualizar participantes do grupo:', {
        error: error.message,
        stack: error.stack,
        groupJid: jid,
      });
    }
  }

  /**
   * Salva contato no banco de dados
   */
  async saveContact(contact) {
    setImmediate(async () => {
      try {
        if (!contact || !contact.id) {
          logger.warn('Database Manager: Dados de contato inválidos');
          return;
        }

        const enhancedContact = {
          ...contact,
          _timestamp: Date.now(),
        };

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
            [contact.id, contact.name || null, contact.notify || null, contact.verify || null, contact.shortName || null, contact.pushName || null, contact.status || null, contact.isBusiness ? 1 : 0, contact.isEnterprise ? 1 : 0, JSON.stringify(enhancedContact), Date.now()],
          );

          logger.debug(`Database Manager: Contato salvo no banco de dados (${contact.id})`);
        } catch (dbError) {
          logger.error('Database Manager: Erro ao salvar contato no banco de dados:', {
            error: dbError.message,
            stack: dbError.stack,
          });
        }

        logger.debug(`Database Manager: Contato salvo (${contact.id.substring(0, 30)}...)`);
      } catch (error) {
        logger.error('Database Manager: Erro ao salvar contato:', {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }

  /**
   * Salva chat no banco de dados
   */
  async saveChat(chat) {
    setImmediate(async () => {
      try {
        if (!chat || !chat.id) {
          logger.warn('Database Manager: Dados de chat inválidos');
          return;
        }

        const enhancedChat = {
          ...chat,
          _timestamp: Date.now(),
        };

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
            [chat.id, chat.name || null, chat.unreadCount || 0, chat.conversationTimestamp || Date.now(), chat.archived ? 1 : 0, chat.pinned ? 1 : 0, chat.mute > 0 ? 1 : 0, chat.id.endsWith('@g.us') ? 1 : 0, JSON.stringify(enhancedChat), Date.now()],
          );

          logger.debug(`Database Manager: Chat salvo no banco de dados (${chat.id})`);
        } catch (dbError) {
          logger.error('Database Manager: Erro ao salvar chat no banco de dados:', {
            error: dbError.message,
            stack: dbError.stack,
          });
        }

        logger.debug(`Database Manager: Chat salvo (${chat.id.substring(0, 30)}...)`);
      } catch (error) {
        logger.error('Database Manager: Erro ao salvar chat:', { error: error.message, stack: error.stack });
      }
    });
  }

  /**
   * Recupera mensagem do banco de dados
   */
  async getMessage(key) {
    try {
      if (!key || !key.remoteJid || !key.id) {
        return undefined;
      }

      const results = await db.query('SELECT * FROM messages WHERE id = ? AND remote_jid = ?', [key.id, key.remoteJid]);

      if (results && results.length > 0) {
        logger.debug(`Database Manager: Mensagem recuperada do banco de dados (${key.id})`);

        try {
          const rawData = results[0].raw_data;
          if (rawData) {
            const messageData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
            return messageData;
          }
        } catch (parseError) {
          logger.error('Database Manager: Erro ao converter dados da mensagem:', {
            error: parseError.message,
          });
        }
      }

      return undefined;
    } catch (error) {
      logger.error('Database Manager: Erro ao recuperar mensagem:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Recupera metadados de grupo do banco de dados e do arquivo para compatibilidade
   */
  async getGroupMetadata(jid) {
    try {
      if (!jid) {
        return undefined;
      }

      const results = await db.query('SELECT * FROM `groups` WHERE jid = ?', [jid]);

      if (results && results.length > 0) {
        logger.debug(`Database Manager: Grupo recuperado do banco de dados (${jid.substring(0, 30)}...)`);

        try {
          const metadataStr = results[0].metadata;
          if (metadataStr) {
            const metadata = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
            return {
              ...metadata,
              _timestamp: results[0].last_updated,
              _fromDatabase: true,
            };
          }
        } catch (parseError) {
          logger.error('Database Manager: Erro ao converter dados do grupo:', {
            error: parseError.message,
          });
        }
      }

      const allMetadata = await this._readGroupMetadataFile();
      const cachedGroup = allMetadata[jid];

      if (cachedGroup) {
        logger.debug(`Database Manager: Grupo recuperado do arquivo (${jid.substring(0, 30)}...)`);
        return cachedGroup;
      }

      return undefined;
    } catch (error) {
      logger.error('Database Manager: Erro ao recuperar grupo:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Busca metadados de grupo com lógica de atualização automática
   * Se não estiver no banco ou estiver expirado, busca do cliente WhatsApp
   *
   * @param {String} groupJid - JID do grupo
   * @param {Object} omniZapClient - Cliente WhatsApp para buscar metadados
   * @returns {Promise<Object|null>} Metadados do grupo ou null em caso de erro
   */
  async getOrFetchGroupMetadata(groupJid, omniZapClient) {
    try {
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        logger.warn('Database Manager: JID de grupo inválido');
        return null;
      }

      if (!omniZapClient) {
        logger.warn('Database Manager: Cliente WhatsApp não fornecido');
        return null;
      }

      const cachedMetadata = await this.getGroupMetadata(groupJid);

      if (cachedMetadata) {
        const dataAge = Date.now() - (cachedMetadata._timestamp || 0);
        const maxAge = 30 * 60 * 1000;

        if (dataAge < maxAge) {
          logger.debug(`Database Manager: Metadados de grupo válidos (idade: ${Math.round(dataAge / 60000)}min)`);
          return cachedMetadata;
        } else {
          logger.warn(`Database Manager: Metadados de grupo expirados (idade: ${Math.round(dataAge / 60000)}min)`);
        }
      }

      logger.info(`Database Manager: Buscando metadados do grupo ${groupJid.substring(0, 30)}... do cliente WhatsApp`);

      const freshMetadata = await omniZapClient.groupMetadata(groupJid);

      if (freshMetadata) {
        const enhancedMetadata = {
          ...freshMetadata,
          _timestamp: Date.now(),
          _fetchedFromClient: true,
          _participantCount: freshMetadata.participants?.length || 0,
        };

        await this.saveGroupMetadata(groupJid, enhancedMetadata);

        logger.info(`Database Manager: Metadados de grupo "${freshMetadata.subject}" salvos (${enhancedMetadata._participantCount} participantes)`);

        return enhancedMetadata;
      } else {
        logger.warn('Database Manager: Não foi possível obter metadados do grupo');
        return null;
      }
    } catch (error) {
      logger.error('Database Manager: Erro ao buscar metadados de grupo:', {
        error: error.message,
        stack: error.stack,
      });
      const fallbackMetadata = await this.getGroupMetadata(groupJid);
      if (fallbackMetadata) {
        logger.warn('Database Manager: Usando metadados expirados como fallback');
        return fallbackMetadata;
      }

      return null;
    }
  }

  /**
   * Recupera contato do banco de dados
   */
  async getContact(contactId) {
    try {
      if (!contactId) {
        return undefined;
      }

      const results = await db.query('SELECT * FROM contacts WHERE jid = ?', [contactId]);

      if (results && results.length > 0) {
        logger.debug(`Database Manager: Contato recuperado do banco de dados (${contactId.substring(0, 30)}...)`);

        try {
          const metadataStr = results[0].metadata;
          if (metadataStr) {
            const contactData = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
            return {
              ...contactData,
              _timestamp: results[0].last_updated,
              _fromDatabase: true,
            };
          }
        } catch (parseError) {
          logger.error('Database Manager: Erro ao converter dados do contato:', {
            error: parseError.message,
          });
        }
      }

      return undefined;
    } catch (error) {
      logger.error('Database Manager: Erro ao recuperar contato:', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Recupera chat do banco de dados
   */
  async getChat(chatId) {
    try {
      if (!chatId) {
        return undefined;
      }

      const results = await db.query('SELECT * FROM chats WHERE jid = ?', [chatId]);

      if (results && results.length > 0) {
        logger.debug(`Database Manager: Chat recuperado do banco de dados (${chatId.substring(0, 30)}...)`);

        try {
          const metadataStr = results[0].metadata;
          if (metadataStr) {
            const chatData = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
            return {
              ...chatData,
              _timestamp: results[0].last_updated,
              _fromDatabase: true,
            };
          }
        } catch (parseError) {
          logger.error('Database Manager: Erro ao converter dados do chat:', {
            error: parseError.message,
          });
        }
      }

      return undefined;
    } catch (error) {
      logger.error('Database Manager: Erro ao recuperar chat:', { error: error.message, stack: error.stack });
      return undefined;
    }
  }

  /**
   * Verifica se metadados de grupo existem no banco de dados e se são válidos
   *
   * @param {String} groupJid - JID do grupo
   * @returns {Promise<Boolean>} True se existir e for válido, false caso contrário
   */
  async hasValidGroupMetadata(groupJid) {
    try {
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        return false;
      }

      const results = await db.query('SELECT last_updated FROM `groups` WHERE jid = ?', [groupJid]);

      if (!results || results.length === 0) {
        return false;
      }

      const dataAge = Date.now() - (results[0].last_updated || 0);
      const maxAge = 30 * 60 * 1000;

      return dataAge < maxAge;
    } catch (error) {
      logger.error('Database Manager: Erro ao verificar grupo no banco de dados:', {
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

    logger.info(`Database Manager: Pré-carregando metadados de ${groupJids.length} grupos`);

    const promises = groupJids
      .filter((jid) => jid && jid.endsWith('@g.us'))
      .map(async (groupJid) => {
        try {
          if (!(await this.hasValidGroupMetadata(groupJid))) {
            await this.getOrFetchGroupMetadata(groupJid, omniZapClient);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          logger.error(`Database Manager: Erro ao pré-carregar grupo ${groupJid}:`, {
            error: error.message,
            stack: error.stack,
          });
        }
      });

    await Promise.allSettled(promises);
    logger.info('Database Manager: Pré-carregamento de grupos concluído');
  }
  async listGroups() {
    try {
      const results = await db.query('SELECT * FROM `groups`');

      const groups = results.map((group) => {
        try {
          const metadata = typeof group.metadata === 'string' ? JSON.parse(group.metadata) : group.metadata;

          return {
            ...metadata,
            jid: group.jid,
            subject: group.subject,
            _timestamp: group.last_updated,
            _fromDatabase: true,
          };
        } catch (parseError) {
          logger.error('Database Manager: Erro ao converter metadados do grupo:', {
            error: parseError.message,
            groupJid: group.jid,
          });
          return {
            jid: group.jid,
            subject: group.subject,
            _error: true,
          };
        }
      });

      logger.info(`Database Manager: ${groups.length} grupos listados do banco de dados`);

      if (groups.length === 0) {
        const allMetadata = await this._readGroupMetadataFile();
        const fileGroups = Object.values(allMetadata);
        logger.info(`Database Manager: ${fileGroups.length} grupos listados do arquivo (fallback)`);
        return fileGroups;
      }

      return groups;
    } catch (error) {
      logger.error('Database Manager: Erro ao listar grupos:', {
        error: error.message,
        stack: error.stack,
      });

      try {
        const allMetadata = await this._readGroupMetadataFile();
        const groups = Object.values(allMetadata);
        logger.info(`Database Manager: ${groups.length} grupos listados do arquivo (fallback após erro)`);
        return groups;
      } catch (fileError) {
        return [];
      }
    }
  }

  /**
   * Lista todos os contatos no banco de dados
   */
  async listContacts() {
    try {
      const results = await db.query('SELECT * FROM contacts');

      const contacts = results.map((contact) => {
        try {
          const contactData = typeof contact.metadata === 'string' ? JSON.parse(contact.metadata) : contact.metadata;

          return {
            ...contactData,
            jid: contact.jid,
            name: contact.name,
            pushName: contact.push_name,
            _timestamp: contact.last_updated,
            _fromDatabase: true,
          };
        } catch (parseError) {
          logger.error('Database Manager: Erro ao converter dados do contato:', {
            error: parseError.message,
            contactJid: contact.jid,
          });
          return {
            jid: contact.jid,
            name: contact.name,
            pushName: contact.push_name,
            _error: true,
          };
        }
      });

      logger.info(`Database Manager: ${contacts.length} contatos listados do banco de dados`);
      return contacts;
    } catch (error) {
      logger.error('Database Manager: Erro ao listar contatos:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Lista todos os chats no banco de dados
   */
  async listChats() {
    try {
      const results = await db.query('SELECT * FROM chats');

      const chats = results.map((chat) => {
        try {
          const chatData = typeof chat.metadata === 'string' ? JSON.parse(chat.metadata) : chat.metadata;

          return {
            ...chatData,
            id: chat.jid,
            name: chat.name,
            unreadCount: chat.unread_count,
            isGroup: chat.is_group === 1,
            _timestamp: chat.last_updated,
            _fromDatabase: true,
          };
        } catch (parseError) {
          logger.error('Database Manager: Erro ao converter dados do chat:', {
            error: parseError.message,
            chatJid: chat.jid,
          });
          return {
            id: chat.jid,
            name: chat.name,
            unreadCount: chat.unread_count,
            isGroup: chat.is_group === 1,
            _error: true,
          };
        }
      });

      logger.info(`Database Manager: ${chats.length} chats listados do banco de dados`);
      return chats;
    } catch (error) {
      logger.error('Database Manager: Erro ao listar chats:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Obtém estatísticas do banco de dados
   */
  async getStats() {
    try {
      const messagesCount = await db.query('SELECT COUNT(*) as count FROM messages');
      const eventsCount = await db.query('SELECT COUNT(*) as count FROM events');
      const groupsCount = await db.query('SELECT COUNT(*) as count FROM `groups`');
      const contactsCount = await db.query('SELECT COUNT(*) as count FROM contacts');
      const chatsCount = await db.query('SELECT COUNT(*) as count FROM chats');
      const participantsCount = await db.query('SELECT COUNT(*) as count FROM group_participants');

      const tableStats = await db.query(`
        SELECT 
          table_name AS 'table',
          round(((data_length + index_length) / 1024 / 1024), 2) AS 'size_mb'
        FROM information_schema.TABLES
        WHERE table_schema = DATABASE()
        ORDER BY (data_length + index_length) DESC
      `);

      const oldestGroup = await db.query('SELECT jid, subject, creation_timestamp FROM `groups` ORDER BY creation_timestamp ASC LIMIT 1');
      const newestGroup = await db.query('SELECT jid, subject, last_updated FROM `groups` ORDER BY last_updated DESC LIMIT 1');

      const messageTypes = await db.query('SELECT message_type, COUNT(*) as count FROM messages GROUP BY message_type ORDER BY count DESC');

      const eventTypes = await db.query('SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC');

      let fileGroupsCount = 0;
      try {
        const allMetadata = await this._readGroupMetadataFile();
        fileGroupsCount = Object.keys(allMetadata).length;
      } catch (error) {
        logger.error('Database Manager: Erro ao ler estatísticas de grupos do arquivo:', {
          error: error.message,
        });
      }

      return {
        messages: {
          count: messagesCount[0]?.count || 0,
          types: messageTypes,
        },
        events: {
          count: eventsCount[0]?.count || 0,
          types: eventTypes,
        },
        groups: {
          count: groupsCount[0]?.count || 0,
          participants: participantsCount[0]?.count || 0,
          fileCount: fileGroupsCount,
          oldest: oldestGroup[0] || null,
          newest: newestGroup[0] || null,
        },
        contacts: {
          count: contactsCount[0]?.count || 0,
        },
        chats: {
          count: chatsCount[0]?.count || 0,
        },
        database: {
          tables: tableStats,
          totalSizeMB: tableStats.reduce((acc, table) => acc + (parseFloat(table.size_mb) || 0), 0).toFixed(2),
        },
        totals: {
          records: (messagesCount[0]?.count || 0) + (eventsCount[0]?.count || 0) + (groupsCount[0]?.count || 0) + (contactsCount[0]?.count || 0) + (chatsCount[0]?.count || 0) + (participantsCount[0]?.count || 0),
        },
      };
    } catch (error) {
      logger.error('Database Manager: Erro ao obter estatísticas:', {
        error: error.message,
        stack: error.stack,
      });
      return null;
    }
  }

  /**
   * Limpa dados antigos do banco de dados
   */
  async cleanupOldData() {
    try {
      logger.info('🧹 OmniZap Database Manager: Iniciando limpeza de dados antigos');

      const retentionDays = env.DB_DATA_RETENTION_DAYS;
      const retentionTimestamp = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      const deletedMessages = await db.query('DELETE FROM messages WHERE timestamp < ?', [Math.floor(retentionTimestamp / 1000)]);

      const deletedEvents = await db.query('DELETE FROM events WHERE event_timestamp < ?', [retentionTimestamp]);

      logger.info(`🧹 OmniZap Database Manager: Limpeza concluída. Removidos ${deletedMessages.affectedRows || 0} mensagens e ${deletedEvents.affectedRows || 0} eventos com mais de ${retentionDays} dias`);
    } catch (error) {
      logger.error('❌ OmniZap Database Manager: Erro ao limpar dados antigos:', {
        error: error.message,
        stack: error.stack,
      });
    }
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

      query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const messages = await db.query(query, params);

      return messages.map((msg) => ({
        ...JSON.parse(msg.raw_data),
        _fromDatabase: true,
      }));
    } catch (error) {
      logger.error('Database Manager: Erro ao buscar mensagens no banco de dados:', {
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

      query += ' ORDER BY event_timestamp DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const events = await db.query(query, params);

      return events.map((event) => ({
        ...JSON.parse(event.event_data),
        _eventType: event.event_type,
        _eventId: event.event_id,
        _timestamp: event.event_timestamp,
        _fromDatabase: true,
      }));
    } catch (error) {
      logger.error('Database Manager: Erro ao buscar eventos no banco de dados:', {
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

      query += ' ORDER BY last_updated DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const groups = await db.query(query, params);

      return groups.map((group) => ({
        ...JSON.parse(group.metadata),
        _fromDatabase: true,
      }));
    } catch (error) {
      logger.error('Database Manager: Erro ao buscar grupos no banco de dados:', {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }
}

const databaseManager = new DatabaseManager();

module.exports = {
  databaseManager,
  GROUP_METADATA_FILE,
  searchMessages: (...args) => databaseManager.searchMessages(...args),
  searchEvents: (...args) => databaseManager.searchEvents(...args),
  searchGroups: (...args) => databaseManager.searchGroups(...args),
};
