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
const fs = require('fs').promises;
const path = require('path');

// Diretório para armazenar a lista de usuários banidos
const BANNED_USERS_DIR = path.join(process.cwd(), 'temp', 'bannedUsers');
const BANNED_USERS_LIST_FILE = path.join(BANNED_USERS_DIR, 'bannedUsers.json');

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
 * Carrega a lista de usuários banidos
 *
 * @returns {Promise<Object>} - Lista de usuários banidos
 */
const loadBannedUsersList = async () => {
  try {
    // Garantir que o diretório existe
    await fs.mkdir(BANNED_USERS_DIR, { recursive: true });

    try {
      const data = await fs.readFile(BANNED_USERS_LIST_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // Se o arquivo não existir, retorna um objeto vazio
      if (error.code === 'ENOENT') {
        return {
          users: [],
          groupBans: {},
        };
      }
      throw error;
    }
  } catch (error) {
    logger.error('Erro ao carregar lista de usuários banidos', {
      error: error.message,
      stack: error.stack,
    });
    return {
      users: [],
      groupBans: {},
    };
  }
};

/**
 * Salva a lista de usuários banidos
 *
 * @param {Object} bannedList - Lista de usuários banidos
 * @returns {Promise<void>}
 */
const saveBannedUsersList = async (bannedList) => {
  try {
    await fs.mkdir(BANNED_USERS_DIR, { recursive: true });
    await fs.writeFile(BANNED_USERS_LIST_FILE, JSON.stringify(bannedList, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Erro ao salvar lista de usuários banidos', {
      error: error.message,
      stack: error.stack,
    });
  }
};

/**
 * Adiciona um usuário à lista de banidos
 *
 * @param {String} userJid - JID do usuário banido
 * @param {String} groupJid - JID do grupo onde foi banido
 * @param {String} executorJid - JID do administrador que executou o banimento
 * @param {String} reason - Motivo do banimento
 * @returns {Promise<void>}
 */
const addUserToBannedList = async (userJid, groupJid, executorJid, reason) => {
  try {
    const bannedList = await loadBannedUsersList();
    const cleanUserJid = userJid.replace(/:\d+/, '');

    // Informações do banimento
    const banInfo = {
      groupJid: groupJid,
      executorJid: executorJid,
      reason: reason,
      timestamp: Date.now(),
      formattedDate: new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };

    // Atualiza ou cria o usuário na lista global
    let userEntry = bannedList.users.find((u) => u.userJid.replace(/:\d+/, '') === cleanUserJid);
    if (!userEntry) {
      userEntry = {
        userJid: cleanUserJid,
        bans: [banInfo],
      };
      bannedList.users.push(userEntry);
    } else {
      // Evita duplicidade de banimento no mesmo grupo e motivo no mesmo timestamp
      const alreadyBanned = userEntry.bans.some((b) => b.groupJid === groupJid && b.timestamp === banInfo.timestamp);
      if (!alreadyBanned) {
        userEntry.bans.push(banInfo);
      }
    }

    // Adiciona à lista específica do grupo
    if (!bannedList.groupBans[groupJid]) {
      bannedList.groupBans[groupJid] = [];
    }
    bannedList.groupBans[groupJid].push({
      userJid: cleanUserJid,
      ...banInfo,
    });

    await saveBannedUsersList(bannedList);

    logger.info('Usuário adicionado à lista de banidos', {
      userJid: cleanUserJid,
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
 * @param {String} userJid - JID do usuário a ser removido da lista de banidos
 * @returns {Promise<void>}
 */
const removeUserFromBanList = async (userJid) => {
  try {
    // Ler a lista de banidos existente
    let bannedUsers = [];
    try {
      const data = await fs.readFile(BANNED_USERS_LIST_FILE, 'utf8');
      bannedUsers = JSON.parse(data);
    } catch (readError) {
      logger.warn('Erro ao ler a lista de usuários banidos', { error: readError.message });
    }

    // Filtrar o usuário a ser removido
    const updatedBannedUsers = bannedUsers.filter((user) => user.jid !== userJid);

    // Salvar a lista atualizada
    await fs.writeFile(BANNED_USERS_LIST_FILE, JSON.stringify(updatedBannedUsers, null, 2));
    logger.info(`Usuário ${userJid} removido da lista de banidos com sucesso`);
  } catch (error) {
    logger.error('Erro ao remover usuário da lista de banidos', {
      error: error.message,
      stack: error.stack,
      userJid,
    });
  }
};

/**
 * Obtém a lista de usuários banidos
 *
 * @returns {Promise<Array>} - Lista de usuários banidos
 */
const getBannedUsersList = async () => {
  try {
    // Ler a lista de banidos existente
    let bannedUsers = [];
    try {
      const data = await fs.readFile(BANNED_USERS_LIST_FILE, 'utf8');
      bannedUsers = JSON.parse(data);
    } catch (readError) {
      logger.warn('Erro ao ler a lista de usuários banidos', { error: readError.message });
    }

    return bannedUsers;
  } catch (error) {
    logger.error('Erro ao obter a lista de usuários banidos', {
      error: error.message,
      stack: error.stack,
    });
    return [];
  }
};

/**
 * Busca o histórico de banimento de um usuário
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
    logger.error('Erro ao buscar histórico de banimento', {
      error: error.message,
      stack: error.stack,
      userJid,
    });
    return [];
  }
};

/**
 * Busca o histórico de banimentos em um grupo
 *
 * @param {String} groupJid - JID do grupo
 * @returns {Promise<Array>} - Histórico de banimentos no grupo
 */
const getGroupBanHistory = async (groupJid) => {
  try {
    const bannedList = await loadBannedUsersList();
    return bannedList.groupBans[groupJid] || [];
  } catch (error) {
    logger.error('Erro ao buscar histórico de banimento do grupo', {
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

    // Adicionar à lista de usuários banidos
    await addUserToBannedList(targetUserJid, groupJid, senderJid, banReason);

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

module.exports = {
  processBanCommand,
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
