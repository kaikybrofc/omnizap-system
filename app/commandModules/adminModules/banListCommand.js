/**
 * OmniZap BanList Command
 *
 * Comando para visualizar a lista de usuários banidos
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('../../utils/logger/loggerModule');
const { formatErrorMessage } = require('../../utils/messageUtils');
const { isUserAdmin, getGroupBanHistory, getUserBanHistory, loadBannedUsersList } = require('./banCommand');

/**
 * Processa o comando de listagem de banimentos
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processBanListCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando banlist', {
    senderJid,
    groupJid,
    args,
  });

  try {
    // Se for um grupo, verificar se o usuário é administrador
    if (groupJid) {
      const senderIsAdmin = await isUserAdmin(omniZapClient, groupJid, senderJid);
      if (!senderIsAdmin) {
        return {
          success: false,
          message: formatErrorMessage('Permissão negada', 'Apenas administradores podem consultar a lista de banimentos.', null),
        };
      }
    }

    // Processar argumentos
    const argParts = args.split(' ');
    const subCommand = argParts[0]?.toLowerCase();

    // Se não houver subcomando, mostrar ajuda
    if (!subCommand) {
      return {
        success: true,
        message: `📋 *Lista de Banimentos - Ajuda*\n\n📱 *Comandos disponíveis:*\n• \`grupo\` - Lista banimentos do grupo atual\n• \`user número\` - Busca histórico de banimento de um usuário\n• \`total\` - Estatísticas de banimentos\n\n*Exemplo:* \`banlist grupo\``,
      };
    }

    // Processar subcomandos
    switch (subCommand) {
      case 'grupo':
      case 'group':
        // Verificar se está em um grupo
        if (!groupJid) {
          return {
            success: false,
            message: formatErrorMessage('Erro', 'Este subcomando só pode ser usado dentro de grupos.', null),
          };
        }

        // Buscar histórico de banimentos do grupo
        const groupBans = await getGroupBanHistory(groupJid);

        if (groupBans.length === 0) {
          return {
            success: true,
            message: '📋 *Lista de Banimentos*\n\nNenhum banimento registrado neste grupo.',
          };
        }

        // Formatar a lista de banimentos
        let banList = `📋 *Lista de Banimentos do Grupo*\n\n*Total:* ${groupBans.length} banimento(s)\n\n`;

        // Limitar a 10 banimentos para não exceder o limite de mensagem
        const recentBans = groupBans.slice(-10).reverse();

        for (const ban of recentBans) {
          const userNumber = ban.userJid.split('@')[0];
          const adminNumber = ban.executorJid.split('@')[0];

          banList += `👤 *Usuário:* ${userNumber}\n📝 *Motivo:* ${ban.reason}\n🕒 *Data:* ${ban.formattedDate}\n👮 *Banido por:* ${adminNumber}\n\n`;
        }

        if (groupBans.length > 10) {
          banList += `_Mostrando os 10 banimentos mais recentes de ${groupBans.length} total._`;
        }

        return {
          success: true,
          message: banList,
        };

      case 'user':
      case 'usuario':
      case 'usuário':
        // Verificar se foi fornecido um número
        const phoneNumber = argParts[1];
        if (!phoneNumber) {
          return {
            success: false,
            message: formatErrorMessage('Parâmetro faltando', 'Você precisa fornecer o número do usuário.', '📋 *Exemplo:* banlist user 5511999999999'),
          };
        }

        // Formatar o número para JID
        let userJid = phoneNumber;
        if (!userJid.includes('@')) {
          // Remove caracteres não numéricos
          let cleaned = phoneNumber.replace(/\D/g, '');

          // Se o número não tiver o código do país, assume que é o mesmo do bot (Brasil 55)
          if (cleaned.length <= 11) {
            cleaned = '55' + cleaned;
          }

          userJid = `${cleaned}@s.whatsapp.net`;
        }

        // Buscar histórico do usuário
        const userBans = await getUserBanHistory(userJid);

        if (userBans.length === 0) {
          return {
            success: true,
            message: `📋 *Histórico de Banimentos*\n\nNenhum registro de banimento para o número ${phoneNumber}.`,
          };
        }

        // Formatar o histórico
        let userBanList = `📋 *Histórico de Banimentos*\n\n👤 *Usuário:* ${phoneNumber}\n*Total:* ${userBans.length} banimento(s)\n\n`;

        // Limitar a 5 banimentos para não exceder o limite de mensagem
        const recentUserBans = userBans.slice(-5).reverse();

        for (const ban of recentUserBans) {
          const adminNumber = ban.executorJid.split('@')[0];

          userBanList += `📝 *Motivo:* ${ban.reason}\n🕒 *Data:* ${ban.formattedDate}\n👮 *Banido por:* ${adminNumber}\n\n`;
        }

        if (userBans.length > 5) {
          userBanList += `_Mostrando os 5 banimentos mais recentes de ${userBans.length} total._`;
        }

        return {
          success: true,
          message: userBanList,
        };

      case 'total':
      case 'stats':
      case 'estatisticas':
      case 'estatísticas':
        // Carregar todos os banimentos
        const allBans = await loadBannedUsersList();
        const totalBans = allBans.users.length;

        // Contar grupos únicos
        const uniqueGroups = Object.keys(allBans.groupBans).length;

        // Contar usuários únicos
        const uniqueUsers = new Set(allBans.users.map((ban) => ban.userJid.replace(/:\d+/, ''))).size;

        // Encontrar usuário mais banido
        const userBanCount = {};
        for (const ban of allBans.users) {
          const userJid = ban.userJid.replace(/:\d+/, '');
          userBanCount[userJid] = (userBanCount[userJid] || 0) + 1;
        }

        let mostBannedUser = { jid: null, count: 0 };
        for (const [jid, count] of Object.entries(userBanCount)) {
          if (count > mostBannedUser.count) {
            mostBannedUser = { jid, count };
          }
        }

        // Formatar estatísticas
        let statsMessage = `📊 *Estatísticas de Banimentos*\n\n`;
        statsMessage += `📋 *Total de banimentos:* ${totalBans}\n`;
        statsMessage += `👥 *Grupos com banimentos:* ${uniqueGroups}\n`;
        statsMessage += `👤 *Usuários banidos (únicos):* ${uniqueUsers}\n`;

        if (mostBannedUser.jid) {
          const userNumber = mostBannedUser.jid.split('@')[0];
          statsMessage += `\n🏆 *Usuário mais banido:*\n📱 ${userNumber}\n🔢 ${mostBannedUser.count} banimento(s)`;
        }

        return {
          success: true,
          message: statsMessage,
        };

      default:
        return {
          success: false,
          message: formatErrorMessage('Subcomando inválido', `O subcomando "${subCommand}" não é reconhecido.`, '📋 *Comandos disponíveis:*\n• `grupo` - Lista banimentos do grupo atual\n• `user número` - Busca histórico de banimento de um usuário\n• `total` - Estatísticas de banimentos'),
        };
    }
  } catch (error) {
    logger.error('Erro ao processar comando banlist', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao listar banimentos', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

module.exports = {
  processBanListCommand,
};
