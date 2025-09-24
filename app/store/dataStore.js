const logger = require('../utils/logger/loggerModule');
const { findAll, upsert, create } = require('../../database/queries');

/**
 * Realiza o parse seguro de JSON com logging de erros
 * @param {string} json String JSON para fazer parse
 * @param {string} context Contexto para logging (ex: ID do chat/grupo)
 * @param {any} fallback Valor padrão caso o parse falhe
 * @returns {any} Objeto parseado ou fallback
 */
const safeJSONParse = (json, context, fallback) => {
  try {
    return JSON.parse(json);
  } catch (e) {
    logger.warn(`JSON inválido encontrado para ${context}:`, e.message);
    return fallback;
  }
};

const store = {
  chats: [],
  groups: {},

  /**
   * Carrega dados essenciais (chats e grupos) do MySQL para o cache em memória ao iniciar.
   */
  async loadData() {
    try {
      logger.info('Carregando dados do MySQL para o cache em memória...');

      const [chats, groups] = await Promise.all([findAll('chats'), findAll('groups_metadata')]);

      this.chats = chats.map((chat) => {
        chat.raw_chat = safeJSONParse(chat.raw_chat, `chat ${chat.id}`, null);
        return chat;
      });
      logger.info(`${this.chats.length} chats carregados para o cache.`);
      this.groups = groups.reduce((acc, group) => {
        group.participants = safeJSONParse(group.participants, `grupo ${group.id}`, []);
        acc[group.id] = group;
        return acc;
      }, {});
      logger.info(`${Object.keys(this.groups).length} grupos carregados para o cache.`);
    } catch (error) {
      logger.error('Erro catastrófico ao carregar dados do MySQL para o store:', error);
      process.exit(1);
    }
  },

  /**
   * Vincula o store aos eventos do cliente de WhatsApp (ev).
   * Atualiza o cache e salva as alterações diretamente no banco de dados.
   */
  bind: function (ev) {
    ev.on('messages.upsert', ({ messages: incomingMessages, type }) => {
      if (type === 'append' || type === 'notify') {
        const dbQueries = require('../../database/queries');

        for (const msg of incomingMessages) {
          if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

          const messageData = {
            message_id: msg.key.id,
            chat_id: msg.key.remoteJid,
            sender_id: msg.key.participant || msg.key.remoteJid,
            content: msg.message.conversation || msg.message.extendedTextMessage?.text || null,
            raw_message: JSON.stringify(msg || {}),
            timestamp: new Date(Number(msg.messageTimestamp) * 1000),
          };

          dbQueries.create('messages', messageData).catch((err) => {
            if (err.code !== 'ER_DUP_ENTRY') {
              logger.error(`Erro ao salvar mensagem ${msg.key.id} no banco de dados:`, err);
            }
          });
        }
      }
    });

    ev.on('chats.upsert', (newChats) => {
      for (const chat of newChats) {
        const chatDataForDb = {
          id: chat.id,
          name: chat.name || chat.id,
          raw_chat: JSON.stringify(chat),
        };

        const chatForCache = { ...chat };
        delete chatForCache.messages;
        const existingChatIndex = this.chats.findIndex((c) => c.id === chat.id);
        if (existingChatIndex !== -1) {
          Object.assign(this.chats[existingChatIndex], chatForCache);
        } else {
          this.chats.push(chatForCache);
        }
        upsert('chats', chatDataForDb).catch((err) => logger.error('Erro no upsert do chat:', err));
      }
    });

    ev.on('chats.update', (updates) => {
      for (const update of updates) {
        const existingChatIndex = this.chats.findIndex((c) => c.id === update.id);
        if (existingChatIndex !== -1) {
          Object.assign(this.chats[existingChatIndex], update);
          delete this.chats[existingChatIndex].messages;
        }

        const chatDataForDb = {
          id: update.id,
          name: update.name || update.id,
          raw_chat: JSON.stringify(this.chats.find((c) => c.id === update.id) || update || {}),
        };
        upsert('chats', chatDataForDb).catch((err) => logger.error('Erro no upsert do chat (update):', err));
      }
    });

    ev.on('chats.delete', (deletions) => {
      this.chats = this.chats.filter((c) => !deletions.includes(c.id));
    });

    ev.on('groups.upsert', (newGroups) => {
      for (const group of newGroups) {
        this.groups[group.id] = group;

        const groupDataForDb = {
          id: group.id,
          subject: group.subject,
          owner_jid: group.owner,
          creation: group.creation,
          description: group.desc,
          participants: JSON.stringify(group.participants || []),
        };
        upsert('groups_metadata', groupDataForDb).catch((err) => logger.error('Erro no upsert do grupo:', err));
      }
    });

    ev.on('groups.update', (updates) => {
      for (const update of updates) {
        if (this.groups[update.id]) {
          Object.assign(this.groups[update.id], update);
        } else {
          this.groups[update.id] = update;
        }

        const groupToSave = this.groups[update.id];
        const groupDataForDb = {
          id: groupToSave.id,
          subject: groupToSave.subject,
          owner_jid: groupToSave.owner,
          creation: groupToSave.creation,
          description: groupToSave.desc,
          participants: JSON.stringify(groupToSave.participants || []),
        };
        upsert('groups_metadata', groupDataForDb).catch((err) => logger.error('Erro no upsert do grupo (update):', err));
      }
    });
  },
};

module.exports = store;
