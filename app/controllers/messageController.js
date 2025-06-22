/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 1.0.3
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const { str, cleanEnv } = require('envalid');
const { cacheManager } = require('../cache/cacheManager');
const { preProcessMessage, isCommand } = require('../utils/messageHelper');
const logger = require('../utils/logger/loggerModule');

const env = cleanEnv(process.env, {
  COMMAND_PREFIX: str({ default: '/', desc: 'Prefixo para comandos no chat' }),
});

const COMMAND_PREFIX = env.COMMAND_PREFIX;

/**
 * Processador de mensagens WhatsApp do OmniZap
 *
 * Processa todas as mensagens recebidas através da conexão WhatsApp,
 * aplicando filtros, validações e executando as ações correspondentes
 *
 * @param {Object} messageUpdate - Objeto contendo as mensagens recebidas
 * @param {Object} omniZapClient - Cliente WhatsApp ativo para interação
 * @param {String} qrCodePath - Caminho para o QR Code se necessário
 * @returns {Promise<void>}
 */
const OmniZapMessageProcessor = async (messageUpdate, omniZapClient) => {
  logger.info('Iniciando processamento de mensagens', {
    messageCount: messageUpdate?.messages?.length || 0,
  });

  try {
    for (const messageInfo of messageUpdate?.messages || []) {
      const isGroupMessage = messageInfo.key.remoteJid.endsWith('@g.us');
      const { type, body: messageText, isMedia } = preProcessMessage(messageInfo);

      const commandInfo = isCommand(messageText);
      const groupJid = isGroupMessage ? messageInfo.key.remoteJid : null;

      const senderJid = isGroupMessage
        ? messageInfo.key.participant || messageInfo.key.remoteJid
        : messageInfo.key.remoteJid;

      if (messageInfo.key.fromMe) {
        logger.debug('Mensagem própria ignorada', { messageType: 'own-message' });
        continue;
      }

      try {
        if (commandInfo.isCommand) {
          try {
            const { command, args } = commandInfo;
            const targetJid = isGroupMessage ? groupJid : senderJid;

            const getGroupInfo = async (groupJid) => {
              try {
                if (!groupJid || !groupJid.endsWith('@g.us')) {
                  return null;
                }

                return await cacheManager.getGroupMetadata(groupJid);
              } catch (error) {
                logger.error('Erro ao obter informações do grupo', {
                  error: error.message,
                  stack: error.stack,
                  groupJid,
                });
                return null;
              }
            };

            switch (command.toLowerCase()) {
              case 'teste':
                if (isGroupMessage) {
                  const groupInfo = await getGroupInfo(groupJid);
                  if (groupInfo) {
                    await omniZapClient.sendMessage(targetJid, {
                      text: JSON.stringify([messageInfo, groupInfo, commandInfo], null, 2),
                    });
                    logger.info('Comando teste executado com sucesso em grupo', {
                      groupJid,
                      senderJid,
                    });
                  } else {
                    await omniZapClient.sendMessage(targetJid, {
                      text: '❌ Dados do grupo não encontrados no cache',
                    });
                    logger.warn('Comando teste: dados do grupo não encontrados', {
                      groupJid,
                      senderJid,
                    });
                  }
                } else {
                  await omniZapClient.sendMessage(targetJid, {
                    text: '⚠️ Este comando funciona apenas em grupos',
                  });
                  logger.info('Comando teste: tentativa de uso fora de grupo', {
                    senderJid,
                  });
                }
                break;

              default:
                const contextInfo = isGroupMessage
                  ? `\n\n👥 *Contexto:* Grupo\n👤 *Solicitante:* ${senderJid}`
                  : `\n\n👤 *Contexto:* Mensagem direta`;

                const unknownText = `❓ *Comando Desconhecido*

🚫 **Comando:** ${COMMAND_PREFIX}${command}

💡 **Dica:** Use ${COMMAND_PREFIX}help para ver todos os comandos disponíveis${contextInfo}`;

                await omniZapClient.sendMessage(targetJid, { text: unknownText });
                logger.info('Comando desconhecido recebido', {
                  command,
                  args,
                  senderJid,
                  isGroupMessage: isGroupMessage ? 'true' : 'false',
                });
                break;
            }
          } catch (error) {
            logger.error('Erro ao processar comando', {
              error: error.message,
              stack: error.stack,
              command: commandInfo.command,
              args: commandInfo.args,
              senderJid,
              isGroupMessage,
            });
            const targetJid = isGroupMessage ? groupJid : senderJid;

            const contextInfo = isGroupMessage
              ? `\n\n👥 *Contexto:* Grupo\n👤 *Solicitante:* ${senderJid}`
              : `\n\n👤 *Contexto:* Mensagem direta`;

            await omniZapClient.sendMessage(targetJid, {
              text: `❌ *Erro interno*\n\nOcorreu um erro ao processar seu comando. Tente novamente.${contextInfo}`,
            });
          }
        } else {
          if (isGroupMessage) {
            logger.info('Mensagem normal de grupo processada', {
              type: 'group-message',
              messageType: type,
              isMedia,
              groupJid,
            });
          } else {
            logger.info('Mensagem normal processada', {
              type: 'private-message',
              messageType: type,
              isMedia,
              senderJid,
            });
          }
        }
      } catch (error) {
        logger.error('Erro ao processar mensagem individual', {
          error: error.message,
          stack: error.stack,
          senderJid,
          isGroupMessage: isGroupMessage ? 'true' : 'false',
        });
      }
    }
  } catch (error) {
    if (error.message && error.message.includes('network')) {
      logger.error('Erro de rede detectado', {
        error: error.message,
        stack: error.stack,
        type: 'network',
      });
    } else if (error.message && error.message.includes('timeout')) {
      logger.error('Timeout detectado', {
        error: error.message,
        stack: error.stack,
        type: 'timeout',
      });
    } else {
      logger.error('Erro geral no processamento', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  logger.info('Processamento de mensagens concluído');
};

module.exports = OmniZapMessageProcessor;
