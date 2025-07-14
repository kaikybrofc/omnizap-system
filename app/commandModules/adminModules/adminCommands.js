/**
 * OmniZap Admin Commands
 *
 * Comandos de administração para grupos do WhatsApp
 * Usando dados centralizados do socket na pasta data
 *
 * @version 1.5.0
 * @author OmniZap Team
 * @license MIT
 * @source https://www.npmjs.com/package/baileys
 *
 */

const logger = require('../../utils/logger/loggerModule');
const { formatErrorMessage } = require('../../utils/messageUtils');
const { isUserAdmin, isBotAdmin, isUserInGroup, formatPhoneToJid, getGroupMetadata, logGroupActivity, cleanJid, getValidParticipants } = require('../../utils/groupGlobalUtils');
const fs = require('fs').promises;
const path = require('path');
const BANNED_USERS_FILE = path.join(__dirname, '../../../temp/data/banned_users.json');

/**
 * === FUNÇÕES DE SISTEMA DE BANIMENTO ===
 */

/**
 * Carrega a lista de usuários banidos
 * @returns {Promise<Object>} - Lista de usuários banidos
 */
const loadBannedUsersList = async () => {
  try {
    const data = await fs.readFile(BANNED_USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const defaultStructure = {
        users: [],
        groupBans: {},
        lastUpdated: Date.now(),
      };
      try {
        await fs.writeFile(BANNED_USERS_FILE, JSON.stringify(defaultStructure, null, 2), 'utf8');
      } catch (writeError) {
        logger.warn('Erro ao criar arquivo de banimentos', { error: writeError.message });
      }

      return defaultStructure;
    }
    logger.error('Erro ao carregar lista de banidos', { error: error.message });
    return { users: [], groupBans: {}, lastUpdated: Date.now() };
  }
};

/**
 * Salva a lista de usuários banidos
 * @param {Object} bannedData - Dados de banimento
 * @returns {Promise<void>}
 */
const saveBannedUsersList = async (bannedData) => {
  try {
    bannedData.lastUpdated = Date.now();
    await fs.writeFile(BANNED_USERS_FILE, JSON.stringify(bannedData, null, 2), 'utf8');
    logger.debug('Lista de banimentos salva com sucesso');
  } catch (error) {
    logger.error('Erro ao salvar lista de banimentos', { error: error.message });
  }
};

/**
 * Adiciona um usuário à lista de banidos
 * @param {string} userJid - JID do usuário
 * @param {string} groupJid - JID do grupo
 * @param {string} executorJid - JID do executor do banimento
 * @param {string} reason - Motivo do banimento
 * @returns {Promise<void>}
 */
const addUserToBannedList = async (userJid, groupJid, executorJid, reason) => {
  try {
    const bannedData = await loadBannedUsersList();

    const banEntry = {
      userJid,
      groupJid,
      executorJid,
      reason,
      timestamp: Date.now(),
      formattedDate: new Date().toLocaleString('pt-BR'),
    };

    bannedData.users.push(banEntry);

    if (!bannedData.groupBans[groupJid]) {
      bannedData.groupBans[groupJid] = [];
    }
    bannedData.groupBans[groupJid].push(banEntry);

    await saveBannedUsersList(bannedData);

    logger.info('Usuário adicionado à lista de banimentos', {
      userJid,
      groupJid,
      executorJid,
      reason,
    });
  } catch (error) {
    logger.error('Erro ao adicionar usuário à lista de banimentos', {
      error: error.message,
      userJid,
      groupJid,
      executorJid,
      reason,
    });
  }
};

/**
 * Obtém histórico de banimentos de um grupo
 * @param {string} groupJid - JID do grupo
 * @returns {Promise<Array>} - Lista de banimentos do grupo
 */
const getGroupBanHistory = async (groupJid) => {
  try {
    const bannedData = await loadBannedUsersList();
    return bannedData.groupBans[groupJid] || [];
  } catch (error) {
    logger.error('Erro ao obter histórico de banimentos do grupo', {
      error: error.message,
      groupJid,
    });
    return [];
  }
};

