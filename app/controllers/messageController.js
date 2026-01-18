require('dotenv').config();
const { handleMenuCommand } = require('../modules/menuModule/menus');
const { handleAdminCommand, isAdminCommand } = require('../modules/adminModule/groupCommandHandlers');
const { processSticker } = require('../modules/stickerModule/stickerCommand');
const { getExpiration } = require('../config/baileysConfig');
const groupUtils = require('../config/groupUtils');
const dataStore = require('../store/dataStore');
const groupConfigStore = require('../store/groupConfigStore');
const logger = require('../utils/logger/loggerModule');
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

/**
 * Extrai o conteúdo de texto de uma mensagem do WhatsApp.
 * @param {Object} messageInfo
 * @returns {string}
 */
const extractMessageContent = ({ message }) => {
  if (!message) return 'Mensagem vazia';

  const text = message.conversation?.trim() || message.extendedTextMessage?.text;

  if (text) return text;

  const handlers = [
    [message.imageMessage, (m) => m.caption || '[Imagem]'],
    [message.videoMessage, (m) => m.caption || '[Vídeo]'],
    [message.documentMessage, (m) => m.fileName || '[Documento]'],
    [message.audioMessage, () => '[Áudio]'],
    [message.stickerMessage, () => '[Figurinha]'],
    [message.locationMessage, (m) => `[Localização] Lat: ${m.degreesLatitude}, Long: ${m.degreesLongitude}`],
    [message.contactMessage, (m) => `[Contato] ${m.displayName}`],
    [message.contactsArrayMessage, (m) => `[Contatos] ${m.contacts.map((c) => c.displayName).join(', ')}`],
    [message.listMessage, (m) => m.description || '[Mensagem de Lista]'],
    [message.buttonsMessage, (m) => m.contentText || '[Mensagem de Botões]'],
    [message.templateButtonReplyMessage, (m) => `[Resposta de Botão] ${m.selectedDisplayText}`],
    [message.productMessage, (m) => m.product?.title || '[Mensagem de Produto]'],
    [message.reactionMessage, (m) => `[Reação] ${m.text}`],
    [message.pollCreationMessage, (m) => `[Enquete] ${m.name}`],
  ];

  for (const [msg, fn] of handlers) {
    if (msg) return fn(msg);
  }

  return 'Tipo de mensagem não suportado ou sem conteúdo.';
};

/**
 * Lida com atualizações do WhatsApp, sejam mensagens ou eventos genéricos.
 *
 * @param {Object} update - Objeto contendo a atualização do WhatsApp.
 */
