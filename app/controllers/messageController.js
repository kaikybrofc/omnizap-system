/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 2.0.0
 * @license MIT
 * @source https://github.com/Kaikygr/omnizap-system
 */

require('dotenv').config();
const logger = require('../utils/logger/loggerModule');
const groupUtils = require('../utils/groupUtils');
const dataStore = require('../store/dataStore');

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

/**
 * Extrai o conteúdo de texto de uma mensagem do WhatsApp.
 *
 * @param {Object} messageInfo - Objeto da mensagem do WhatsApp.
 * @returns {string} O conteúdo de texto da mensagem ou uma string indicando o tipo de mídia.
 */
const extractMessageContent = (messageInfo) => {
  const message = messageInfo.message;

  if (!message) {
    return 'Mensagem vazia';
  }

  if (message.conversation) {
    return message.conversation;
  }
  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }
  if (message.imageMessage) {
    return message.imageMessage.caption || '[Imagem]';
  }
  if (message.videoMessage) {
    return message.videoMessage.caption || '[Vídeo]';
  }
  if (message.documentMessage) {
    return message.documentMessage.fileName || '[Documento]';
  }
  if (message.audioMessage) {
    return '[Áudio]';
  }
  if (message.stickerMessage) {
    return '[Figurinha]';
  }
  if (message.locationMessage) {
    return `[Localização] Latitude: ${message.locationMessage.degreesLatitude}, Longitude: ${message.locationMessage.degreesLongitude}`;
  }
  if (message.contactMessage) {
    return `[Contato] ${message.contactMessage.displayName}`;
  }
  if (message.contactsArrayMessage) {
    return `[Contatos] ${message.contactsArrayArrayMessage.contacts.map((c) => c.displayName).join(', ')}`;
  }
  if (message.listMessage) {
    return message.listMessage.description || '[Mensagem de Lista]';
  }
  if (message.buttonsMessage) {
    return message.buttonsMessage.contentText || '[Mensagem de Botões]';
  }
  if (message.templateButtonReplyMessage) {
    return `[Resposta de Botão de Modelo] ${message.templateButtonReplyMessage.selectedDisplayText}`;
  }
  if (message.productMessage) {
    return message.productMessage.product?.title || '[Mensagem de Produto]';
  }
  if (message.reactionMessage) {
    return `[Reação] ${message.reactionMessage.text}`;
  }
  if (message.pollCreationMessage) {
    return `[Enquete] ${message.pollCreationMessage.name}`;
  }

  return 'Tipo de mensagem não suportado ou sem conteúdo de texto.';
};

/**
 * Lida com atualizações do WhatsApp, sejam mensagens ou eventos genéricos.
 *
 * @param {Object} update - Objeto contendo a atualização do WhatsApp.
 */
const handleWhatsAppUpdate = async (update, sock) => {
  if (update.messages && Array.isArray(update.messages)) {
    dataStore.saveIncomingRawMessages(update.messages); // Salva as mensagens raw no dataStore
    logger.info('📨 Processando mensagens recebidas', {
      messageCount: update.messages.length,
      info: update.messages.map((messageInfo) => {
        return `📨 Mensagem de ${messageInfo.key.remoteJid}: ${extractMessageContent(messageInfo)}`;
      }),
      action: 'process_incoming_messages',
    });

    try {
      for (const messageInfo of update.messages) {
        const extractedText = extractMessageContent(messageInfo);
        if (extractedText.startsWith(COMMAND_PREFIX)) {
          const commandArgs = extractedText.substring(COMMAND_PREFIX.length).split(' ');
          const command = commandArgs[0];
          const args = commandArgs.slice(1);

          const isGroupMessage = messageInfo.key.remoteJid.endsWith('@g.us');
          const remoteJid = messageInfo.key.remoteJid;
          const senderJid = isGroupMessage ? messageInfo.key.participant : remoteJid;

          logger.info(`Comando recebido: ${command} (de ${isGroupMessage ? 'grupo' : 'privado'})`);

          switch (command) {
            case 'grupoinfo': {
              let targetGroupId = args[0] || (isGroupMessage ? remoteJid : null);

              if (!targetGroupId) {
                logger.warn('ID do grupo não fornecido para /grupoinfo em chat privado.');
                await sock.sendMessage(remoteJid, {
                  text: '⚠️ *Por favor, forneça o ID do grupo!*\n\nExemplo: `/grupoinfo 1234567890@g.us`',
                });
                break;
              }

              const groupInfo = groupUtils.getGroupInfo(targetGroupId);

              if (!groupInfo) {
                logger.info(`Grupo com ID ${targetGroupId} não encontrado.`);
                await sock.sendMessage(remoteJid, {
                  text: `❌ *Grupo com ID ${targetGroupId} não encontrado.*`,
                });
                break;
              }

              const reply = `📋 *Informações do Grupo:*\n\n` + `🆔 *ID:* ${groupInfo.id}\n` + `📝 *Assunto:* ${groupInfo.subject || 'N/A'}\n` + `👑 *Proprietário:* ${groupUtils.getGroupOwner(targetGroupId) || 'N/A'}\n` + `📅 *Criado em:* ${groupUtils.getGroupCreationTime(targetGroupId) ? new Date(groupUtils.getGroupCreationTime(targetGroupId) * 1000).toLocaleString() : 'N/A'}\n` + `👥 *Tamanho:* ${groupUtils.getGroupSize(targetGroupId) || 'N/A'}\n` + `🔒 *Restrito:* ${groupUtils.isGroupRestricted(targetGroupId) ? 'Sim' : 'Não'}\n` + `📢 *Somente anúncios:* ${groupUtils.isGroupAnnounceOnly(targetGroupId) ? 'Sim' : 'Não'}\n` + `🏘️ *Comunidade:* ${groupUtils.isGroupCommunity(targetGroupId) ? 'Sim' : 'Não'}\n` + `🗣️ *Descrição:* ${groupUtils.getGroupDescription(targetGroupId) || 'N/A'}\n` + `🛡️ *Administradores:* ${groupUtils.getGroupAdmins(targetGroupId).join(', ') || 'Nenhum'}\n` + `👤 *Total de Participantes:* ${groupUtils.getGroupParticipants(targetGroupId)?.length || 'Nenhum'}`;

              await sock.sendMessage(remoteJid, { text: reply });
              break;
            }

            default:
              logger.info(`Comando desconhecido: ${command}`);
              break;
          }
        }
      }
    } catch (error) {
      logger.error('Erro ao processar mensagens:', error.message);
    }
  } else {
    logger.info('🔄 Processando evento recebido:', {
      eventType: update?.type || 'unknown',
      eventData: update,
    });
  }
};

module.exports = {
  handleWhatsAppUpdate,
  extractMessageContent,
};
