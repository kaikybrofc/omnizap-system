/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 1.0.2
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();

const { cacheManager } = require('../cache/cacheManager');

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

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
  try {
    for (const messageInfo of messageUpdate?.messages || []) {
      const isGroupMessage = messageInfo.key.remoteJid.endsWith('@g.us');
      const groupJid = isGroupMessage ? messageInfo.key.remoteJid : null;
      const senderJid = isGroupMessage
        ? messageInfo.key.participant || messageInfo.key.remoteJid
        : messageInfo.key.remoteJid;

      if (!messageInfo.message) {
        console.log('OmniZap: Mensagem sem conteúdo ignorada');
        continue;
      }

      if (messageUpdate.type === 'append') {
        console.log('OmniZap: Mensagem histórica ignorada');
        continue;
      }

      if (messageInfo.key.fromMe) {
        console.log('OmniZap: Mensagem própria ignorada');
        continue;
      }

      if (isGroupMessage) {
        console.log(
          `OmniZap: Processando mensagem de GRUPO - Grupo: ${groupJid}, Remetente: ${senderJid}`,
        );
      } else {
        console.log(`OmniZap: Processando mensagem DIRETA de ${senderJid}`);
      }

      try {
        console.log(JSON.stringify(messageInfo, null, 2));
        const messageContent = messageInfo.message;
        const messageId = messageInfo.key.id;

        if (isGroupMessage) {
          console.log(
            `OmniZap: Nova mensagem de GRUPO [${messageId}] - Grupo: ${groupJid}, Remetente: ${senderJid}`,
          );
        } else {
          console.log(`OmniZap: Nova mensagem DIRETA [${messageId}] - Remetente: ${senderJid}`);
        }

        // Extrair texto da mensagem
        const messageText = (() => {
          if (messageContent.conversation) {
            return messageContent.conversation;
          }

          if (messageContent.extendedTextMessage?.text) {
            return messageContent.extendedTextMessage.text;
          }

          if (messageContent.imageMessage?.caption) {
            return messageContent.imageMessage.caption;
          }

          if (messageContent.videoMessage?.caption) {
            return messageContent.videoMessage.caption;
          }

          return null;
        })();

        if (!messageText) {
          console.log('OmniZap: Mensagem sem texto ignorada');
          continue;
        }

        // Verificar se é um comando
        if (messageText.startsWith(COMMAND_PREFIX)) {
          try {
            const commandText = messageText.slice(COMMAND_PREFIX.length).trim();
            const [command, ...args] = commandText.split(' ');
            const targetJid = isGroupMessage ? groupJid : senderJid; // Para onde enviar a resposta

            if (isGroupMessage) {
              console.log(
                `OmniZap: Comando detectado em GRUPO: ${command} com argumentos:`,
                args,
                `- Grupo: ${groupJid}, Remetente: ${senderJid}`,
              );
            } else {
              console.log(
                `OmniZap: Comando detectado: ${command} com argumentos:`,
                args,
                `- Remetente: ${senderJid}`,
              );
            }

            // Função auxiliar para obter informações do grupo
            const getGroupInfo = async (groupJid) => {
              try {
                if (!groupJid || !groupJid.endsWith('@g.us')) {
                  return null;
                }

                return await cacheManager.getGroupMetadata(groupJid);
              } catch (error) {
                console.error('OmniZap: Erro ao obter informações do grupo:', error);
                return null;
              }
            };

            // Processar comandos
            switch (command.toLowerCase()) {
              case 'teste':
                if (isGroupMessage) {
                  const groupInfo = await getGroupInfo(groupJid);
                  if (groupInfo) {
                    await omniZapClient.sendMessage(targetJid, {
                      text:
                        `📋 *Teste - Dados do Cache*\n\n` +
                        `🏷️ *Nome:* ${groupInfo.subject}\n` +
                        `👥 *Participantes:* ${groupInfo._participantCount}\n` +
                        `📅 *Cache:* ${new Date(groupInfo._cacheTimestamp).toLocaleString(
                          'pt-BR',
                        )}\n` +
                        `🔄 *Último Acesso:* ${new Date(groupInfo._lastAccessed).toLocaleString(
                          'pt-BR',
                        )}`,
                    });
                  } else {
                    await omniZapClient.sendMessage(targetJid, {
                      text: '❌ Dados do grupo não encontrados no cache',
                    });
                  }
                } else {
                  await omniZapClient.sendMessage(targetJid, {
                    text: '⚠️ Este comando funciona apenas em grupos',
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
                break;
            }
          } catch (error) {
            console.error('OmniZap: Erro ao processar comando:', error);
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
            console.log(
              `OmniZap: Mensagem normal de grupo processada (sem comando) - Grupo: ${groupJid}`,
            );
          } else {
            console.log('OmniZap: Mensagem normal processada (sem comando)');
          }
        }
      } catch (error) {
        console.error(`OmniZap: Erro ao processar mensagem individual:`, error);
      }
    }
  } catch (error) {
    if (error.message && error.message.includes('network')) {
      console.error('OmniZap: Erro de rede detectado:', error.message);
    } else if (error.message && error.message.includes('timeout')) {
      console.error('OmniZap: Timeout detectado:', error.message);
    } else {
      console.error('OmniZap: Erro geral no processamento:', error);
    }
  }
};

module.exports = OmniZapMessageProcessor;
