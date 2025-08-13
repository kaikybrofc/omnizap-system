const { readFromFile, writeToFile } = require('./persistence');
const logger = require('../utils/logger/loggerModule');

const writeBuffer = {
  size: 0,
  maxSize: 1 * 1024 * 1024,
  data: {},
  flushTimeout: null,
};

function ensureDataType(data, expectedType) {
  if (expectedType === 'array') {
    return Array.isArray(data) ? data : [];
  }
  if (expectedType === 'object') {
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }
  return data;
}

const store = {
  chats: [],
  contacts: {},
  messages: {},
  rawMessages: {},
  groups: {},
  blocklist: [],
  labels: {},
  presences: {},
  calls: [],
  newsletters: {},

  async loadData() {
    try {
      const typeDefinitions = {
        chats: 'array',
        contacts: 'object',
        messages: 'object',
        rawMessages: 'object',
        groups: 'object',
        blocklist: 'array',
        labels: 'object',
        presences: 'object',
        calls: 'array',
        newsletters: 'object',
      };

      const loadPromises = Object.entries(typeDefinitions).map(async ([type, expectedType]) => {
        try {
          const data = await readFromFile(type, expectedType);
          this[type] = ensureDataType(data, expectedType);
          logger.info(`Dados para ${type} carregados.`);
        } catch (loadError) {
          logger.error(`Erro ao carregar dados para ${type}:`, loadError);
          this[type] = expectedType === 'array' ? [] : {};
        }
      });

      await Promise.all(loadPromises);

      logger.info('Todos os dados do store foram carregados com sucesso.');
    } catch (error) {
      logger.error('Erro catastrófico ao carregar dados do store:', error);
      this.chats = [];
      this.contacts = {};
      this.messages = {};
      this.rawMessages = {};
      this.groups = {};
      this.blocklist = [];
      this.labels = {};
      this.presences = {};
      this.calls = [];
      this.newsletters = {};
    }
  },

  bufferWrite: function (dataType, data) {
    writeBuffer.data[dataType] = data;
    writeBuffer.size += JSON.stringify(data).length;

    if (writeBuffer.size >= writeBuffer.maxSize) {
      this.flushBuffer();
    }

    if (!writeBuffer.flushTimeout) {
      writeBuffer.flushTimeout = setTimeout(() => this.flushBuffer(), 1000);
    }
  },

  flushBuffer: async function () {
    if (writeBuffer.flushTimeout) {
      clearTimeout(writeBuffer.flushTimeout);
      writeBuffer.flushTimeout = null;
    }

    const dataToWrite = { ...writeBuffer.data };
    writeBuffer.data = {};
    writeBuffer.size = 0;

    const writePromises = Object.entries(dataToWrite).map(async ([dataType, data]) => {
      try {
        await writeToFile(dataType, data);
      } catch (error) {
        logger.error(`Erro ao fazer flush do buffer para ${dataType}:`, error);
      }
    });

    await Promise.all(writePromises);
  },

  debouncedWrites: {},
  debouncedWrite: function (dataType, delay = 1000) {
    if (this.debouncedWrites[dataType]) {
      clearTimeout(this.debouncedWrites[dataType]);
    }
    this.debouncedWrites[dataType] = setTimeout(() => {
      this.bufferWrite(dataType, this[dataType]);
      delete this.debouncedWrites[dataType];
    }, delay);
  },

  /**
   * Salva mensagens raw recebidas no armazenamento.
   * @param {Array<object>} incomingMessages - Array de mensagens raw a serem salvas.
   */
  saveIncomingRawMessages: function (incomingMessages) {
    for (const msg of incomingMessages) {
      if (!this.rawMessages[msg.key.remoteJid]) {
        this.rawMessages[msg.key.remoteJid] = [];
      }
      this.rawMessages[msg.key.remoteJid].push(msg);
    }
    this.debouncedWrite('rawMessages');
  },

  bind: function (ev) {
    ev.on('messages.upsert', ({ messages: incomingMessages, type }) => {
      if (type === 'append') {
        for (const msg of incomingMessages) {
          if (!this.messages[msg.key.remoteJid]) {
            this.messages[msg.key.remoteJid] = [];
          }
          this.messages[msg.key.remoteJid].push(msg);
        }
        this.debouncedWrite('messages');
      }
    });
    ev.on('messages.delete', (item) => {
      if ('all' in item) {
        this.messages[item.jid] = [];
        this.rawMessages[item.jid] = [];
      } else {
        for (const { key } of item.keys) {
          if (this.messages[key.remoteJid]) {
            this.messages[key.remoteJid] = this.messages[key.remoteJid].filter(
              (msg) => msg.key.id !== key.id,
            );
          }
          if (this.rawMessages[key.remoteJid]) {
            this.rawMessages[key.remoteJid] = this.rawMessages[key.remoteJid].filter(
              (msg) => msg.key.id !== key.id,
            );
          }
        }
      }
      this.debouncedWrite('messages');
      this.debouncedWrite('rawMessages');
    });
    ev.on('messages.update', (updates) => {
      for (const update of updates) {
        if (this.messages[update.key.remoteJid]) {
          const idx = this.messages[update.key.remoteJid].findIndex(
            (msg) => msg.key.id === update.key.id,
          );
          if (idx !== -1) {
            Object.assign(this.messages[update.key.remoteJid][idx], update);
          }
        }
        if (this.rawMessages[update.key.remoteJid]) {
          const idx = this.rawMessages[update.key.remoteJid].findIndex(
            (msg) => msg.key.id === update.key.id,
          );
          if (idx !== -1) {
            Object.assign(this.rawMessages[update.key.remoteJid][idx], update);
          }
        }
      }
      this.debouncedWrite('messages');
      this.debouncedWrite('rawMessages');
    });
    ev.on('messages.media-update', (updates) => {
      for (const update of updates) {
        if (this.messages[update.key.remoteJid]) {
          const idx = this.messages[update.key.remoteJid].findIndex(
            (msg) => msg.key.id === update.key.id,
          );
          if (idx !== -1) {
            Object.assign(this.messages[update.key.remoteJid][idx], {
              media: update.media,
            });
          }
        }
        if (this.rawMessages[update.key.remoteJid]) {
          const idx = this.rawMessages[update.key.remoteJid].findIndex(
            (msg) => msg.key.id === update.key.id,
          );
          if (idx !== -1) {
            Object.assign(this.rawMessages[update.key.remoteJid][idx], {
              media: update.media,
            });
          }
        }
      }
      this.debouncedWrite('messages');
      this.debouncedWrite('rawMessages');
    });
    ev.on('messages.reaction', (reactions) => {
      for (const { key, reaction } of reactions) {
        if (this.messages[key.remoteJid]) {
          const idx = this.messages[key.remoteJid].findIndex((msg) => msg.key.id === key.id);
          if (idx !== -1) {
            const message = this.messages[key.remoteJid][idx];
            if (!message.reactions) {
              message.reactions = [];
            }
            const existingReactionIdx = message.reactions.findIndex(
              (r) => r.key.id === reaction.key.id,
            );
            if (existingReactionIdx !== -1) {
              if (reaction.text) {
                Object.assign(message.reactions[existingReactionIdx], reaction);
              } else {
                message.reactions.splice(existingReactionIdx, 1);
              }
            } else if (reaction.text) {
              message.reactions.push(reaction);
            }
          }
        }
        if (this.rawMessages[key.remoteJid]) {
          const idx = this.rawMessages[key.remoteJid].findIndex((msg) => msg.key.id === key.id);
          if (idx !== -1) {
            const message = this.rawMessages[key.remoteJid][idx];
            if (!message.reactions) {
              message.reactions = [];
            }
            const existingReactionIdx = message.reactions.findIndex(
              (r) => r.key.id === reaction.key.id,
            );
            if (existingReactionIdx !== -1) {
              if (reaction.text) {
                Object.assign(message.reactions[existingReactionIdx], reaction);
              } else {
                message.reactions.splice(existingReactionIdx, 1);
              }
            } else if (reaction.text) {
              message.reactions.push(reaction);
            }
          }
        }
      }
      this.debouncedWrite('messages');
      this.debouncedWrite('rawMessages');
    });
    ev.on('message-receipt.update', (updates) => {
      for (const { key, receipt } of updates) {
        if (this.messages[key.remoteJid]) {
          const idx = this.messages[key.remoteJid].findIndex((msg) => msg.key.id === key.id);
          if (idx !== -1) {
            const message = this.messages[key.remoteJid][idx];
            if (!message.userReceipt) {
              message.userReceipt = [];
            }
            const existingReceiptIdx = message.userReceipt.findIndex(
              (r) => r.userJid === receipt.userJid,
            );
            if (existingReceiptIdx !== -1) {
              Object.assign(message.userReceipt[existingReceiptIdx], receipt);
            } else {
              message.userReceipt.push(receipt);
            }
          }
        }
        if (this.rawMessages[key.remoteJid]) {
          const idx = this.rawMessages[key.remoteJid].findIndex((msg) => msg.key.id === key.id);
          if (idx !== -1) {
            const message = this.rawMessages[key.remoteJid][idx];
            if (!message.userReceipt) {
              message.userReceipt = [];
            }
            const existingReceiptIdx = message.userReceipt.findIndex(
              (r) => r.userJid === receipt.userJid,
            );
            if (existingReceiptIdx !== -1) {
              Object.assign(message.userReceipt[existingReceiptIdx], receipt);
            } else {
              message.userReceipt.push(receipt);
            }
          }
        }
      }
      this.debouncedWrite('messages');
      this.debouncedWrite('rawMessages');
    });
    ev.on('groups.upsert', (newGroups) => {
      for (const group of newGroups) {
        this.groups[group.id] = group;
      }
      this.debouncedWrite('groups');
    });
    ev.on('groups.update', (updates) => {
      for (const update of updates) {
        if (this.groups[update.id]) {
          Object.assign(this.groups[update.id], update);
        } else {
          this.groups[update.id] = update;
        }
      }
      this.debouncedWrite('groups');
    });
    ev.on('group-participants.update', ({ id, participants, action }) => {
      if (this.groups[id]) {
        if (!Array.isArray(this.groups[id].participants)) {
          this.groups[id].participants = [];
        }
        if (action === 'add') {
          for (const participantJid of participants) {
            if (!this.groups[id].participants.some((p) => p.id === participantJid)) {
              this.groups[id].participants.push({ id: participantJid });
            }
          }
        } else if (action === 'remove') {
          this.groups[id].participants = this.groups[id].participants.filter(
            (p) => !participants.includes(p.id),
          );
        } else if (action === 'promote' || action === 'demote') {
          for (const participantJid of participants) {
            const participantObj = this.groups[id].participants.find(
              (p) => p.id === participantJid,
            );
            if (participantObj) {
              participantObj.admin = action === 'promote' ? 'admin' : null;
            }
          }
        }
      }
      this.debouncedWrite('groups');
    });
    ev.on('group.join-request', (update) => {
      logger.info('Group join request:', update);
    });
    ev.on('blocklist.set', ({ blocklist }) => {
      this.blocklist = blocklist;
      this.debouncedWrite('blocklist');
    });
    ev.on('blocklist.update', ({ blocklist, type }) => {
      if (type === 'add') {
        this.blocklist.push(...blocklist);
      } else if (type === 'remove') {
        this.blocklist = this.blocklist.filter((jid) => !blocklist.includes(jid));
      }
      this.debouncedWrite('blocklist');
    });
    ev.on('call', (calls) => {
      for (const call of calls) {
        const existingCall = this.calls.find((c) => c.id === call.id);
        if (existingCall) {
          Object.assign(existingCall, call);
        } else {
          this.calls.push(call);
        }
      }
      this.debouncedWrite('calls');
    });
    ev.on('labels.edit', (label) => {
      this.labels[label.id] = label;
      this.debouncedWrite('labels');
    });
    ev.on('labels.association', ({ association, type }) => {
      if (type === 'add') {
        if (!this.labels[association.labelId].associations) {
          this.labels[association.labelId].associations = [];
        }
        this.labels[association.labelId].associations.push(association);
      } else if (type === 'remove') {
        if (this.labels[association.labelId].associations) {
          this.labels[association.labelId].associations = this.labels[
            association.labelId
          ].associations.filter((assoc) => assoc.jid !== association.jid);
        }
      }
      this.debouncedWrite('labels');
    });
    ev.on('newsletter.reaction', (reaction) => {
      if (!this.newsletters[reaction.id]) {
        this.newsletters[reaction.id] = {};
      }
      if (!this.newsletters[reaction.id].reactions) {
        this.newsletters[reaction.id].reactions = [];
      }
      const existingReactionIdx = this.newsletters[reaction.id].reactions.findIndex(
        (r) => r.server_id === reaction.server_id,
      );
      if (existingReactionIdx !== -1) {
        Object.assign(this.newsletters[reaction.id].reactions[existingReactionIdx], reaction);
      } else {
        this.newsletters[reaction.id].reactions.push(reaction);
      }
      this.debouncedWrite('newsletters');
    });
    ev.on('newsletter.view', (view) => {
      if (!this.newsletters[view.id]) {
        this.newsletters[view.id] = {};
      }
      this.newsletters[view.id].view = view;
      this.debouncedWrite('newsletters');
    });
    ev.on('newsletter-participants.update', (update) => {
      if (!this.newsletters[update.id]) {
        this.newsletters[update.id] = {};
      }
      if (!this.newsletters[update.id].participants) {
        this.newsletters[update.id].participants = [];
      }
      const existingParticipantIdx = this.newsletters[update.id].participants.findIndex(
        (p) => p.user === update.user,
      );
      if (existingParticipantIdx !== -1) {
        Object.assign(this.newsletters[update.id].participants[existingParticipantIdx], update);
      } else {
        this.newsletters[update.id].participants.push(update);
      }
      this.debouncedWrite('newsletters');
    });
    ev.on('newsletter-settings.update', (update) => {
      if (!this.newsletters[update.id]) {
        this.newsletters[update.id] = {};
      }
      Object.assign(this.newsletters[update.id], update);
      this.debouncedWrite('newsletters');
    });
    ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
      if (isLatest) {
        this.chats = chats;
        this.contacts = contacts.reduce((acc, contact) => {
          acc[contact.id] = contact;
          return acc;
        }, {});
        this.messages = messages.reduce((acc, msg) => {
          if (!acc[msg.key.remoteJid]) {
            acc[msg.key.remoteJid] = [];
          }
          acc[msg.key.remoteJid].push(msg);
          return acc;
        }, {});
      } else {
        for (const chat of chats) {
          const existingChat = this.chats.find((c) => c.id === chat.id);
          if (existingChat) {
            Object.assign(existingChat, chat);
          } else {
            this.chats.push(chat);
          }
        }
        for (const contact of contacts) {
          this.contacts[contact.id] = contact;
        }
        for (const msg of messages) {
          if (!this.messages[msg.key.remoteJid]) {
            this.messages[msg.key.remoteJid] = [];
          }
          this.messages[msg.key.remoteJid].push(msg);
        }
      }
      this.debouncedWrite('chats');
      this.debouncedWrite('contacts');
      this.debouncedWrite('messages');
    });
    ev.on('chats.upsert', (newChats) => {
      this.chats = ensureDataType(this.chats, 'array');

      for (const chat of newChats) {
        const existingChat = this.chats.find((c) => c.id === chat.id);
        if (existingChat) {
          Object.assign(existingChat, chat);
        } else {
          this.chats.push(chat);
        }
      }
      this.debouncedWrite('chats');
    });
    ev.on('chats.update', (updates) => {
      for (const update of updates) {
        const existingChat = this.chats.find((c) => c.id === update.id);
        if (existingChat) {
          Object.assign(existingChat, update);
        }
      }
      this.debouncedWrite('chats');
    });
    ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      logger.info(`Phone number shared for chat ${jid} (LID: ${lid})`);
    });
    ev.on('chats.delete', (deletions) => {
      this.chats = this.chats.filter((c) => !deletions.includes(c.id));
      this.debouncedWrite('chats');
    });
    ev.on('presence.update', ({ id, presences }) => {
      this.presences[id] = presences;
      this.debouncedWrite('presences');
    });
    ev.on('contacts.upsert', (newContacts) => {
      for (const contact of newContacts) {
        this.contacts[contact.id] = contact;
      }
      this.debouncedWrite('contacts');
    });
  },
};

module.exports = store;