/**
 * Obtém histórico de banimentos de um usuário
 * @param {string} userJid - JID do usuário
 * @returns {Promise<Array>} - Lista de banimentos do usuário
 */
const getUserBanHistory = async (userJid) => {
  try {
    const bannedData = await loadBannedUsersList();
    return bannedData.users.filter((ban) => ban.userJid === userJid);
  } catch (error) {
    logger.error('Erro ao obter histórico de banimentos do usuário', {
      error: error.message,
      userJid,
    });
    return [];
  }
};

/**
 * Verifica se um usuário está banido em um grupo
 * @param {string} userJid - JID do usuário
 * @param {string} groupJid - JID do grupo
 * @returns {Promise<boolean>} - True se o usuário está banido
 */
const isUserBanned = async (userJid, groupJid) => {
  try {
    const groupBans = await getGroupBanHistory(groupJid);
    return groupBans.some((ban) => ban.userJid === userJid);
  } catch (error) {
    logger.error('Erro ao verificar se usuário está banido', {
      error: error.message,
      userJid,
      groupJid,
    });
    return false;
  }
};

/**
 * === FUNÇÕES AUXILIARES ===
 */

/**
 * Valida se o comando pode ser executado (permissões de grupo e admin)
 * @param {string} groupJid - JID do grupo
 * @param {string} senderJid - JID do remetente
 * @param {boolean} requiresBotAdmin - Se o bot precisa ser admin (padrão: true)
 * @returns {Promise<Object|null>} - Retorna erro se inválido, null se válido
 */
