/**
 * OmniZap Ban Command
 *
 * Comandos para banimento de usuários em grupos
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('../../utils/logger/loggerModule');
const { databaseManager } = require('../../database/databaseManager');
const { formatErrorMessage } = require('../../utils/messageUtils');

/**
 * Verifica se o bot é administrador no grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} groupJid - ID do grupo
 * @returns {Promise<Boolean>} - True se o bot for administrador
 */
const isBotAdmin = async (omniZapClient, groupJid) => {
  try {
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    if (!groupMetadata) {
      logger.error('Não foi possível obter metadados do grupo', { groupJid });
      return false;
    }

    const botJid = omniZapClient.user.id.replace(/:\d+/, '');
    const participants = groupMetadata.participants || [];

    const botParticipant = participants.find((participant) => participant.id.replace(/:\d+/, '') === botJid);

    return botParticipant && ['admin', 'superadmin'].includes(botParticipant.admin);
  } catch (error) {
    logger.error('Erro ao verificar status de admin do bot', {
      error: error.message,
      stack: error.stack,
      groupJid,
    });
    return false;
  }
};

/**
 * Verifica se um usuário é administrador no grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} groupJid - ID do grupo
 * @param {String} userJid - ID do usuário
 * @returns {Promise<Boolean>} - True se o usuário for administrador
 */
const isUserAdmin = async (omniZapClient, groupJid, userJid) => {
  try {
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    if (!groupMetadata) {
      logger.error('Não foi possível obter metadados do grupo', { groupJid });
      return false;
    }

    const cleanUserJid = userJid.replace(/:\d+/, '');
    const participants = groupMetadata.participants || [];

    const userParticipant = participants.find((participant) => participant.id.replace(/:\d+/, '') === cleanUserJid);

    return userParticipant && ['admin', 'superadmin'].includes(userParticipant.admin);
  } catch (error) {
    logger.error('Erro ao verificar status de admin do usuário', {
      error: error.message,
      stack: error.stack,
      groupJid,
      userJid,
    });
    return false;
  }
};

/**
 * Verifica se um usuário está no grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} groupJid - ID do grupo
 * @param {String} userJid - ID do usuário
 * @returns {Promise<Boolean>} - True se o usuário estiver no grupo
 */
const isUserInGroup = async (omniZapClient, groupJid, userJid) => {
  try {
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    if (!groupMetadata) {
      logger.error('Não foi possível obter metadados do grupo', { groupJid });
      return false;
    }

    const cleanUserJid = userJid.replace(/:\d+/, '');
    const participants = groupMetadata.participants || [];

    return participants.some((participant) => participant.id.replace(/:\d+/, '') === cleanUserJid);
  } catch (error) {
    logger.error('Erro ao verificar se usuário está no grupo', {
      error: error.message,
      stack: error.stack,
      groupJid,
      userJid,
    });
    return false;
  }
};

/**
 * Formata um número de telefone para o formato JID
 *
 * @param {String} phoneNumber - Número de telefone
 * @returns {String} - Número formatado como JID
 */
const formatPhoneToJid = (phoneNumber) => {
  // Remove caracteres não numéricos
  let cleaned = phoneNumber.replace(/\D/g, '');

  // Se o número não tiver o código do país, assume que é o mesmo do bot (Brasil 55)
  if (cleaned.length <= 11) {
    cleaned = '55' + cleaned;
  }

  return `${cleaned}@s.whatsapp.net`;
};

