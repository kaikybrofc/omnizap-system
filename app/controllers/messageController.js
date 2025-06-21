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

// Validação das variáveis de ambiente usando envalid
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
        console.log('OmniZap: Mensagem própria ignorada');
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
                console.error('OmniZap: Erro ao obter informações do grupo:', error);
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
