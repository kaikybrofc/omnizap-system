/**
 * OmniZap Admin Commands
 *
 * Comandos de administração para grupos do WhatsApp
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('../../utils/logger/loggerModule');
const { databaseManager } = require('../../database/databaseManager');
const { formatErrorMessage } = require('../../utils/messageUtils');
const fs = require('fs').promises;
const path = require('path');

// Diretório para armazenar a lista de usuários banidos
const BANNED_USERS_DIR = path.join(process.cwd(), 'temp', 'bannedUsers');
const BANNED_USERS_LIST_FILE = path.join(BANNED_USERS_DIR, 'bannedUsers.json');

/**
 * Processa comando para adicionar participantes ao grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando (números a adicionar)
 * @returns {Promise<Object>} - Resultado da operação
 */
const processAddCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando add', { senderJid, groupJid, args });

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

    // Validar os números fornecidos
    if (!args || !args.trim()) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve fornecer pelo menos um número para adicionar ao grupo.', '📋 *Como usar:*\n!add número1 número2 número3...'),
      };
    }

    // Processar os números
    const numbers = args.split(/[\s,;]+/).filter((n) => n.trim());
    if (numbers.length === 0) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros inválidos', 'Números inválidos fornecidos.', '📋 *Como usar:*\n!add 551199999999 551188888888...'),
      };
    }

    // Formatar os números para o formato JID
    const participants = numbers.map((number) => {
      // Remove caracteres não numéricos
      let cleaned = number.replace(/\D/g, '');

      // Se o número não tiver o código do país, assume que é o mesmo do bot (Brasil 55)
      if (cleaned.length <= 11) {
        cleaned = '55' + cleaned;
      }

      return `${cleaned}@s.whatsapp.net`;
    });

    // Adicionar os participantes ao grupo
    logger.info(`Adicionando participantes ao grupo ${groupJid}`, { participants });

    const result = await omniZapClient.groupParticipantsUpdate(groupJid, participants, 'add');

    // Processar resultados
    const successCount = result.filter((r) => r.status === '200').length;
    const failedCount = result.length - successCount;

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('add_participants', {
      groupJid,
      executorJid: senderJid,
      participants,
      result,
      timestamp: Date.now(),
    });

    // Formatar resposta
    let responseMessage = '';
    if (successCount > 0) {
      responseMessage += `✅ *${successCount} participante(s) adicionado(s) com sucesso*\n\n`;
    }

    if (failedCount > 0) {
      responseMessage += `❌ *${failedCount} participante(s) não puderam ser adicionados*\n\nPossíveis motivos:\n• Privacidade do usuário não permite\n• Número inválido\n• Usuário já está no grupo\n• Usuário bloqueou o bot`;
    } else {
      responseMessage += `👥 *Todos os participantes foram adicionados com sucesso!*`;
    }

    return {
      success: true,
      message: responseMessage,
    };
  } catch (error) {
    logger.error('Erro ao processar comando add', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao adicionar participantes', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para promover participantes a administradores
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processPromoteCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando promote', { senderJid, groupJid, args });

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

    // Definir o alvo (usuário a ser promovido)
    let targetUsers = [];

    // Verificar se é uma mensagem marcada
    if (messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quotedParticipant = messageInfo.message.extendedTextMessage.contextInfo.participant;
      targetUsers.push(quotedParticipant);
    } else {
      // Não é uma mensagem marcada, procura por números nos argumentos
      if (!args || !args.trim()) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros insuficientes', 'Você deve mencionar um usuário ou fornecer o número.', '📋 *Como usar:*\n• Responda a uma mensagem com: !promote\n• Ou envie: !promote número1 número2...'),
        };
      }

      // Processar os números
      const numbers = args.split(/[\s,;]+/).filter((n) => n.trim());
      if (numbers.length === 0) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros inválidos', 'Números inválidos fornecidos.', '📋 *Como usar:*\n!promote 551199999999 551188888888...'),
        };
      }

      // Formatar os números para o formato JID
      targetUsers = numbers.map((number) => {
        // Remove caracteres não numéricos
        let cleaned = number.replace(/\D/g, '');

        // Se o número não tiver o código do país, assume que é o mesmo do bot (Brasil 55)
        if (cleaned.length <= 11) {
          cleaned = '55' + cleaned;
        }

        return `${cleaned}@s.whatsapp.net`;
      });
    }

    // Verificar se os usuários estão no grupo
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    const participants = groupMetadata.participants || [];

    const invalidUsers = [];
    const validUsers = [];

    for (const user of targetUsers) {
      const cleanUserJid = user.replace(/:\d+/, '');
      const isInGroup = participants.some((p) => p.id.replace(/:\d+/, '') === cleanUserJid);

      if (isInGroup) {
        validUsers.push(user);
      } else {
        invalidUsers.push(user);
      }
    }

    if (validUsers.length === 0) {
      return {
        success: false,
        message: formatErrorMessage('Usuários não encontrados', 'Nenhum dos usuários especificados está no grupo.', null),
      };
    }

    // Promover os usuários
    logger.info(`Promovendo usuários a administradores no grupo ${groupJid}`, { validUsers });

    await omniZapClient.groupParticipantsUpdate(groupJid, validUsers, 'promote');

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('promote_participants', {
      groupJid,
      executorJid: senderJid,
      promotedUsers: validUsers,
      timestamp: Date.now(),
    });

    // Formatar resposta
    let responseMessage = `✅ *${validUsers.length} usuário(s) promovido(s) a administrador com sucesso*\n\n`;

    if (invalidUsers.length > 0) {
      responseMessage += `⚠️ *${invalidUsers.length} usuário(s) não foram encontrados no grupo*`;
    }

    return {
      success: true,
      message: responseMessage,
    };
  } catch (error) {
    logger.error('Erro ao processar comando promote', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao promover usuários', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para rebaixar administradores para participantes comuns
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processDemoteCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando demote', { senderJid, groupJid, args });

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

    // Definir o alvo (usuário a ser rebaixado)
    let targetUsers = [];

    // Verificar se é uma mensagem marcada
    if (messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quotedParticipant = messageInfo.message.extendedTextMessage.contextInfo.participant;
      targetUsers.push(quotedParticipant);
    } else {
      // Não é uma mensagem marcada, procura por números nos argumentos
      if (!args || !args.trim()) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros insuficientes', 'Você deve mencionar um usuário ou fornecer o número.', '📋 *Como usar:*\n• Responda a uma mensagem com: !demote\n• Ou envie: !demote número1 número2...'),
        };
      }

      // Processar os números
      const numbers = args.split(/[\s,;]+/).filter((n) => n.trim());
      if (numbers.length === 0) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros inválidos', 'Números inválidos fornecidos.', '📋 *Como usar:*\n!demote 551199999999 551188888888...'),
        };
      }

      // Formatar os números para o formato JID
      targetUsers = numbers.map((number) => {
        // Remove caracteres não numéricos
        let cleaned = number.replace(/\D/g, '');

        // Se o número não tiver o código do país, assume que é o mesmo do bot (Brasil 55)
        if (cleaned.length <= 11) {
          cleaned = '55' + cleaned;
        }

        return `${cleaned}@s.whatsapp.net`;
      });
    }

    // Verificar se os usuários estão no grupo e são administradores
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    const participants = groupMetadata.participants || [];

    const invalidUsers = [];
    const notAdminUsers = [];
    const validUsers = [];

    for (const user of targetUsers) {
      const cleanUserJid = user.replace(/:\d+/, '');
      const participant = participants.find((p) => p.id.replace(/:\d+/, '') === cleanUserJid);

      if (!participant) {
        invalidUsers.push(user);
      } else if (!['admin', 'superadmin'].includes(participant.admin)) {
        notAdminUsers.push(user);
      } else {
        validUsers.push(user);
      }
    }

    if (validUsers.length === 0) {
      let errorMessage = 'Não foi possível rebaixar os usuários especificados.';

      if (invalidUsers.length > 0) {
        errorMessage += ' Alguns usuários não estão no grupo.';
      }

      if (notAdminUsers.length > 0) {
        errorMessage += ' Alguns usuários não são administradores.';
      }

      return {
        success: false,
        message: formatErrorMessage('Operação não permitida', errorMessage, null),
      };
    }

    // Rebaixar os usuários
    logger.info(`Rebaixando administradores no grupo ${groupJid}`, { validUsers });

    await omniZapClient.groupParticipantsUpdate(groupJid, validUsers, 'demote');

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('demote_participants', {
      groupJid,
      executorJid: senderJid,
      demotedUsers: validUsers,
      timestamp: Date.now(),
    });

    // Formatar resposta
    let responseMessage = `✅ *${validUsers.length} administrador(es) rebaixado(s) com sucesso*\n\n`;

    if (invalidUsers.length > 0 || notAdminUsers.length > 0) {
      responseMessage += `⚠️ *Informações adicionais:*\n`;

      if (invalidUsers.length > 0) {
        responseMessage += `• ${invalidUsers.length} usuário(s) não encontrados no grupo\n`;
      }

      if (notAdminUsers.length > 0) {
        responseMessage += `• ${notAdminUsers.length} usuário(s) já não eram administradores`;
      }
    }

    return {
      success: true,
      message: responseMessage,
    };
  } catch (error) {
    logger.error('Erro ao processar comando demote', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao rebaixar administradores', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para alterar o nome do grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando (novo nome)
 * @returns {Promise<Object>} - Resultado da operação
 */
const processSetNameCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando setname', { senderJid, groupJid, args });

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

    // Validar o novo nome
    if (!args || !args.trim()) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve fornecer o novo nome para o grupo.', '📋 *Como usar:*\n!setname Novo Nome do Grupo'),
      };
    }

    const newName = args.trim();

    // Verificar tamanho do nome (WhatsApp tem limites)
    if (newName.length > 128) {
      return {
        success: false,
        message: formatErrorMessage('Nome muito longo', 'O nome do grupo não pode exceder 128 caracteres.', null),
      };
    }

    // Alterar o nome do grupo
    logger.info(`Alterando nome do grupo ${groupJid} para "${newName}"`, { oldGroupJid: groupJid });

    await omniZapClient.groupUpdateSubject(groupJid, newName);

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('change_group_name', {
      groupJid,
      executorJid: senderJid,
      oldName: (await databaseManager.getGroupMetadata(groupJid))?.subject || 'Desconhecido',
      newName,
      timestamp: Date.now(),
    });

    return {
      success: true,
      message: `✅ *Nome do grupo alterado com sucesso*\n\n📝 *Novo nome:* ${newName}`,
    };
  } catch (error) {
    logger.error('Erro ao processar comando setname', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao alterar nome do grupo', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para alterar a descrição do grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando (nova descrição)
 * @returns {Promise<Object>} - Resultado da operação
 */
const processSetDescCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando setdesc', { senderJid, groupJid, args });

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

    // Validar a nova descrição
    if (!args) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve fornecer a nova descrição para o grupo.', '📋 *Como usar:*\n!setdesc Nova descrição do grupo\n\nOu deixe vazio para remover: !setdesc'),
      };
    }

    const newDesc = args.trim();

    // Verificar tamanho da descrição (WhatsApp tem limites)
    if (newDesc.length > 512) {
      return {
        success: false,
        message: formatErrorMessage('Descrição muito longa', 'A descrição do grupo não pode exceder 512 caracteres.', null),
      };
    }

    // Alterar a descrição do grupo
    logger.info(`Alterando descrição do grupo ${groupJid}`, { descLength: newDesc.length });

    await omniZapClient.groupUpdateDescription(groupJid, newDesc);

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('change_group_desc', {
      groupJid,
      executorJid: senderJid,
      oldDesc: (await databaseManager.getGroupMetadata(groupJid))?.desc || '',
      newDesc,
      timestamp: Date.now(),
    });

    return {
      success: true,
      message: newDesc ? `✅ *Descrição do grupo alterada com sucesso*\n\n📝 *Nova descrição:*\n${newDesc}` : `✅ *Descrição do grupo removida com sucesso*`,
    };
  } catch (error) {
    logger.error('Erro ao processar comando setdesc', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao alterar descrição do grupo', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para configurar o grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processGroupSettingCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando group', { senderJid, groupJid, args });

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

    // Verificar argumentos
    if (!args || !args.trim()) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve especificar uma ação.', '📋 *Como usar:*\n!group close - Somente admins podem enviar mensagens\n!group open - Todos podem enviar mensagens\n!group lock - Somente admins podem modificar o grupo\n!group unlock - Todos podem modificar o grupo'),
      };
    }

    const action = args.trim().toLowerCase();
    let setting = '';
    let description = '';

    switch (action) {
      case 'close':
      case 'fechar':
      case 'close':
        setting = 'announcement';
        description = 'Somente administradores podem enviar mensagens';
        break;
      case 'open':
      case 'abrir':
      case 'open':
        setting = 'not_announcement';
        description = 'Todos os participantes podem enviar mensagens';
        break;
      case 'lock':
      case 'trancar':
      case 'bloquear':
        setting = 'locked';
        description = 'Somente administradores podem modificar as configurações do grupo';
        break;
      case 'unlock':
      case 'destrancar':
      case 'desbloquear':
        setting = 'unlocked';
        description = 'Todos os participantes podem modificar as configurações do grupo';
        break;
      default:
        return {
          success: false,
          message: formatErrorMessage('Ação inválida', 'Ação não reconhecida.', '📋 *Ações disponíveis:*\n• close/fechar - Somente admins enviam mensagens\n• open/abrir - Todos enviam mensagens\n• lock/trancar - Somente admins modificam o grupo\n• unlock/destrancar - Todos modificam o grupo'),
        };
    }

    // Alterar configuração do grupo
    logger.info(`Alterando configurações do grupo ${groupJid} para "${setting}"`, { action });

    await omniZapClient.groupSettingUpdate(groupJid, setting);

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('change_group_setting', {
      groupJid,
      executorJid: senderJid,
      setting,
      action,
      timestamp: Date.now(),
    });

    return {
      success: true,
      message: `✅ *Configurações do grupo atualizadas*\n\n📝 *Nova configuração:* ${description}`,
    };
  } catch (error) {
    logger.error('Erro ao processar comando group', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao alterar configurações do grupo', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para obter o link de convite do grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processLinkCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando link', { senderJid, groupJid, args });

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

    // Verificar se o argumento é "reset" para redefnir o link
    const shouldReset = args && ['reset', 'revoke', 'new', 'novo', 'resetar', 'revogar'].includes(args.trim().toLowerCase());

    let code;
    if (shouldReset) {
      // Revogar e obter novo código
      logger.info(`Revogando e gerando novo link de convite para o grupo ${groupJid}`);
      code = await omniZapClient.groupRevokeInvite(groupJid);

      // Registrar evento no banco de dados
      await databaseManager.saveEvent('revoke_group_link', {
        groupJid,
        executorJid: senderJid,
        timestamp: Date.now(),
      });
    } else {
      // Apenas obter o código atual
      logger.info(`Obtendo link de convite para o grupo ${groupJid}`);
      code = await omniZapClient.groupInviteCode(groupJid);
    }

    // Formar a URL completa
    const inviteLink = `https://chat.whatsapp.com/${code}`;

    return {
      success: true,
      message: shouldReset ? `🔄 *Link do grupo foi redefinido*\n\n🔗 *Novo link:*\n${inviteLink}` : `🔗 *Link do grupo:*\n${inviteLink}${senderIsAdmin ? '\n\n_Use !link reset para gerar um novo link_' : ''}`,
    };
  } catch (error) {
    logger.error('Erro ao processar comando link', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao obter link do grupo', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para definir o modo de mensagens temporárias (efêmeras)
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processEphemeralCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando ephemeral', { senderJid, groupJid, args });

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

    // Verificar argumentos
    if (!args || !args.trim()) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve especificar uma duração.', '📋 *Como usar:*\n!ephemeral off - Desativar mensagens temporárias\n!ephemeral 24h - Mensagens somem em 24 horas\n!ephemeral 7d - Mensagens somem em 7 dias\n!ephemeral 90d - Mensagens somem em 90 dias'),
      };
    }

    const duration = args.trim().toLowerCase();
    let seconds = 0;
    let durationText = '';

    switch (duration) {
      case 'off':
      case 'disable':
      case 'desativar':
      case 'desligado':
        seconds = 0;
        durationText = 'Desativado';
        break;
      case '24h':
      case '24 horas':
      case '1d':
      case '1 dia':
        seconds = 86400; // 24 horas
        durationText = '24 horas';
        break;
      case '7d':
      case '7 dias':
      case '1w':
      case '1 semana':
        seconds = 604800; // 7 dias
        durationText = '7 dias';
        break;
      case '90d':
      case '90 dias':
      case '3m':
      case '3 meses':
        seconds = 7776000; // 90 dias
        durationText = '90 dias';
        break;
      default:
        return {
          success: false,
          message: formatErrorMessage('Duração inválida', 'Duração não reconhecida.', '📋 *Durações disponíveis:*\n• off - Desativar mensagens temporárias\n• 24h - Mensagens somem em 24 horas\n• 7d - Mensagens somem em 7 dias\n• 90d - Mensagens somem em 90 dias'),
        };
    }

    // Configurar modo efêmero
    logger.info(`Configurando mensagens efêmeras no grupo ${groupJid} para ${seconds} segundos`);

    await omniZapClient.groupToggleEphemeral(groupJid, seconds);

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('set_ephemeral', {
      groupJid,
      executorJid: senderJid,
      seconds,
      duration,
      timestamp: Date.now(),
    });

    const responseMessage = seconds === 0 ? `✅ *Mensagens temporárias desativadas*\n\nAs mensagens não desaparecerão automaticamente.` : `✅ *Mensagens temporárias ativadas*\n\n⏱️ *Duração:* ${durationText}\n\nAs novas mensagens desaparecerão automaticamente após ${durationText}.`;

    return {
      success: true,
      message: responseMessage,
    };
  } catch (error) {
    logger.error('Erro ao processar comando ephemeral', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao configurar mensagens temporárias', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para definir o modo de adição ao grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processAddModeCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando addmode', { senderJid, groupJid, args });

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

    // Verificar argumentos
    if (!args || !args.trim()) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve especificar um modo.', '📋 *Como usar:*\n!addmode all - Todos podem adicionar participantes\n!addmode admin - Somente admins podem adicionar participantes'),
      };
    }

    const mode = args.trim().toLowerCase();
    let settingMode = '';
    let description = '';

    switch (mode) {
      case 'all':
      case 'everyone':
      case 'todos':
      case 'cualquiera':
        settingMode = 'all_member_add';
        description = 'Todos os participantes podem adicionar novos membros';
        break;
      case 'admin':
      case 'admins':
      case 'administradores':
        settingMode = 'admin_add';
        description = 'Somente administradores podem adicionar novos membros';
        break;
      default:
        return {
          success: false,
          message: formatErrorMessage('Modo inválido', 'Modo não reconhecido.', '📋 *Modos disponíveis:*\n• all/todos - Todos podem adicionar participantes\n• admin/admins - Somente administradores podem adicionar participantes'),
        };
    }

    // Configurar modo de adição
    logger.info(`Configurando modo de adição de participantes no grupo ${groupJid} para ${settingMode}`);

    await omniZapClient.groupMemberAddMode(groupJid, settingMode);

    // Registrar evento no banco de dados
    await databaseManager.saveEvent('set_add_mode', {
      groupJid,
      executorJid: senderJid,
      mode: settingMode,
      timestamp: Date.now(),
    });

    return {
      success: true,
      message: `✅ *Modo de adição atualizado*\n\n📝 *Nova configuração:* ${description}`,
    };
  } catch (error) {
    logger.error('Erro ao processar comando addmode', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao configurar modo de adição', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
};

/**
 * Processa comando para obter informações do grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} messageInfo - Informações da mensagem
 * @param {String} senderJid - JID do remetente
 * @param {String} groupJid - JID do grupo
 * @param {String} args - Argumentos do comando
 * @returns {Promise<Object>} - Resultado da operação
 */
const processGroupInfoCommand = async (omniZapClient, messageInfo, senderJid, groupJid, args) => {
  logger.info('Processando comando groupinfo', { senderJid, groupJid, args });

  try {
    // Verificar se a mensagem é de um grupo
    if (!groupJid) {
      return {
        success: false,
        message: formatErrorMessage('Comando só disponível em grupos', 'Este comando só pode ser utilizado dentro de grupos.', null),
      };
    }

    // Obter metadados do grupo
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    if (!groupMetadata) {
      return {
        success: false,
        message: formatErrorMessage('Erro ao obter informações', 'Não foi possível obter os metadados do grupo.', null),
      };
    }

    const { subject, desc, owner, participants = [], creation, restrict, announce, ephemeralDuration } = groupMetadata;

    // Contar participantes por tipo
    const adminCount = participants.filter((p) => ['admin', 'superadmin'].includes(p.admin)).length;
    const memberCount = participants.length - adminCount;

    // Formatar data de criação
    const creationDate = creation ? new Date(creation * 1000).toLocaleString('pt-BR') : 'Desconhecido';

    // Formatar duração das mensagens efêmeras
    let ephemeralText = 'Desativado';
    if (ephemeralDuration) {
      if (ephemeralDuration === 86400) ephemeralText = '24 horas';
      else if (ephemeralDuration === 604800) ephemeralText = '7 dias';
      else if (ephemeralDuration === 7776000) ephemeralText = '90 dias';
      else ephemeralText = `${ephemeralDuration} segundos`;
    }

    // Formatar configurações
    const restrictText = restrict ? 'Somente admins podem editar' : 'Todos podem editar';
    const announceText = announce ? 'Somente admins podem enviar mensagens' : 'Todos podem enviar mensagens';

    // Obter link do grupo (se bot for admin)
    let inviteLink = '';
    try {
      if (await isBotAdmin(omniZapClient, groupJid)) {
        const code = await omniZapClient.groupInviteCode(groupJid);
        inviteLink = `\n🔗 *Link de convite:* https://chat.whatsapp.com/${code}`;
      }
    } catch (error) {
      logger.warn('Erro ao obter link do grupo', { error: error.message, groupJid });
    }

    // Formatar resposta
    const infoMessage = `📊 *INFORMAÇÕES DO GRUPO*\n\n` + `📝 *Nome:* ${subject}\n` + `👥 *Participantes:* ${participants.length} (${adminCount} admins, ${memberCount} membros)\n` + `👑 *Criador:* ${owner ? '+' + owner.split('@')[0] : 'Desconhecido'}\n` + `📅 *Criado em:* ${creationDate}\n` + `⚙️ *Configurações:*\n` + `  • ${restrictText}\n` + `  • ${announceText}\n` + `⏱️ *Mensagens temporárias:* ${ephemeralText}` + `${inviteLink}\n\n` + `📄 *Descrição:*\n${desc || 'Sem descrição'}`;

    return {
      success: true,
      message: infoMessage,
    };
  } catch (error) {
    logger.error('Erro ao processar comando groupinfo', {
      error: error.message,
      stack: error.stack,
      senderJid,
      groupJid,
      args,
    });

    return {
      success: false,
      message: formatErrorMessage('Erro ao obter informações do grupo', `Ocorreu um erro ao processar o comando: ${error.message}`, null),
    };
  }
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

    // Adicionar o usuário à lista de banidos
    await addUserToBannedList(targetUserJid, groupJid, senderJid, banReason);

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

/**
 * Verifica se um usuário é administrador do grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} groupJid - ID do grupo
 * @param {String} userJid - ID do usuário
 * @returns {Promise<Boolean>} - True se o usuário for administrador
 */
const isUserAdmin = async (omniZapClient, groupJid, userJid) => {
  try {
    // Obter metadados do grupo
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    const participants = groupMetadata.participants || [];

    const cleanUserJid = userJid.replace(/:\d+/, '');
    const member = participants.find((p) => p.id.replace(/:\d+/, '') === cleanUserJid);

    return member ? ['admin', 'superadmin'].includes(member.admin) : false;
  } catch (error) {
    logger.error('Erro ao verificar administrador', {
      error: error.message,
      stack: error.stack,
      groupJid,
      userJid,
    });
    return false;
  }
};

/**
 * Verifica se o bot é administrador do grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} groupJid - ID do grupo
 * @returns {Promise<Boolean>} - True se o bot for administrador
 */
const isBotAdmin = async (omniZapClient, groupJid) => {
  try {
    // Obter metadados do grupo
    const groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    const participants = groupMetadata.participants || [];

    // O JID do bot é conhecido, pois é a conta que está rodando o cliente
    const botJid = omniZapClient.info.wid;

    const adminParticipant = participants.find((p) => p.id === botJid);

    return adminParticipant ? ['admin', 'superadmin'].includes(adminParticipant.admin) : false;
  } catch (error) {
    logger.error('Erro ao verificar administrador do bot', {
      error: error.message,
      stack: error.stack,
      groupJid,
    });
    return false;
  }
};

/**
 * Verifica se um usuário está em um grupo
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} groupJid - ID do grupo
 * @param {String} userJid - ID do usuário
 * @returns {Promise<Boolean>} - True se o usuário estiver no grupo
 */
const isUserInGroup = async (omniZapClient, groupJid, userJid) => {
  try {
    // Tenta obter metadados diretamente da API Baileys primeiro
    let groupMetadata;
    try {
      groupMetadata = await omniZapClient.groupMetadata(groupJid);
      logger.info('Obteve metadados do grupo diretamente da API', { groupJid });
    } catch (apiError) {
      logger.warn('Erro ao obter metadados do grupo da API, tentando banco de dados', {
        error: apiError.message,
        groupJid,
      });
      // Fallback para o banco de dados
      groupMetadata = await databaseManager.getOrFetchGroupMetadata(groupJid, omniZapClient);
    }

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
 * Carrega a lista de usuários banidos do arquivo
 *
 * @returns {Promise<Object>} - Lista de usuários banidos
 */
const loadBannedUsersList = async () => {
  try {
    // Criar diretório se não existir
    try {
      await fs.mkdir(BANNED_USERS_DIR, { recursive: true });
    } catch (mkdirError) {
      logger.error('Erro ao criar diretório de usuários banidos', {
        error: mkdirError.message,
        stack: mkdirError.stack,
        dir: BANNED_USERS_DIR,
      });
    }

    // Ler arquivo
    const fileData = await fs.readFile(BANNED_USERS_LIST_FILE, 'utf8');
    return JSON.parse(fileData);
  } catch (error) {
    // Se o arquivo não existir, retorna estrutura padrão
    logger.info('Criando nova lista de usuários banidos', { error: error.message });
    return {
      users: [],
      groupBans: {},
    };
  }
};

/**
 * Salva a lista de usuários banidos no arquivo
 *
 * @param {Object} bannedList - Lista de usuários banidos
 * @returns {Promise<void>}
 */
const saveBannedUsersList = async (bannedList) => {
  try {
    // Criar diretório se não existir
    await fs.mkdir(BANNED_USERS_DIR, { recursive: true });

    // Salvar arquivo
    await fs.writeFile(BANNED_USERS_LIST_FILE, JSON.stringify(bannedList, null, 2), 'utf8');
    logger.info('Lista de usuários banidos salva com sucesso', {
      filePath: BANNED_USERS_LIST_FILE,
      userCount: bannedList.users.length,
    });
  } catch (error) {
    logger.error('Erro ao salvar lista de usuários banidos', {
      error: error.message,
      stack: error.stack,
      filePath: BANNED_USERS_LIST_FILE,
    });
  }
};

/**
 * Adiciona um usuário à lista de banidos
 *
 * @param {String} userJid - JID do usuário banido
 * @param {String} groupJid - JID do grupo onde ocorreu o banimento
 * @param {String} executorJid - JID do administrador que executou o ban
 * @param {String} reason - Motivo do banimento
 * @returns {Promise<void>}
 */
const addUserToBannedList = async (userJid, groupJid, executorJid, reason) => {
  try {
    // Carregar lista atual
    const bannedList = await loadBannedUsersList();

    // Data formatada
    const now = new Date();
    const formattedDate = now.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Adicionar entrada à lista geral
    const banEntry = {
      userJid,
      groupJid,
      executorJid,
      reason,
      timestamp: Date.now(),
      formattedDate,
    };

    bannedList.users.push(banEntry);

    // Adicionar entrada ao grupo específico
    if (!bannedList.groupBans[groupJid]) {
      bannedList.groupBans[groupJid] = [];
    }
    bannedList.groupBans[groupJid].push(banEntry);

    // Salvar lista atualizada
    await saveBannedUsersList(bannedList);

    logger.info('Usuário adicionado à lista de banidos', {
      userJid,
      groupJid,
      executorJid,
      reason,
    });
  } catch (error) {
    logger.error('Erro ao adicionar usuário à lista de banidos', {
      error: error.message,
      stack: error.stack,
      userJid,
      groupJid,
    });
  }
};

/**
 * Remove um usuário da lista de banidos
 *
 * @param {String} userJid - JID do usuário a ser removido
 * @returns {Promise<Boolean>} - True se removido com sucesso
 */
const removeUserFromBanList = async (userJid) => {
  try {
    // Carregar lista atual
    const bannedList = await loadBannedUsersList();

    // Verificar se o usuário está na lista
    const userIndex = bannedList.users.findIndex((ban) => ban.userJid === userJid);
    if (userIndex === -1) {
      logger.warn('Tentativa de remover usuário não banido', { userJid });
      return false;
    }

    // Remover da lista geral
    bannedList.users.splice(userIndex, 1);

    // Remover de todos os grupos
    for (const groupJid in bannedList.groupBans) {
      bannedList.groupBans[groupJid] = bannedList.groupBans[groupJid].filter((ban) => ban.userJid !== userJid);
    }

    // Salvar lista atualizada
    await saveBannedUsersList(bannedList);

    logger.info('Usuário removido da lista de banidos', { userJid });
    return true;
  } catch (error) {
    logger.error('Erro ao remover usuário da lista de banidos', {
      error: error.message,
      stack: error.stack,
      userJid,
    });
    return false;
  }
};

/**
 * Obtém a lista completa de usuários banidos
 *
 * @returns {Promise<Array>} - Lista de usuários banidos
 */
const getBannedUsersList = async () => {
  try {
    const bannedList = await loadBannedUsersList();
    return bannedList.users;
  } catch (error) {
    logger.error('Erro ao obter lista de usuários banidos', {
      error: error.message,
      stack: error.stack,
    });
    return [];
  }
};

/**
 * Obtém o histórico de banimentos de um usuário específico
 *
 * @param {String} userJid - JID do usuário
 * @returns {Promise<Array>} - Histórico de banimentos
 */
const getUserBanHistory = async (userJid) => {
  try {
    const bannedList = await loadBannedUsersList();
    const cleanUserJid = userJid.replace(/:\d+/, '');
    return bannedList.users.filter((ban) => ban.userJid.replace(/:\d+/, '') === cleanUserJid);
  } catch (error) {
    logger.error('Erro ao obter histórico de banimentos do usuário', {
      error: error.message,
      stack: error.stack,
      userJid,
    });
    return [];
  }
};

/**
 * Obtém a lista de banimentos de um grupo específico
 *
 * @param {String} groupJid - JID do grupo
 * @returns {Promise<Array>} - Lista de banimentos do grupo
 */
const getGroupBanHistory = async (groupJid) => {
  try {
    const bannedList = await loadBannedUsersList();
    return bannedList.groupBans[groupJid] || [];
  } catch (error) {
    logger.error('Erro ao obter lista de banimentos do grupo', {
      error: error.message,
      stack: error.stack,
      groupJid,
    });
    return [];
  }
};

/**
 * Formata um número de telefone para o formato JID
 *
 * @param {String} phoneNumber - Número de telefone
 * @returns {String} - JID formatado
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

module.exports = {
  processAddCommand,
  processPromoteCommand,
  processDemoteCommand,
  processSetNameCommand,
  processSetDescCommand,
  processGroupSettingCommand,
  processLinkCommand,
  processEphemeralCommand,
  processAddModeCommand,
  processGroupInfoCommand,
  processBanCommand,
  processBanListCommand,
  isBotAdmin,
  isUserAdmin,
  isUserInGroup,
  formatPhoneToJid,
  addUserToBannedList,
  removeUserFromBanList,
  getBannedUsersList,
  loadBannedUsersList,
  saveBannedUsersList,
  getUserBanHistory,
  getGroupBanHistory,
};