const validateAdminCommand = async (groupJid, senderJid, requiresBotAdmin = true) => {
  if (!groupJid) {
    return {
      success: false,
      message: formatErrorMessage('Comando só disponível em grupos', 'Este comando só pode ser utilizado dentro de grupos.', null),
    };
  }

  if (requiresBotAdmin) {
    const botIsAdmin = await isBotAdmin(groupJid);
    if (!botIsAdmin) {
      return {
        success: false,
        message: formatErrorMessage('Permissão negada', 'O bot precisa ser administrador do grupo para executar esta ação.', null),
      };
    }
  }

  const senderIsAdmin = await isUserAdmin(groupJid, senderJid);
  if (!senderIsAdmin) {
    return {
      success: false,
      message: formatErrorMessage('Permissão negada', 'Apenas administradores podem usar este comando.', null),
    };
  }

  return null;
};

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

    if (!args || !args.trim()) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve fornecer pelo menos um número para adicionar ao grupo.', null),
      };
    }

    const numbers = args.split(/[\s,;]+/).filter((n) => n.trim());
    if (numbers.length === 0) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros inválidos', 'Números inválidos fornecidos.', '📋 *Como usar:*\n!add 551199999999 551188888888...'),
      };
    }

    const participants = numbers.map((number) => formatPhoneToJid(number));

    logger.info(`Adicionando participantes ao grupo ${groupJid}`, { participants });

    const result = await omniZapClient.groupParticipantsUpdate(groupJid, participants, 'add');

    const successCount = result.filter((r) => r.status === '200').length;
    const failedCount = result.length - successCount;

    try {
      const eventLog = {
        type: 'add_participants',
        groupJid,
        executorJid: senderJid,
        participants,
        result,
        timestamp: Date.now(),
      };
      logger.info('Evento de adição de participantes registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

    let targetUsers = [];

    if (messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quotedParticipant = messageInfo.message.extendedTextMessage.contextInfo.participant;
      targetUsers.push(quotedParticipant);
    } else {
      if (!args || !args.trim()) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros insuficientes', 'Você deve mencionar um usuário ou fornecer o número.', '📋 *Como usar:*\n• Responda a uma mensagem com: !promote\n• Ou envie: !promote número1 número2...'),
        };
      }

      const numbers = args.split(/[\s,;]+/).filter((n) => n.trim());
      if (numbers.length === 0) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros inválidos', 'Números inválidos fornecidos.', '📋 *Como usar:*\n!promote 551199999999 551188888888...'),
        };
      }

      targetUsers = numbers.map((number) => formatPhoneToJid(number));
    }

    const groupMetadata = await getGroupMetadata(groupJid);
    const participants = groupMetadata?.participants || [];

    const invalidUsers = [];
    const validUsers = [];

    for (const user of targetUsers) {
      const cleanUserJid = cleanJid(user);
      const validParticipants = getValidParticipants(participants);
      const isInGroup = validParticipants.some((p) => cleanJid(p.id) === cleanUserJid);

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

    logger.info(`Promovendo usuários a administradores no grupo ${groupJid}`, { validUsers });

    await omniZapClient.groupParticipantsUpdate(groupJid, validUsers, 'promote');

    await logGroupActivity(groupJid, 'promote_action', {
      executorJid: senderJid,
      targetUsers: validUsers,
      count: validUsers.length,
    });

    try {
      const eventLog = {
        type: 'promote_participants',
        groupJid,
        executorJid: senderJid,
        promotedUsers: validUsers,
        timestamp: Date.now(),
      };
      logger.info('Evento de promoção de participantes registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

    let targetUsers = [];

    if (messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quotedParticipant = messageInfo.message.extendedTextMessage.contextInfo.participant;
      targetUsers.push(quotedParticipant);
    } else {
      if (!args || !args.trim()) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros insuficientes', 'Você deve mencionar um usuário ou fornecer o número.', '📋 *Como usar:*\n• Responda a uma mensagem com: !demote\n• Ou envie: !demote número1 número2...'),
        };
      }

      const numbers = args.split(/[\s,;]+/).filter((n) => n.trim());
      if (numbers.length === 0) {
        return {
          success: false,
          message: formatErrorMessage('Parâmetros inválidos', 'Números inválidos fornecidos.', '📋 *Como usar:*\n!demote 551199999999 551188888888...'),
        };
      }

      targetUsers = numbers.map((number) => formatPhoneToJid(number));
    }

    const groupMetadata = await getGroupMetadata(groupJid);
    const participants = groupMetadata?.participants || [];

    const invalidUsers = [];
    const notAdminUsers = [];
    const validUsers = [];

    for (const user of targetUsers) {
      const cleanUserJid = cleanJid(user);
      const validParticipants = getValidParticipants(participants);
      const participant = validParticipants.find((p) => cleanJid(p.id) === cleanUserJid);

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

    logger.info(`Rebaixando administradores no grupo ${groupJid}`, { validUsers });

    await omniZapClient.groupParticipantsUpdate(groupJid, validUsers, 'demote');

    try {
      const eventLog = {
        type: 'demote_participants',
        groupJid,
        executorJid: senderJid,
        demotedUsers: validUsers,
        timestamp: Date.now(),
      };
      logger.info('Evento de rebaixamento de participantes registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

    if (!args || !args.trim()) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve fornecer o novo nome para o grupo.', '📋 *Como usar:*\n!setname Novo Nome do Grupo'),
      };
    }

    const newName = args.trim();

    if (newName.length > 128) {
      return {
        success: false,
        message: formatErrorMessage('Nome muito longo', 'O nome do grupo não pode exceder 128 caracteres.', null),
      };
    }

    logger.info(`Alterando nome do grupo ${groupJid} para "${newName}"`, { oldGroupJid: groupJid });

    await omniZapClient.groupUpdateSubject(groupJid, newName);

    try {
      const oldGroupMetadata = await getGroupMetadata(groupJid);
      const oldName = oldGroupMetadata?.subject || 'Desconhecido';

      const eventLog = {
        type: 'change_group_name',
        groupJid,
        executorJid: senderJid,
        oldName,
        newName,
        timestamp: Date.now(),
      };
      logger.info('Evento de alteração de nome do grupo registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

    if (!args) {
      return {
        success: false,
        message: formatErrorMessage('Parâmetros insuficientes', 'Você deve fornecer a nova descrição para o grupo.', '📋 *Como usar:*\n!setdesc Nova descrição do grupo\n\nOu deixe vazio para remover: !setdesc'),
      };
    }

    const newDesc = args.trim();

    if (newDesc.length > 512) {
      return {
        success: false,
        message: formatErrorMessage('Descrição muito longa', 'A descrição do grupo não pode exceder 512 caracteres.', null),
      };
    }

    logger.info(`Alterando descrição do grupo ${groupJid}`, { descLength: newDesc.length });

    await omniZapClient.groupUpdateDescription(groupJid, newDesc);

    try {
      const oldGroupMetadata = await getGroupMetadata(groupJid);
      const oldDesc = oldGroupMetadata?.desc || '';

      const eventLog = {
        type: 'change_group_desc',
        groupJid,
        executorJid: senderJid,
        oldDesc,
        newDesc,
        timestamp: Date.now(),
      };
      logger.info('Evento de alteração de descrição do grupo registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

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
        setting = 'announcement';
        description = 'Somente administradores podem enviar mensagens';
        break;
      case 'open':
      case 'abrir':
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

    logger.info(`Alterando configurações do grupo ${groupJid} para "${setting}"`, { action });

    await omniZapClient.groupSettingUpdate(groupJid, setting);

    try {
      const eventLog = {
        type: 'change_group_setting',
        groupJid,
        executorJid: senderJid,
        setting,
        action,
        timestamp: Date.now(),
      };
      logger.info('Evento de alteração de configuração do grupo registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    if (!groupJid) {
      return {
        success: false,
        message: formatErrorMessage('Comando só disponível em grupos', 'Este comando só pode ser utilizado dentro de grupos.', null),
      };
    }
    const botIsAdmin = await isBotAdmin(groupJid);
    if (!botIsAdmin) {
      return {
        success: false,
        message: formatErrorMessage('Permissão negada', 'O bot precisa ser administrador do grupo para executar esta ação.', null),
      };
    }
    const senderIsAdmin = await isUserAdmin(groupJid, senderJid);
    if (!senderIsAdmin) {
      return {
        success: false,
        message: formatErrorMessage('Permissão negada', 'Apenas administradores podem usar este comando.', null),
      };
    }

    const shouldReset = args && ['reset', 'revoke', 'new', 'novo', 'resetar', 'revogar'].includes(args.trim().toLowerCase());

    let code;
    if (shouldReset) {
      logger.info(`Revogando e gerando novo link de convite para o grupo ${groupJid}`);
      code = await omniZapClient.groupRevokeInvite(groupJid);

      try {
        const eventLog = {
          type: 'revoke_group_link',
          groupJid,
          executorJid: senderJid,
          timestamp: Date.now(),
        };
        logger.info('Evento de revogação de link do grupo registrado', eventLog);
      } catch (logError) {
        logger.warn('Erro ao registrar log do evento', { error: logError.message });
      }
    } else {
      logger.info(`Obtendo link de convite para o grupo ${groupJid}`);
      code = await omniZapClient.groupInviteCode(groupJid);
    }

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

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

    logger.info(`Configurando mensagens efêmeras no grupo ${groupJid} para ${seconds} segundos`);

    await omniZapClient.groupToggleEphemeral(groupJid, seconds);

    try {
      const eventLog = {
        type: 'set_ephemeral',
        groupJid,
        executorJid: senderJid,
        seconds,
        duration,
        timestamp: Date.now(),
      };
      logger.info('Evento de configuração de mensagens efêmeras registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

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

    logger.info(`Configurando modo de adição de participantes no grupo ${groupJid} para ${settingMode}`);

    await omniZapClient.groupMemberAddMode(groupJid, settingMode);

    try {
      const eventLog = {
        type: 'set_add_mode',
        groupJid,
        executorJid: senderJid,
        mode: settingMode,
        timestamp: Date.now(),
      };
      logger.info('Evento de configuração do modo de adição registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

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
    if (!groupJid) {
      return {
        success: false,
        message: formatErrorMessage('Comando só disponível em grupos', 'Este comando só pode ser utilizado dentro de grupos.', null),
      };
    }

    const groupMetadata = await getGroupMetadata(groupJid);
    if (!groupMetadata) {
      return {
        success: false,
        message: formatErrorMessage('Erro ao obter informações', 'Não foi possível obter os metadados do grupo.', null),
      };
    }

    const { subject, desc, owner, participants = [], creation, restrict, announce, ephemeralDuration } = groupMetadata;
    const validParticipants = getValidParticipants(participants);
    const adminCount = validParticipants.filter((p) => ['admin', 'superadmin'].includes(p.admin)).length;
    const memberCount = validParticipants.length - adminCount;

    const creationDate = creation ? new Date(creation * 1000).toLocaleString('pt-BR') : 'Desconhecido';

    let ephemeralText = 'Desativado';
    if (ephemeralDuration) {
      if (ephemeralDuration === 86400) ephemeralText = '24 horas';
      else if (ephemeralDuration === 604800) ephemeralText = '7 dias';
      else if (ephemeralDuration === 7776000) ephemeralText = '90 dias';
      else ephemeralText = `${ephemeralDuration} segundos`;
    }

    const restrictText = restrict ? 'Somente admins podem editar' : 'Todos podem editar';
    const announceText = announce ? 'Somente admins podem enviar mensagens' : 'Todos podem enviar mensagens';

    let inviteLink = '';
    try {
      if (await isBotAdmin(groupJid)) {
        const code = await omniZapClient.groupInviteCode(groupJid);
        inviteLink = `\n🔗 *Link de convite:* https://chat.whatsapp.com/${code}`;
      }
    } catch (error) {
      logger.warn('Erro ao obter link do grupo', { error: error.message, groupJid });
    }

    const infoMessage = `📊 *INFORMAÇÕES DO GRUPO*\n\n` + `📝 *Nome:* ${subject}\n` + `👥 *Participantes:* ${validParticipants.length} (${adminCount} admins, ${memberCount} membros)\n` + `👑 *Criador:* ${owner ? '+' + owner.split('@')[0] : 'Desconhecido'}\n` + `📅 *Criado em:* ${creationDate}\n` + `⚙️ *Configurações:*\n` + `  • ${restrictText}\n` + `  • ${announceText}\n` + `⏱️ *Mensagens temporárias:* ${ephemeralText}` + `${inviteLink}\n\n` + `📄 *Descrição:*\n${desc || 'Sem descrição'}`;

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
    const adminValidation = await validateAdminCommand(groupJid, senderJid);
    if (adminValidation) {
      return adminValidation;
    }

    let targetUserJid = null;
    let banReason = 'Banido por um administrador';

    if (messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      targetUserJid = messageInfo.message.extendedTextMessage.contextInfo.participant;

      if (args && args.trim()) {
        banReason = args.trim();
      }

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
      }
    } else {
      if (!args || !args.trim()) {
        return {
          success: false,
          message: formatErrorMessage('Usuário não especificado', 'Você deve mencionar um usuário ou responder a uma mensagem dele, ou fornecer o número.', '📋 *Como usar:*\n• Responda a uma mensagem com: !ban motivo\n• Ou envie: !ban número motivo'),
        };
      }

      const argParts = args.split(' ');
      if (!argParts[0]) {
        return {
          success: false,
          message: formatErrorMessage('Usuário não especificado', 'Você deve mencionar um usuário ou responder a uma mensagem dele, ou fornecer o número.', '📋 *Como usar:*\n• Responda a uma mensagem com: !ban motivo\n• Ou envie: !ban número motivo'),
        };
      }

      targetUserJid = formatPhoneToJid(argParts[0]);
      if (argParts.length > 1) {
        banReason = argParts.slice(1).join(' ');
      }
    }

    const targetIsAdmin = await isUserAdmin(groupJid, targetUserJid);
    if (targetIsAdmin) {
      return {
        success: false,
        message: formatErrorMessage('Operação não permitida', 'Não é possível banir outro administrador do grupo.', null),
      };
    }

    const userInGroup = await isUserInGroup(groupJid, targetUserJid);
    if (!userInGroup) {
      return {
        success: false,
        message: formatErrorMessage('Usuário não encontrado', 'O usuário informado não está no grupo.', null),
      };
    }

    logger.info(`Banindo usuário ${targetUserJid} do grupo ${groupJid} - Motivo: ${banReason}`);
    await omniZapClient.groupParticipantsUpdate(groupJid, [targetUserJid], 'remove');

    try {
      const eventLog = {
        type: 'ban',
        groupJid,
        targetUserJid,
        executorJid: senderJid,
        reason: banReason,
        timestamp: Date.now(),
      };
      logger.info('Evento de banimento registrado', eventLog);
    } catch (logError) {
      logger.warn('Erro ao registrar log do evento', { error: logError.message });
    }

    const formattedNumber = targetUserJid.split('@')[0];

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
    if (groupJid) {
      const senderIsAdmin = await isUserAdmin(groupJid, senderJid);
      if (!senderIsAdmin) {
        return {
          success: false,
          message: formatErrorMessage('Permissão negada', 'Apenas administradores podem consultar a lista de banimentos.', null),
        };
      }
    }

    const argParts = args.split(' ');
    const subCommand = argParts[0]?.toLowerCase();

    if (!subCommand) {
      return {
        success: true,
        message: `📋 *Lista de Banimentos - Ajuda*\n\n📱 *Comandos disponíveis:*\n• \`grupo\` - Lista banimentos do grupo atual\n• \`user número\` - Busca histórico de banimento de um usuário\n• \`total\` - Estatísticas de banimentos\n\n*Exemplo:* \`banlist grupo\``,
      };
    }

    switch (subCommand) {
      case 'grupo':
      case 'group':
        if (!groupJid) {
          return {
            success: false,
            message: formatErrorMessage('Erro', 'Este subcomando só pode ser usado dentro de grupos.', null),
          };
        }

        const groupBans = await getGroupBanHistory(groupJid);

        if (groupBans.length === 0) {
          return {
            success: true,
            message: '📋 *Lista de Banimentos*\n\nNenhum banimento registrado neste grupo.',
          };
        }

        let banList = `📋 *Lista de Banimentos do Grupo*\n\n*Total:* ${groupBans.length} banimento(s)\n\n`;

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
        const phoneNumber = argParts[1];
        if (!phoneNumber) {
          return {
            success: false,
            message: formatErrorMessage('Parâmetro faltando', 'Você precisa fornecer o número do usuário.', '📋 *Exemplo:* banlist user 5511999999999'),
          };
        }

        let userJid = phoneNumber;
        if (!userJid.includes('@')) {
          let cleaned = phoneNumber.replace(/\D/g, '');

          if (cleaned.length <= 11) {
            cleaned = '55' + cleaned;
          }

          userJid = `${cleaned}@s.whatsapp.net`;
        }

        const userBans = await getUserBanHistory(userJid);

        if (userBans.length === 0) {
          return {
            success: true,
            message: `📋 *Histórico de Banimentos*\n\nNenhum registro de banimento para o número ${phoneNumber}.`,
          };
        }

        let userBanList = `📋 *Histórico de Banimentos*\n\n👤 *Usuário:* ${phoneNumber}\n*Total:* ${userBans.length} banimento(s)\n\n`;

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
        const allBans = await loadBannedUsersList();
        const totalBans = allBans.users.length;

        const uniqueGroups = Object.keys(allBans.groupBans).length;

        const uniqueUsers = new Set(allBans.users.map((ban) => ban.userJid.replace(/:\d+/, ''))).size;

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
  loadBannedUsersList,
  saveBannedUsersList,
  addUserToBannedList,
  getGroupBanHistory,
  getUserBanHistory,
  isUserBanned,
};