/**
 * Processa o comando de banimento de usuário
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processBanCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando de banimento', {
    senderJid,
    groupJid,
    args,
  });

  try {
    // Verificar se a mensagem é de um grupo
    if (!groupJid) {
      return {
        success: false,
        message: formatErrorMessage('Comando só disponível em grupos', 'Este comando só pode ser utilizado dentro de grupos.', null),
      };
    }

    // Verificar se o bot é administrador
    const botIsAdmin = await isBotAdmin(omniZapClient, groupJid);
    if (!botIsAdmin) {
      return {
        success: false,
        message: formatErrorMessage('Permissão negada', 'O bot precisa ser administrador do grupo para executar esta ação.', null),
      };
    }

    // Verificar se o usuário que enviou o comando é administrador
    const senderIsAdmin = await isUserAdmin(omniZapClient, groupJid, senderJid);
    if (!senderIsAdmin) {
      return {
        success: false,
        message: formatErrorMessage('Permissão negada', 'Apenas administradores podem usar este comando.', null),
      };
    }

    // Definir variáveis para o usuário a ser banido e o motivo
    let targetUserJid = null;
    let banReason = 'Banido por um administrador';

    // Verificar se é uma mensagem marcada
    if (messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      targetUserJid = messageInfo.message.extendedTextMessage.contextInfo.participant;

      // Extrair o motivo (tudo após o comando)
      if (args && args.trim()) {
        banReason = args.trim();
      }

      // Tentar apagar a mensagem marcada
      try {
        const quotedMessage = {
          id: messageInfo.message.extendedTextMessage.contextInfo.stanzaId,
          remoteJid: groupJid,
          participant: targetUserJid,
        };

        await omniZapClient.sendMessage(groupJid, { delete: quotedMessage });
        logger.info('Mensagem marcada apagada com sucesso', { quotedMessage });
      } catch (deleteError) {
        logger.error('Erro ao apagar mensagem marcada', {
          error: deleteError.message,
          stack: deleteError.stack,
        });
        // Continua com o banimento mesmo se falhar em apagar a mensagem
      }
    } else {
      // Não é uma mensagem marcada, procura por um número nos argumentos
      const argParts = args.split(' ');
      if (!argParts[0]) {
        return {
          success: false,
          message: formatErrorMessage('Usuário não especificado', 'Você deve mencionar um usuário ou responder a uma mensagem dele, ou fornecer o número.', '📋 *Como usar:*\n• Responda a uma mensagem com: !ban motivo\n• Ou envie: !ban número motivo'),
        };
      }

      // O primeiro argumento é o número/menção, o resto é o motivo
      targetUserJid = formatPhoneToJid(argParts[0]);
      if (argParts.length > 1) {
        banReason = argParts.slice(1).join(' ');
      }
    }

    // Verificar se o alvo é um administrador
    const targetIsAdmin = await isUserAdmin(omniZapClient, groupJid, targetUserJid);
    if (targetIsAdmin) {
      return {
        success: false,
        message: formatErrorMessage('Operação não permitida', 'Não é possível banir outro administrador do grupo.', null),
      };
    }

    // Verificar se o usuário está no grupo
    const userInGroup = await isUserInGroup(omniZapClient, groupJid, targetUserJid);
    if (!userInGroup) {
      return {
        success: false,
        message: formatErrorMessage('Usuário não encontrado', 'O usuário informado não está no grupo.', null),
      };
    }

    // Executar o banimento
    logger.info(`Banindo usuário ${targetUserJid} do grupo ${groupJid} - Motivo: ${banReason}`);
    await omniZapClient.groupParticipantsUpdate(groupJid, [targetUserJid], 'remove');

    // Registrar o evento no banco de dados
    await databaseManager.saveEvent('ban', {
      groupJid,
      targetUserJid,
      executorJid: senderJid,
      reason: banReason,
      timestamp: Date.now(),
    });

    // Formatar o número para exibição
    const formattedNumber = targetUserJid.split('@')[0];

    return {
      success: true,
      message: `✅ *Usuário banido com sucesso*\n\n👤 *Número:* ${formattedNumber}\n📝 *Motivo:* ${banReason}\n\n🛡️ Ação executada por administrador.`,
    };
  } catch (error) {
    logger.error('Erro ao processar comando de banimento', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao banir usuário', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

module.exports = {
  processBanCommand,
  isBotAdmin,
  isUserAdmin,
  isUserInGroup,
  formatPhoneToJid,
};