const handleMessages = async (update, sock) => {
  if (update.messages && Array.isArray(update.messages)) {
    try {
      for (const messageInfo of update.messages) {
        const extractedText = extractMessageContent(messageInfo);
        const remoteJid = messageInfo.key.remoteJid;
        const isGroupMessage = remoteJid.endsWith('@g.us');
        const senderJid = isGroupMessage ? messageInfo.key.participant : remoteJid;
        const senderName = messageInfo.pushName;
        const expirationMessage = getExpiration(messageInfo);
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Antilink Feature
        if (isGroupMessage) {
          const groupConfig = groupConfigStore.getGroupConfig(remoteJid);
          if (groupConfig && groupConfig.antilinkEnabled) {
            let linkFound = false;

            // Primary verification (Regex for common patterns)
            const primaryRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[A-Za-z0-9]+)/gi;
            if (primaryRegex.test(extractedText)) {
              linkFound = true;
            }

            // Secondary verification for domain-like words (e.g., example.com)
            if (!linkFound) {
              const tlds = ['com', 'net', 'org', 'gov', 'edu', 'biz', 'info', 'io', 'co', 'app', 'xyz', 'br', 'pt', 'us', 'uk', 'de', 'jp', 'fr', 'au', 'ca', 'cn', 'ru', 'in'];
              const secondaryRegex = new RegExp(`\\b[a-zA-Z0-9-]+\\.(${tlds.join('|')})\\b`, 'i');
              if (secondaryRegex.test(extractedText)) {
                linkFound = true;
              }
            }

            if (linkFound) {
              const isAdmin = await groupUtils.isUserAdmin(remoteJid, senderJid);
              const senderIsBot = senderJid === botJid;

              if (!isAdmin && !senderIsBot) {
                try {
                  await groupUtils.updateGroupParticipants(sock, remoteJid, [senderJid], 'remove');
                  await sock.sendMessage(remoteJid, { text: `🚫 @${senderJid.split('@')[0]} foi removido por enviar um link.`, mentions: [senderJid] });
                  await sock.sendMessage(remoteJid, { delete: messageInfo.key });

                  logger.info(`Usuário ${senderJid} removido do grupo ${remoteJid} por enviar link.`, {
                    action: 'antilink_remove',
                    groupId: remoteJid,
                    userId: senderJid,
                  });

                  continue; // Skip further processing
                } catch (error) {
                  logger.error(`Falha ao remover usuário com antilink: ${error.message}`, {
                    action: 'antilink_error',
                    groupId: remoteJid,
                    userId: senderJid,
                    error: error.stack,
                  });
                }
              } else if (isAdmin && !senderIsBot) {
                try {
                  await sock.sendMessage(remoteJid, { text: `ⓘ @${senderJid.split('@')[0]} (admin) enviou um link.`, mentions: [senderJid] });
                  logger.info(`Admin ${senderJid} enviou um link no grupo ${remoteJid} (aviso enviado).`, {
                    action: 'antilink_admin_link_detected',
                    groupId: remoteJid,
                    userId: senderJid,
                  });
                } catch (error) {
                  logger.error(`Falha ao enviar aviso de link de admin: ${error.message}`, {
                    action: 'antilink_admin_warning_error',
                    groupId: remoteJid,
                    userId: senderJid,
                    error: error.stack,
                  });
                }
              }
            }
          }
        }

        if (extractedText.startsWith(COMMAND_PREFIX)) {
          const commandBody = extractedText.substring(COMMAND_PREFIX.length);
          const match = commandBody.match(/^(\S+)([\s\S]*)$/);
          const command = match ? match[1].toLowerCase() : '';
          const args = match && match[2] !== undefined ? [match[2].trimStart()] : [];
          const text = match && match[2] !== undefined ? match[2] : '';

          switch (command) {
            case 'menu': {
              await handleMenuCommand(sock, remoteJid, messageInfo, expirationMessage, senderName, COMMAND_PREFIX);
              break;
            }

            case 'sticker':
            case 's':
              processSticker(sock, messageInfo, senderJid, remoteJid, expirationMessage, senderName, args.join(' '));
              break;

            default: {
              if (isAdminCommand(command)) {
                await handleAdminCommand({
                  command,
                  args,
                  text,
                  sock,
                  messageInfo,
                  remoteJid,
                  senderJid,
                  botJid,
                  isGroupMessage,
                  expirationMessage,
                });
                break;
              }
              logger.info(`Comando desconhecido recebido: ${command}`);

              await sock.sendMessage(
                remoteJid,
                {
                  text: `❌ *Comando não reconhecido*

O comando *${command}* não está configurado ou ainda não existe.

ℹ️ *Dica:*  
Digite *${COMMAND_PREFIX}menu* para ver a lista de comandos disponíveis.

🚧 *Fase Beta*  
O omnizap-system ainda está em desenvolvimento e novos comandos estão sendo adicionados constantemente.

📩 *Contato do Desenvolvedor*  
• Instagram: *@kaikybrofc*  
• WhatsApp: +55 95 99112-2954`,
                },
                {
                  quoted: messageInfo,
                  ephemeralExpiration: expirationMessage,
                },
              );

              break;
            }
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
  handleMessages,
  extractMessageContent,
};
