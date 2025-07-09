/**
 * OmniZap Event Handler
 *
 * Módulo responsável pelo processamento independente de eventos
 * Recebe eventos do socketController e os processa de forma assíncrona
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

const chalk = require('chalk');
const { databaseManager } = require('../database/databaseManager');
const logger = require('../utils/logger/loggerModule');

/**
 * Classe principal do processador de eventos
 */
class EventHandler {
  constructor() {
    this.initialized = false;
    this.omniZapClient = null;
    this.init();
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
   * Inicializa o processador de eventos
   */
  init() {
    logger.info('🎯 OmniZap Events: Processador inicializado');
    this.initialized = true;
  }

  /**
   * Processa eventos de mensagens (messages.upsert)
   */
  async processMessagesUpsert(messageUpdate) {
    setImmediate(async () => {
      try {
        logger.info(`📨 Events: Processando messages.upsert - ${messageUpdate.messages?.length || 0} mensagem(ns)`);

        await databaseManager.saveEvent('messages.upsert', messageUpdate, `upsert_${Date.now()}`);

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

              await databaseManager.saveMessage(enhancedMessageInfo);
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

        await databaseManager.saveEvent('messages.update', updates, `update_${Date.now()}`);

        updates?.forEach((update, index) => {
          const status = update.update?.status || 'N/A';
          const jid = update.key?.remoteJid?.substring(0, 20) || 'N/A';
          logger.debug(`   ${index + 1}. Status: ${status} | JID: ${jid}...`);
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

        await databaseManager.saveEvent('messages.delete', deletion, `delete_${Date.now()}`);

        if (deletion.keys) {
          logger.debug(`   Mensagens deletadas: ${deletion.keys.length}`);
          deletion.keys.forEach((key, index) => {
            const jid = key.remoteJid?.substring(0, 20) || 'N/A';
            const id = key.id?.substring(0, 10) || 'N/A';
            logger.debug(`   ${index + 1}. JID: ${jid}... | ID: ${id}...`);
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

        await databaseManager.saveEvent('messages.reaction', reactions, `reaction_${Date.now()}`);

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

        await databaseManager.saveEvent('message-receipt.update', receipts, `receipt_${Date.now()}`);

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

        await databaseManager.saveEvent('messaging-history.set', historyData, `history_${Date.now()}`);

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

        await databaseManager.saveEvent('groups.update', updates, `groups_update_${Date.now()}`);

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          logger.debug(`   Grupo atualizado: ${jid}...`);

          if (update.id) {
            const cachedGroup = await databaseManager.getGroupMetadata(update.id);

            await databaseManager.saveGroupMetadata(update.id, update);

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

        await databaseManager.saveEvent('groups.upsert', groupsMetadata, `groups_upsert_${Date.now()}`);

        for (const group of groupsMetadata || []) {
          const jid = group.id?.substring(0, 30) || 'N/A';
          const subject = group.subject || 'Sem nome';
          logger.debug(`   ${subject} | JID: ${jid}...`);

          await databaseManager.saveGroupMetadata(group.id, group);
          if (this.omniZapClient && group.id) {
            try {
              await databaseManager.getOrFetchGroupMetadata(group.id, this.omniZapClient);
            } catch (error) {
              logger.error(`Events: Erro ao buscar metadados do grupo ${subject}:`, {
                error: error.message,
                stack: error.stack,
              });
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

        await databaseManager.saveEvent('group-participants.update', event, `participants_${Date.now()}`);

        const jid = event.id?.substring(0, 30) || 'N/A';
        const action = event.action || 'N/A';
        const participants = event.participants?.length || 0;
        logger.debug(`   Grupo: ${jid}... | Ação: ${action} | Participantes: ${participants}`);
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

        await databaseManager.saveEvent('chats.upsert', chats, `chats_upsert_${Date.now()}`);

        for (const chat of chats || []) {
          const jid = chat.id?.substring(0, 30) || 'N/A';
          const name = chat.name || 'Sem nome';
          logger.debug(`   ${name} | JID: ${jid}...`);

          const cachedChat = await databaseManager.getChat(chat.id);
          await databaseManager.saveChat(chat);

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

        await databaseManager.saveEvent('chats.update', updates, `chats_update_${Date.now()}`);

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          logger.debug(`   Chat atualizado: ${jid}...`);

          const cachedChat = await databaseManager.getChat(update.id);

          await databaseManager.saveChat(update);

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

        await databaseManager.saveEvent('chats.delete', jids, `chats_delete_${Date.now()}`);

        jids?.forEach((jid, index) => {
          logger.debug(`   ${index + 1}. JID deletado: ${jid.substring(0, 30)}...`);
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

        await databaseManager.saveEvent('contacts.upsert', contacts, `contacts_upsert_${Date.now()}`);

        for (const contact of contacts || []) {
          const jid = contact.id?.substring(0, 30) || 'N/A';
          const name = contact.name || contact.notify || 'Sem nome';
          logger.debug(`   ${name} | JID: ${jid}...`);

          const cachedContact = await databaseManager.getContact(contact.id);

          await databaseManager.saveContact(contact);

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

        await databaseManager.saveEvent('contacts.update', updates, `contacts_update_${Date.now()}`);

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          const name = update.name || update.notify || 'Sem nome';
          logger.debug(`   ${name} | JID: ${jid}...`);

          const cachedContact = await databaseManager.getContact(update.id);

          await databaseManager.saveContact(update);

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

          const metadata = await databaseManager.getOrFetchGroupMetadata(groupJid, this.omniZapClient);

          if (metadata) {
            logger.info(`Events: Metadados carregados para "${metadata.subject}" (${metadata._participantCount || 0} participantes)`);
            return { success: true, groupJid, metadata };
          } else {
            logger.warn(`Events: Não foi possível carregar metadados do grupo ${groupJid}`);
            return { success: false, groupJid, error: 'Metadados não encontrados' };
          }
        } catch (error) {
          logger.error(`Events: Erro ao carregar metadados do grupo ${groupJid}:`, {
            error: error.message,
            stack: error.stack,
          });
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
      logger.error('Events: Erro geral no carregamento de metadados:', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Processa outros eventos genéricos
   */
  async processGenericEvent(eventType, eventData) {
    setImmediate(async () => {
      try {
        logger.info(`🔄 Events: Processando ${eventType}`);

        await databaseManager.saveEvent(eventType, eventData, `${eventType}_${Date.now()}`);
      } catch (error) {
        logger.error(`Events: Erro no processamento de ${eventType}:`, {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }
}

const eventHandler = new EventHandler();

module.exports = {
  eventHandler,
};
