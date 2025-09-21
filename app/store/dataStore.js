const logger = require('../utils/logger/loggerModule');
const { findAll, upsert, create } = require('../../database/queries');

// O store agora atua como um cache em memória para dados frequentemente acessados.
// A fonte da verdade é o banco de dados MySQL.
const store = {
  chats: [],
  groups: {},
  // As mensagens não são mais armazenadas em memória para evitar consumo excessivo.
  // Elas são salvas diretamente no banco de dados.

  /**
   * Carrega dados essenciais (chats e grupos) do MySQL para o cache em memória ao iniciar.
   */
  async loadData() {
    try {
      logger.info('Carregando dados do MySQL para o cache em memória...');

      const [chats, groups] = await Promise.all([
        findAll('chats'),
        findAll('groups_metadata')
      ]);

      // Popula o cache de chats
      this.chats = chats.map(chat => {
        try {
          chat.raw_chat = JSON.parse(chat.raw_chat);
        } catch (e) { /* Ignora erro se o JSON for inválido ou nulo */ }
        return chat;
      });
      logger.info(`${this.chats.length} chats carregados para o cache.`);

      // Popula o cache de grupos, transformando o array em um mapa por ID
      this.groups = groups.reduce((acc, group) => {
        // O campo `participants` e `raw_chat` vem como string do DB, precisamos fazer o parse.
        try {
          group.participants = JSON.parse(group.participants);
        } catch (e) { /* Ignora erro se o JSON for inválido ou nulo */ }
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
            raw_message: JSON.stringify(msg),
            timestamp: new Date(Number(msg.messageTimestamp) * 1000),
          };

          // Salva a mensagem no banco de dados, sem cache em memória.
          dbQueries.create('messages', messageData)
            .catch(err => {
              if (err.code !== 'ER_DUP_ENTRY') {
                logger.error(`Erro ao salvar mensagem ${msg.key.id} no banco de dados:`, err);
              }
            });
        }
      }
    });

    ev.on('chats.upsert', (newChats) => {
      for (const chat of newChats) {
        // Construir o objeto para o banco de dados explicitamente,
        // pegando apenas as colunas que existem na tabela 'chats'.
        const chatDataForDb = {
          id: chat.id,
          name: chat.name || chat.id,
          raw_chat: JSON.stringify(chat)
        };

        // Atualizar o cache em memória
        const chatForCache = { ...chat };
        delete chatForCache.messages; // Remover a propriedade 'messages' do objeto de cache
        const existingChatIndex = this.chats.findIndex(c => c.id === chat.id);
        if (existingChatIndex !== -1) {
          Object.assign(this.chats[existingChatIndex], chatForCache);
        } else {
          this.chats.push(chatForCache);
        }

        // Realizar o upsert no banco de dados
        upsert('chats', chatDataForDb).catch(err => logger.error('Erro no upsert do chat:', err));
      }
    });

    ev.on('chats.update', (updates) => {
      for (const update of updates) {
        // Atualizar o cache em memória
        const existingChatIndex = this.chats.findIndex(c => c.id === update.id);
        if (existingChatIndex !== -1) {
          Object.assign(this.chats[existingChatIndex], update);
          delete this.chats[existingChatIndex].messages; // Garantir que 'messages' seja removido do cache
        }

        // Construir o objeto para o banco de dados explicitamente
        const chatDataForDb = {
          id: update.id,
          name: update.name || update.id,
          raw_chat: JSON.stringify(this.chats.find(c => c.id === update.id) || update) // Usar cache atualizado ou update bruto
        };

        // Realizar o upsert no banco de dados
        upsert('chats', chatDataForDb).catch(err => logger.error('Erro no upsert do chat (update):', err));
      }
    });

    ev.on('chats.delete', (deletions) => {
      this.chats = this.chats.filter((c) => !deletions.includes(c.id));
      // Lógica para deletar ou marcar como deletado no DB pode ser adicionada aqui.
    });

    ev.on('groups.upsert', (newGroups) => {
      for (const group of newGroups) {
        // Atualizar o cache em memória
        this.groups[group.id] = group;

        // Construir o objeto para o banco de dados explicitamente
        const groupDataForDb = {
          id: group.id,
          subject: group.subject,
          owner_jid: group.owner,
          creation: group.creation,
          description: group.desc,
          participants: JSON.stringify(group.participants || [])
        };
        upsert('groups_metadata', groupDataForDb).catch(err => logger.error('Erro no upsert do grupo:', err));
      }
    });

    ev.on('groups.update', (updates) => {
      for (const update of updates) {
        // Atualizar o cache em memória
        if (this.groups[update.id]) {
          Object.assign(this.groups[update.id], update);
        } else {
          this.groups[update.id] = update;
        }

        // Construir o objeto para o banco de dados explicitamente
        const groupToSave = this.groups[update.id];
        const groupDataForDb = {
          id: groupToSave.id,
          subject: groupToSave.subject,
          owner_jid: groupToSave.owner,
          creation: groupToSave.creation,
          description: groupToSave.desc,
          participants: JSON.stringify(groupToSave.participants || [])
        };
        upsert('groups_metadata', groupDataForDb).catch(err => logger.error('Erro no upsert do grupo (update):', err));
      }
    });
  },
};

module.exports = store;
