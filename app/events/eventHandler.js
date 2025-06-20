/**
 * OmniZap Event Handler
 *
 * Módulo responsável pelo processamento independente de eventos
 * Recebe eventos do socketController e os processa de forma assíncrona
 *
 * @version 1.0.2
 * @author OmniZap Team
 * @license MIT
 */

const chalk = require('chalk');
const { cacheManager } = require('../cache/cacheManager');

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
    console.log(OmniZapColors.success('🎯 Events: Cliente WhatsApp configurado'));
  }

  /**
   * Inicializa o processador de eventos
   */
  init() {
    console.log(OmniZapColors.info('🎯 OmniZap Events: Processador inicializado'));
    this.initialized = true;
  }

  /**
   * Processa eventos de mensagens (messages.upsert)
   */
  async processMessagesUpsert(messageUpdate) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `📨 Events: Processando messages.upsert - ${
              messageUpdate.messages?.length || 0
            } mensagem(ns)`,
          ),
        );

        await cacheManager.saveEvent('messages.upsert', messageUpdate, `upsert_${Date.now()}`);

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
                _senderJid: isGroupMessage
                  ? messageInfo.key.participant || messageInfo.key.remoteJid
                  : messageInfo.key.remoteJid,
              };

              await cacheManager.saveMessage(enhancedMessageInfo);
              processedCount++;

              const jid = messageInfo.key?.remoteJid?.substring(0, 20) || 'N/A';
              const messageType = messageInfo.message
                ? Object.keys(messageInfo.message)[0]
                : 'unknown';

              if (isGroupMessage) {
                console.log(
                  OmniZapColors.gray(
                    `   ✓ Msg ${processedCount}: ${messageType} | GRUPO ${jid}...`,
                  ),
                );
              } else {
                console.log(
                  OmniZapColors.gray(`   ✓ Msg ${processedCount}: ${messageType} | ${jid}...`),
                );
              }
            } catch (error) {
              console.error(
                OmniZapColors.error('Events: Erro ao processar mensagem individual:'),
                error,
              );
            }
          }

          if (groupJids.size > 0 && this.omniZapClient) {
            console.log(
              OmniZapColors.info(
                `Events: Carregando metadados de ${groupJids.size} grupo(s) detectado(s)`,
              ),
            );

            await this.loadGroupsMetadata(Array.from(groupJids));
          }

          console.log(
            OmniZapColors.success(
              `Events: ✅ ${processedCount}/${messageUpdate.messages.length} mensagens processadas`,
            ),
          );
        }
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de messages.upsert:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de atualização de mensagens (messages.update)
   */
  async processMessagesUpdate(updates) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `📝 Events: Processando messages.update - ${updates?.length || 0} atualização(ões)`,
          ),
        );

        await cacheManager.saveEvent('messages.update', updates, `update_${Date.now()}`);

        updates?.forEach((update, index) => {
          const status = update.update?.status || 'N/A';
          const jid = update.key?.remoteJid?.substring(0, 20) || 'N/A';
          console.log(OmniZapColors.gray(`   ${index + 1}. Status: ${status} | JID: ${jid}...`));
        });
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de messages.update:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de exclusão de mensagens (messages.delete)
   */
  async processMessagesDelete(deletion) {
    setImmediate(async () => {
      try {
        console.log(OmniZapColors.warning('🗑️ Events: Processando messages.delete'));

        await cacheManager.saveEvent('messages.delete', deletion, `delete_${Date.now()}`);

        if (deletion.keys) {
          console.log(OmniZapColors.gray(`   Mensagens deletadas: ${deletion.keys.length}`));
          deletion.keys.forEach((key, index) => {
            const jid = key.remoteJid?.substring(0, 20) || 'N/A';
            const id = key.id?.substring(0, 10) || 'N/A';
            console.log(OmniZapColors.gray(`   ${index + 1}. JID: ${jid}... | ID: ${id}...`));
          });
        }
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de messages.delete:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de reações (messages.reaction)
   */
  async processMessagesReaction(reactions) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `😀 Events: Processando messages.reaction - ${reactions?.length || 0} reação(ões)`,
          ),
        );

        await cacheManager.saveEvent('messages.reaction', reactions, `reaction_${Date.now()}`);

        reactions?.forEach((reaction, index) => {
          const emoji = reaction.reaction?.text || '❓';
          const jid = reaction.key?.remoteJid?.substring(0, 20) || 'N/A';
          console.log(OmniZapColors.gray(`   ${index + 1}. ${emoji} | JID: ${jid}...`));
        });
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de messages.reaction:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de recibo de mensagem (message-receipt.update)
   */
  async processMessageReceipt(receipts) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `📬 Events: Processando message-receipt.update - ${receipts?.length || 0} recibo(s)`,
          ),
        );

        await cacheManager.saveEvent('message-receipt.update', receipts, `receipt_${Date.now()}`);

        receipts?.forEach((receipt, index) => {
          const status = receipt.receipt?.readTimestamp
            ? '✓✓ Lida'
            : receipt.receipt?.receiptTimestamp
            ? '✓✓ Entregue'
            : '✓ Enviada';
          const jid = receipt.key?.remoteJid?.substring(0, 20) || 'N/A';
          console.log(OmniZapColors.gray(`   ${index + 1}. ${status} | JID: ${jid}...`));
        });
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de message-receipt.update:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de histórico de mensagens (messaging-history.set)
   */
  async processMessagingHistory(historyData) {
    setImmediate(async () => {
      try {
        console.log(OmniZapColors.info('📚 Events: Processando messaging-history.set'));

        await cacheManager.saveEvent('messaging-history.set', historyData, `history_${Date.now()}`);

        if (historyData.messages) {
          console.log(
            OmniZapColors.gray(`   Mensagens no histórico: ${historyData.messages.length}`),
          );
        }
        if (historyData.chats) {
          console.log(OmniZapColors.gray(`   Chats no histórico: ${historyData.chats.length}`));
        }
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de messaging-history.set:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de grupos (groups.update)
   */
  async processGroupsUpdate(updates) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `👥 Events: Processando groups.update - ${updates?.length || 0} atualização(ões)`,
          ),
        );

        await cacheManager.saveEvent('groups.update', updates, `groups_update_${Date.now()}`);

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          console.log(OmniZapColors.gray(`   Grupo atualizado: ${jid}...`));

          if (update.id) {
            const cachedGroup = await cacheManager.getGroupMetadata(update.id);

            await cacheManager.saveGroupMetadata(update.id, update);

            if (cachedGroup) {
              console.log(OmniZapColors.info(`   Cache hit para grupo: ${jid}...`));
            }
          }
        }
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de groups.update:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de grupos (groups.upsert)
   */
  async processGroupsUpsert(groupsMetadata) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `👥 Events: Processando groups.upsert - ${groupsMetadata?.length || 0} grupo(s)`,
          ),
        );

        await cacheManager.saveEvent(
          'groups.upsert',
          groupsMetadata,
          `groups_upsert_${Date.now()}`,
        );

        for (const group of groupsMetadata || []) {
          const jid = group.id?.substring(0, 30) || 'N/A';
          const subject = group.subject || 'Sem nome';
          console.log(OmniZapColors.gray(`   ${subject} | JID: ${jid}...`));

          await cacheManager.saveGroupMetadata(group.id, group);
          if (this.omniZapClient && group.id) {
            try {
              await cacheManager.getOrFetchGroupMetadata(group.id, this.omniZapClient);
            } catch (error) {
              console.error(
                OmniZapColors.error(`Events: Erro ao buscar metadados do grupo ${subject}:`),
                error,
              );
            }
          }
        }
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de groups.upsert:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de participantes de grupo (group-participants.update)
   */
  async processGroupParticipants(event) {
    setImmediate(async () => {
      try {
        console.log(OmniZapColors.info('👥 Events: Processando group-participants.update'));

        await cacheManager.saveEvent(
          'group-participants.update',
          event,
          `participants_${Date.now()}`,
        );

        const jid = event.id?.substring(0, 30) || 'N/A';
        const action = event.action || 'N/A';
        const participants = event.participants?.length || 0;
        console.log(
          OmniZapColors.gray(
            `   Grupo: ${jid}... | Ação: ${action} | Participantes: ${participants}`,
          ),
        );
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de group-participants.update:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de chats (chats.upsert)
   */
  async processChatsUpsert(chats) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(`💬 Events: Processando chats.upsert - ${chats?.length || 0} chat(s)`),
        );

        await cacheManager.saveEvent('chats.upsert', chats, `chats_upsert_${Date.now()}`);

        for (const chat of chats || []) {
          const jid = chat.id?.substring(0, 30) || 'N/A';
          const name = chat.name || 'Sem nome';
          console.log(OmniZapColors.gray(`   ${name} | JID: ${jid}...`));

          const cachedChat = await cacheManager.getChat(chat.id);
          await cacheManager.saveChat(chat);

          if (cachedChat) {
            console.log(OmniZapColors.info(`   Cache hit para chat: ${name}`));
          }
        }
      } catch (error) {
        console.error(OmniZapColors.error('Events: Erro no processamento de chats.upsert:'), error);
      }
    });
  }

  /**
   * Processa eventos de chats (chats.update)
   */
  async processChatsUpdate(updates) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `💬 Events: Processando chats.update - ${updates?.length || 0} atualização(ões)`,
          ),
        );

        await cacheManager.saveEvent('chats.update', updates, `chats_update_${Date.now()}`);

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          console.log(OmniZapColors.gray(`   Chat atualizado: ${jid}...`));

          const cachedChat = await cacheManager.getChat(update.id);

          await cacheManager.saveChat(update);

          if (cachedChat) {
            console.log(OmniZapColors.info(`   Cache hit para chat: ${jid}...`));
          }
        }
      } catch (error) {
        console.error(OmniZapColors.error('Events: Erro no processamento de chats.update:'), error);
      }
    });
  }

  /**
   * Processa eventos de chats deletados (chats.delete)
   */
  async processChatsDelete(jids) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.warning(
            `💬 Events: Processando chats.delete - ${jids?.length || 0} chat(s) deletado(s)`,
          ),
        );

        await cacheManager.saveEvent('chats.delete', jids, `chats_delete_${Date.now()}`);

        jids?.forEach((jid, index) => {
          console.log(
            OmniZapColors.gray(`   ${index + 1}. JID deletado: ${jid.substring(0, 30)}...`),
          );
        });
      } catch (error) {
        console.error(OmniZapColors.error('Events: Erro no processamento de chats.delete:'), error);
      }
    });
  }

  /**
   * Processa eventos de contatos (contacts.upsert)
   */
  async processContactsUpsert(contacts) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `👤 Events: Processando contacts.upsert - ${contacts?.length || 0} contato(s)`,
          ),
        );

        await cacheManager.saveEvent('contacts.upsert', contacts, `contacts_upsert_${Date.now()}`);

        for (const contact of contacts || []) {
          const jid = contact.id?.substring(0, 30) || 'N/A';
          const name = contact.name || contact.notify || 'Sem nome';
          console.log(OmniZapColors.gray(`   ${name} | JID: ${jid}...`));

          const cachedContact = await cacheManager.getContact(contact.id);

          await cacheManager.saveContact(contact);

          if (cachedContact) {
            console.log(OmniZapColors.info(`   Cache hit para contato: ${name}`));
          }
        }
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de contacts.upsert:'),
          error,
        );
      }
    });
  }

  /**
   * Processa eventos de contatos (contacts.update)
   */
  async processContactsUpdate(updates) {
    setImmediate(async () => {
      try {
        console.log(
          OmniZapColors.info(
            `👤 Events: Processando contacts.update - ${updates?.length || 0} atualização(ões)`,
          ),
        );

        await cacheManager.saveEvent('contacts.update', updates, `contacts_update_${Date.now()}`);

        for (const update of updates || []) {
          const jid = update.id?.substring(0, 30) || 'N/A';
          const name = update.name || update.notify || 'Sem nome';
          console.log(OmniZapColors.gray(`   ${name} | JID: ${jid}...`));

          const cachedContact = await cacheManager.getContact(update.id);

          await cacheManager.saveContact(update);

          if (cachedContact) {
            console.log(OmniZapColors.info(`   Cache hit para contato: ${name}`));
          }
        }
      } catch (error) {
        console.error(
          OmniZapColors.error('Events: Erro no processamento de contacts.update:'),
          error,
        );
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
      console.warn(
        OmniZapColors.warning('Events: Cliente WhatsApp não disponível para carregar metadados'),
      );
      return;
    }

    try {
      console.log(
        OmniZapColors.info(
          `Events: Iniciando carregamento de metadados para ${groupJids.length} grupo(s)`,
        ),
      );

      const promises = groupJids.map(async (groupJid, index) => {
        try {
          await new Promise((resolve) => setTimeout(resolve, index * 100));

          const metadata = await cacheManager.getOrFetchGroupMetadata(groupJid, this.omniZapClient);

          if (metadata) {
            console.log(
              OmniZapColors.success(
                `Events: Metadados carregados para "${metadata.subject}" (${
                  metadata._participantCount || 0
                } participantes)`,
              ),
            );
            return { success: true, groupJid, metadata };
          } else {
            console.warn(
              OmniZapColors.warning(
                `Events: Não foi possível carregar metadados do grupo ${groupJid}`,
              ),
            );
            return { success: false, groupJid, error: 'Metadados não encontrados' };
          }
        } catch (error) {
          console.error(
            OmniZapColors.error(`Events: Erro ao carregar metadados do grupo ${groupJid}:`),
            error,
          );
          return { success: false, groupJid, error: error.message };
        }
      });

      const results = await Promise.allSettled(promises);

      const successful = results.filter(
        (result) => result.status === 'fulfilled' && result.value.success,
      ).length;

      const failed = results.length - successful;

      if (successful > 0) {
        console.log(
          OmniZapColors.success(
            `Events: ✅ Carregamento concluído - ${successful} sucessos, ${failed} falhas`,
          ),
        );
      }

      if (failed > 0) {
        console.log(
          OmniZapColors.warning(
            `Events: ⚠️ ${failed} grupo(s) não puderam ter metadados carregados`,
          ),
        );
      }
    } catch (error) {
      console.error(OmniZapColors.error('Events: Erro geral no carregamento de metadados:'), error);
    }
  }

  /**
   * Processa outros eventos genéricos
   */
  async processGenericEvent(eventType, eventData) {
    setImmediate(async () => {
      try {
        console.log(OmniZapColors.info(`🔄 Events: Processando ${eventType}`));

        await cacheManager.saveEvent(eventType, eventData, `${eventType}_${Date.now()}`);
      } catch (error) {
        console.error(OmniZapColors.error(`Events: Erro no processamento de ${eventType}:`), error);
      }
    });
  }
}

const eventHandler = new EventHandler();

module.exports = {
  eventHandler,
};
