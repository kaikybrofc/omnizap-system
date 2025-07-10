/**
 * OmniZap Group Global Utils
 *
 * Utilitários globais centralizados para operações com grupos do WhatsApp
 * Sistema centralizado usando apenas dados do socket na pasta data
 * Usando apenas a API do Baileys diretamente
 *
 * @version 3.0.0
 * @author OmniZap Team
 * @license MIT
 * @source https://www.npmjs.com/package/baileys#groups
 */

const logger = require('./logger/loggerModule');
const fs = require('fs').promises;
const path = require('path');

// === CONSTANTES GLOBAIS - CENTRALIZADAS NA PASTA DATA ===
const DATA_DIR = path.join(process.cwd(), 'temp', 'data');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const BANNED_USERS_FILE = path.join(DATA_DIR, 'bannedUsers.json');

// === CONFIGURAÇÕES GLOBAIS ===
const CONFIG = {
  DATA_REFRESH_INTERVAL: 30 * 1000, // 30 segundos para verificar dados do socket
  MAX_ACTIVITY_LOGS: 1000, // Máximo de logs de atividade por grupo
  AUTO_CLEANUP_DAYS: 30, // Dias para limpeza automática de logs antigos
  STATS_UPDATE_INTERVAL: 15 * 60 * 1000, // 15 minutos para atualização de stats
};

/**
 * === FUNÇÕES DE INICIALIZAÇÃO ===
 */

/**
 * Inicializa o diretório centralizado de dados
 */
const initializeDirectories = async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    logger.info('Diretório de dados centralizado inicializado com sucesso', { dataDir: DATA_DIR });
  } catch (error) {
    logger.error('Erro ao inicializar diretório de dados', { error: error.message });
    throw error;
  }
};

/**
 * === FUNÇÕES DE VERIFICAÇÃO DE PERMISSÕES ===
 */

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
    const groupMetadata = await getGroupMetadata(omniZapClient, groupJid);
    if (!groupMetadata || !groupMetadata.participants) {
      return false;
    }

    const cleanUserJid = cleanJid(userJid);
    const member = groupMetadata.participants.find((p) => cleanJid(p.id) === cleanUserJid);

    const isAdmin = member ? ['admin', 'superadmin'].includes(member.admin) : false;

    logger.debug('Verificação de admin', {
      groupJid,
      userJid: cleanUserJid,
      isAdmin,
      memberRole: member?.admin || 'não encontrado',
    });

    return isAdmin;
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
    const botJid = getBotJid(omniZapClient);
    if (!botJid) {
      logger.warn('JID do bot não encontrado', { groupJid });
      return false;
    }

    const isAdmin = await isUserAdmin(omniZapClient, groupJid, botJid);

    logger.debug('Verificação de bot admin', {
      groupJid,
      botJid: cleanJid(botJid),
      isAdmin,
    });

    return isAdmin;
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
    const groupMetadata = await getGroupMetadata(omniZapClient, groupJid);
    if (!groupMetadata || !groupMetadata.participants) {
      return false;
    }

    const cleanUserJid = cleanJid(userJid);
    const isInGroup = groupMetadata.participants.some((p) => cleanJid(p.id) === cleanUserJid);

    logger.debug('Verificação de participação', {
      groupJid,
      userJid: cleanUserJid,
      isInGroup,
    });

    return isInGroup;
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
 * === FUNÇÕES DE DADOS DO SOCKET ===
 */

/**
 * Carrega dados de grupos do socket
 *
 * @returns {Promise<Object>} - Dados de grupos do socket
 */
const loadGroupsData = async () => {
  try {
    await initializeDirectories();

    try {
      const data = await fs.readFile(GROUPS_FILE, 'utf8');
      const groups = JSON.parse(data);

      logger.debug(`Carregados ${Object.keys(groups).length} grupos dos dados`);
      return groups;
    } catch (readError) {
      logger.debug('Arquivo de grupos não encontrado, retornando objeto vazio');
      return {};
    }
  } catch (error) {
    logger.error('Erro ao carregar dados de grupos', { error: error.message });
    return {};
  }
};

/**
 * Carrega dados de contatos do socket
 *
 * @returns {Promise<Object>} - Dados de contatos do socket
 */
const loadContactsData = async () => {
  try {
    await initializeDirectories();

    try {
      const data = await fs.readFile(CONTACTS_FILE, 'utf8');
      const contacts = JSON.parse(data);

      logger.debug(`Carregados ${Object.keys(contacts).length} contatos dos dados`);
      return contacts;
    } catch (readError) {
      logger.debug('Arquivo de contatos não encontrado, retornando objeto vazio');
      return {};
    }
  } catch (error) {
    logger.error('Erro ao carregar dados de contatos', { error: error.message });
    return {};
  }
};

/**
 * Verifica se os dados estão atualizados
 *
 * @returns {Promise<Boolean>} - True se os dados estão atualizados
 */
const isDataRecent = async () => {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf8');
    const metadata = JSON.parse(data);

    // Considera os dados recentes se foram salvos no último intervalo configurado
    const recentThreshold = Date.now() - CONFIG.DATA_REFRESH_INTERVAL;
    return metadata.lastSave && metadata.lastSave > recentThreshold;
  } catch (error) {
    logger.debug('Arquivo de metadata não encontrado ou inválido');
    return false;
  }
};

/**
 * Obtém metadados de um grupo usando apenas dados do socket
 *
 * @param {Object} omniZapClient - Cliente WhatsApp (opcional, usado apenas como fallback)
 * @param {String} groupJid - ID do grupo
 * @param {Boolean} forceRefresh - Forçar busca na API (usar com cuidado)
 * @returns {Promise<Object>} - Metadados do grupo
 */
const getGroupMetadata = async (omniZapClient, groupJid, forceRefresh = false) => {
  try {
    // Validar entrada
    if (!groupJid) {
      logger.warn('JID do grupo não fornecido para getGroupMetadata');
      return null;
    }

    const now = Date.now();

    // Se forceRefresh for true e cliente estiver disponível, buscar da API
    if (forceRefresh && omniZapClient) {
      try {
        logger.debug('Buscando metadados frescos da API (forceRefresh)', { groupJid });
        const metadata = await omniZapClient.groupMetadata(groupJid);

        if (metadata) {
          const enrichedMetadata = {
            ...metadata,
            participantCount: metadata.participants?.length || 0,
            adminCount: metadata.participants?.filter((p) => ['admin', 'superadmin'].includes(p.admin)).length || 0,
            lastUpdated: now,
            source: 'api_fresh',
          };

          logger.info('Metadados do grupo atualizados via API', {
            groupJid,
            participantCount: enrichedMetadata.participantCount,
            adminCount: enrichedMetadata.adminCount,
          });

          return enrichedMetadata;
        }
      } catch (apiError) {
        logger.warn('Erro ao buscar da API, usando dados do socket', { error: apiError.message });
      }
    }

    // Carregar dados do socket (prioridade principal)
    const groupsData = await loadGroupsData();

    if (groupsData[groupJid]) {
      logger.debug('Usando metadados dos dados do socket', { groupJid });

      const socketMetadata = {
        ...groupsData[groupJid],
        participantCount: groupsData[groupJid].participants?.length || 0,
        adminCount: groupsData[groupJid].participants?.filter((p) => ['admin', 'superadmin'].includes(p.admin)).length || 0,
        lastUpdated: now,
        source: 'socket_data',
      };

      return socketMetadata;
    }

    logger.warn('Grupo não encontrado nos dados do socket', { groupJid });
    return null;
  } catch (error) {
    logger.error('Erro ao obter metadados do grupo', {
      error: error.message,
      stack: error.stack,
      groupJid,
    });
    return null;
  }
};

/**
 * === FUNÇÕES DE ESTATÍSTICAS ===
 */

/**
 * Carrega as estatísticas globais baseadas nos dados do socket
 *
 * @returns {Promise<Object>} - Estatísticas de grupos
 */
const loadStats = async () => {
  try {
    await initializeDirectories();

    try {
      const data = await fs.readFile(STATS_FILE, 'utf8');
      const stats = JSON.parse(data);

      // Validar estrutura das estatísticas
      if (!stats.global) stats.global = {};
      if (!stats.groups) stats.groups = {};
      if (!stats.lastUpdate) stats.lastUpdate = 0;

      return stats;
    } catch (readError) {
      // Arquivo não existe, criar nova estrutura
      const newStats = {
        global: {
          totalGroups: 0,
          totalParticipants: 0,
          totalAdmins: 0,
          averageGroupSize: 0,
          mostActiveGroup: null,
          lastGlobalUpdate: Date.now(),
        },
        groups: {},
        lastUpdate: Date.now(),
        version: '3.0.0',
      };
      await saveStats(newStats);
      return newStats;
    }
  } catch (error) {
    logger.error('Erro ao carregar estatísticas', { error: error.message });
    return { global: {}, groups: {}, lastUpdate: 0, version: '3.0.0' };
  }
};

/**
 * Salva as estatísticas
 *
 * @param {Object} stats - Estatísticas de grupos
 */
const saveStats = async (stats) => {
  try {
    await initializeDirectories();
    stats.lastUpdate = Date.now();
    await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
    logger.debug('Estatísticas salvas com sucesso');
  } catch (error) {
    logger.error('Erro ao salvar estatísticas', { error: error.message });
  }
};

/**
 * Atualiza as estatísticas de um grupo específico baseado nos dados do socket
 *
 * @param {String} groupJid - ID do grupo
 * @param {Object} groupMetadata - Metadados do grupo (opcional, será buscado se não fornecido)
 * @param {Object} additionalData - Dados adicionais para estatísticas
 */
const updateGroupStats = async (groupJid, groupMetadata = null, additionalData = {}) => {
  try {
    // Se metadados não foram fornecidos, buscar dos dados do socket
    if (!groupMetadata) {
      groupMetadata = await getGroupMetadata(null, groupJid);
      if (!groupMetadata) {
        logger.warn('Não foi possível obter metadados para atualizar estatísticas', { groupJid });
        return;
      }
    }

    const stats = await loadStats();
    const now = Date.now();

    // Atualizar estatísticas do grupo específico
    if (!stats.groups[groupJid]) {
      stats.groups[groupJid] = {
        name: groupMetadata.subject || 'Grupo sem nome',
        created: now,
        participantCount: 0,
        adminCount: 0,
        activityCount: 0,
        lastActivity: now,
        settings: {},
        history: [],
      };
    }

    const groupStats = stats.groups[groupJid];

    // Atualizar contadores baseados nos dados do socket
    groupStats.name = groupMetadata.subject || groupStats.name;
    groupStats.participantCount = groupMetadata.participants?.length || 0;
    groupStats.adminCount = groupMetadata.participants?.filter((p) => ['admin', 'superadmin'].includes(p.admin)).length || 0;
    groupStats.lastActivity = now;
    groupStats.lastUpdate = now;

    // Adicionar dados adicionais
    if (additionalData.activityType) {
      groupStats.activityCount = (groupStats.activityCount || 0) + 1;

      // Manter histórico limitado
      if (!groupStats.history) groupStats.history = [];
      groupStats.history.push({
        type: additionalData.activityType,
        timestamp: now,
        data: additionalData.data || {},
      });

      // Limitar histórico
      if (groupStats.history.length > 100) {
        groupStats.history = groupStats.history.slice(-100);
      }
    }

    // Atualizar estatísticas globais
    await updateGlobalStats(stats);

    await saveStats(stats);

    logger.debug('Estatísticas do grupo atualizadas', {
      groupJid,
      participantCount: groupStats.participantCount,
      activityCount: groupStats.activityCount,
    });
  } catch (error) {
    logger.error('Erro ao atualizar estatísticas do grupo', {
      error: error.message,
      groupJid,
    });
  }
};

/**
 * Atualiza as estatísticas globais baseadas em todos os grupos
 *
 * @param {Object} stats - Objeto de estatísticas
 */
const updateGlobalStats = async (stats) => {
  try {
    const groupsData = Object.values(stats.groups);

    stats.global = {
      ...stats.global,
      totalGroups: groupsData.length,
      totalParticipants: groupsData.reduce((sum, group) => sum + (group.participantCount || 0), 0),
      totalAdmins: groupsData.reduce((sum, group) => sum + (group.adminCount || 0), 0),
      averageGroupSize: groupsData.length > 0 ? Math.round(groupsData.reduce((sum, group) => sum + (group.participantCount || 0), 0) / groupsData.length) : 0,
      mostActiveGroup: groupsData.length > 0 ? groupsData.reduce((most, group) => ((group.activityCount || 0) > (most.activityCount || 0) ? group : most)) : null,
      lastGlobalUpdate: Date.now(),
    };

    logger.debug('Estatísticas globais atualizadas', {
      totalGroups: stats.global.totalGroups,
      totalParticipants: stats.global.totalParticipants,
      averageGroupSize: stats.global.averageGroupSize,
    });
  } catch (error) {
    logger.error('Erro ao atualizar estatísticas globais', { error: error.message });
  }
};

/**
 * === FUNÇÕES DE ATIVIDADE E LOGS ===
 */

/**
 * Registra uma atividade em um grupo no arquivo centralizado
 *
 * @param {String} groupJid - ID do grupo
 * @param {String} activityType - Tipo de atividade
 * @param {Object} activityData - Dados da atividade
 */
const logGroupActivity = async (groupJid, activityType, activityData = {}) => {
  try {
    await initializeDirectories();

    let activities = {};
    try {
      const data = await fs.readFile(ACTIVITY_FILE, 'utf8');
      activities = JSON.parse(data);
    } catch (readError) {
      // Arquivo não existe, criar novo
      activities = {
        global: { totalActivities: 0, lastActivity: Date.now() },
        groups: {},
        lastCleanup: Date.now(),
        version: '3.0.0',
      };
    }

    // Inicializar grupo se necessário
    if (!activities.groups[groupJid]) {
      activities.groups[groupJid] = { logs: [], totalActivities: 0 };
    }

    const groupActivities = activities.groups[groupJid];

    // Adicionar nova atividade
    const newActivity = {
      type: activityType,
      timestamp: Date.now(),
      data: activityData,
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    groupActivities.logs.push(newActivity);
    groupActivities.totalActivities = (groupActivities.totalActivities || 0) + 1;
    groupActivities.lastActivity = newActivity.timestamp;

    // Limitar logs por grupo
    if (groupActivities.logs.length > CONFIG.MAX_ACTIVITY_LOGS) {
      groupActivities.logs = groupActivities.logs.slice(-CONFIG.MAX_ACTIVITY_LOGS);
    }

    // Atualizar estatísticas globais
    activities.global.totalActivities = Object.values(activities.groups).reduce((sum, group) => sum + (group.totalActivities || 0), 0);
    activities.global.lastActivity = newActivity.timestamp;

    // Limpeza automática se necessário
    const now = Date.now();
    if (now - (activities.lastCleanup || 0) > CONFIG.AUTO_CLEANUP_DAYS * 24 * 60 * 60 * 1000) {
      await cleanupOldActivities(activities, now);
      activities.lastCleanup = now;
    }

    activities.lastUpdate = now;
    await fs.writeFile(ACTIVITY_FILE, JSON.stringify(activities, null, 2));

    logger.debug('Atividade registrada', {
      groupJid,
      activityType,
      totalActivities: groupActivities.totalActivities,
    });
  } catch (error) {
    logger.error('Erro ao registrar atividade do grupo', {
      error: error.message,
      groupJid,
      activityType,
    });
  }
};

/**
 * Registra uma atividade e atualiza estatísticas do grupo em uma única operação
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} groupJid - ID do grupo
 * @param {String} activityType - Tipo de atividade
 * @param {Object} activityData - Dados da atividade
 * @returns {Promise<Boolean>} - True se bem-sucedido
 */
const logGroupActivityWithStats = async (omniZapClient, groupJid, activityType, activityData = {}) => {
  try {
    // Registrar atividade
    await logGroupActivity(groupJid, activityType, activityData);

    // Atualizar estatísticas se cliente fornecido
    if (omniZapClient) {
      try {
        const groupMetadata = await getGroupMetadata(omniZapClient, groupJid);
        if (groupMetadata) {
          await updateGroupStats(groupJid, groupMetadata, {
            activityType,
            data: activityData,
          });
        }
      } catch (statsError) {
        logger.warn('Erro ao atualizar estatísticas durante log de atividade', {
          error: statsError.message,
          groupJid,
          activityType,
        });
      }
    }

    return true;
  } catch (error) {
    logger.error('Erro ao registrar atividade com estatísticas', {
      error: error.message,
      groupJid,
      activityType,
    });
    return false;
  }
};

/**
 * Limpa atividades antigas baseado na configuração
 *
 * @param {Object} activities - Objeto de atividades
 * @param {Number} now - Timestamp atual
 */
const cleanupOldActivities = async (activities, now) => {
  try {
    const cutoffTime = now - CONFIG.AUTO_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
    let totalCleaned = 0;

    for (const groupJid in activities.groups) {
      const group = activities.groups[groupJid];
      const originalLength = group.logs.length;

      group.logs = group.logs.filter((log) => log.timestamp > cutoffTime);

      const cleaned = originalLength - group.logs.length;
      totalCleaned += cleaned;
    }

    logger.info('Limpeza automática de atividades concluída', {
      totalCleaned,
      cutoffDays: CONFIG.AUTO_CLEANUP_DAYS,
    });
  } catch (error) {
    logger.error('Erro na limpeza automática de atividades', { error: error.message });
  }
};

/**
 * === FUNÇÕES UTILITÁRIAS ===
 */

/**
 * Limpa um JID removendo sufixos de dispositivo
 *
 * @param {String} jid - JID a ser limpo
 * @returns {String} - JID limpo
 */
const cleanJid = (jid) => {
  if (!jid) return '';
  return jid.replace(/:\d+/, '');
};

/**
 * Formata um número de telefone para o formato JID
 *
 * @param {String} phoneNumber - Número de telefone
 * @returns {String} - JID formatado
 */
const formatPhoneToJid = (phoneNumber) => {
  if (!phoneNumber) return '';

  let cleaned = phoneNumber.replace(/\D/g, '');

  // Adicionar código do país se necessário (Brasil = 55)
  if (cleaned.length <= 11) {
    cleaned = '55' + cleaned;
  }

  return `${cleaned}@s.whatsapp.net`;
};

/**
 * Verifica se um JID é de um grupo
 *
 * @param {String} jid - JID a ser verificado
 * @returns {Boolean} - True se for JID de grupo
 */
const isGroupJid = (jid) => {
  return jid && jid.endsWith('@g.us');
};

/**
 * Obtém o JID do bot
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @returns {String} - JID do bot
 */
const getBotJid = (omniZapClient) => {
  return omniZapClient.user?.id || omniZapClient.authState?.creds?.me?.id || omniZapClient.authState?.creds?.registration?.phoneNumber;
};

/**
 * Obtém todos os grupos que o bot participa
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @returns {Promise<Array>} - Lista de JIDs de grupos
 */
const getAllBotGroups = async (omniZapClient) => {
  try {
    const chats = await omniZapClient.getBusinessProfile();
    return Object.keys(chats || {}).filter((jid) => isGroupJid(jid));
  } catch (error) {
    logger.error('Erro ao obter grupos do bot', { error: error.message });
    return [];
  }
};

/**
 * === FUNÇÕES DE BANIMENTO ===
 */

/**
 * Carrega a lista de usuários banidos do arquivo centralizado
 *
 * @returns {Promise<Object>} - Lista de usuários banidos
 */
const loadBannedUsersList = async () => {
  try {
    await initializeDirectories();

    try {
      const data = await fs.readFile(BANNED_USERS_FILE, 'utf8');
      const bannedList = JSON.parse(data);

      // Validar estrutura
      if (!bannedList.users) bannedList.users = [];
      if (!bannedList.groupBans) bannedList.groupBans = {};
      if (!bannedList.globalBans) bannedList.globalBans = [];

      return bannedList;
    } catch (readError) {
      // Arquivo não existe, criar novo
      const newList = {
        users: [],
        groupBans: {},
        globalBans: [],
        lastUpdate: Date.now(),
        version: '3.0.0',
      };
      await saveBannedUsersList(newList);
      return newList;
    }
  } catch (error) {
    logger.error('Erro ao carregar lista de banidos', { error: error.message });
    return { users: [], groupBans: {}, globalBans: [], lastUpdate: 0 };
  }
};

/**
 * Salva a lista de usuários banidos
 *
 * @param {Object} bannedList - Lista de usuários banidos
 */
const saveBannedUsersList = async (bannedList) => {
  try {
    await initializeDirectories();
    bannedList.lastUpdate = Date.now();
    await fs.writeFile(BANNED_USERS_FILE, JSON.stringify(bannedList, null, 2));
    logger.debug('Lista de banidos salva com sucesso');
  } catch (error) {
    logger.error('Erro ao salvar lista de banidos', { error: error.message });
  }
};

/**
 * Adiciona um usuário à lista de banidos
 *
 * @param {String} userJid - JID do usuário
 * @param {String} groupJid - JID do grupo (opcional para ban global)
 * @param {String} executorJid - JID de quem executou o ban
 * @param {String} reason - Motivo do banimento
 * @returns {Promise<Boolean>} - True se adicionado com sucesso
 */
const addUserToBannedList = async (userJid, groupJid = null, executorJid = null, reason = 'Não especificado') => {
  try {
    const bannedList = await loadBannedUsersList();
    const cleanUserJid = cleanJid(userJid);
    const now = Date.now();

    const banData = {
      userJid: cleanUserJid,
      groupJid,
      executorJid: executorJid ? cleanJid(executorJid) : null,
      reason,
      timestamp: now,
      id: `ban_${now}_${Math.random().toString(36).substr(2, 9)}`,
    };

    // Adicionar à lista geral
    bannedList.users.push(banData);

    // Adicionar ao grupo específico ou global
    if (groupJid) {
      if (!bannedList.groupBans[groupJid]) {
        bannedList.groupBans[groupJid] = [];
      }
      bannedList.groupBans[groupJid].push(banData);
    } else {
      bannedList.globalBans.push(banData);
    }

    await saveBannedUsersList(bannedList);

    // Registrar atividade
    if (groupJid) {
      await logGroupActivity(groupJid, 'user_banned', {
        userJid: cleanUserJid,
        executorJid: executorJid ? cleanJid(executorJid) : null,
        reason,
      });
    }

    logger.info('Usuário adicionado à lista de banidos', {
      userJid: cleanUserJid,
      groupJid,
      reason,
    });

    return true;
  } catch (error) {
    logger.error('Erro ao adicionar usuário à lista de banidos', {
      error: error.message,
      userJid,
      groupJid,
      reason,
    });
    return false;
  }
};

/**
 * Remove um usuário da lista de banidos
 *
 * @param {String} userJid - JID do usuário
 * @param {String} groupJid - JID do grupo (opcional)
 * @returns {Promise<Boolean>} - True se removido com sucesso
 */
const removeUserFromBanList = async (userJid, groupJid = null) => {
  try {
    const bannedList = await loadBannedUsersList();
    const cleanUserJid = cleanJid(userJid);
    let removed = false;

    // Remover da lista geral
    const originalLength = bannedList.users.length;
    bannedList.users = bannedList.users.filter((ban) => !(cleanJid(ban.userJid) === cleanUserJid && (groupJid ? ban.groupJid === groupJid : !ban.groupJid)));
    removed = bannedList.users.length < originalLength;

    // Remover do grupo específico
    if (groupJid && bannedList.groupBans[groupJid]) {
      const originalGroupLength = bannedList.groupBans[groupJid].length;
      bannedList.groupBans[groupJid] = bannedList.groupBans[groupJid].filter((ban) => cleanJid(ban.userJid) !== cleanUserJid);
      removed = removed || bannedList.groupBans[groupJid].length < originalGroupLength;
    }

    // Remover da lista global
    if (!groupJid) {
      const originalGlobalLength = bannedList.globalBans.length;
      bannedList.globalBans = bannedList.globalBans.filter((ban) => cleanJid(ban.userJid) !== cleanUserJid);
      removed = removed || bannedList.globalBans.length < originalGlobalLength;
    }

    if (removed) {
      await saveBannedUsersList(bannedList);

      // Registrar atividade
      if (groupJid) {
        await logGroupActivity(groupJid, 'user_unbanned', {
          userJid: cleanUserJid,
        });
      }

      logger.info('Usuário removido da lista de banidos', {
        userJid: cleanUserJid,
        groupJid,
      });
    }

    return removed;
  } catch (error) {
    logger.error('Erro ao remover usuário da lista de banidos', {
      error: error.message,
      userJid,
      groupJid,
    });
    return false;
  }
};

/**
 * Verifica se um usuário está banido
 *
 * @param {String} userJid - JID do usuário
 * @param {String} groupJid - JID do grupo (opcional)
 * @returns {Promise<Boolean>} - True se o usuário estiver banido
 */
const isUserBanned = async (userJid, groupJid = null) => {
  try {
    const bannedList = await loadBannedUsersList();
    const cleanUserJid = cleanJid(userJid);

    // Verificar ban global
    const isGloballyBanned = bannedList.globalBans.some((ban) => cleanJid(ban.userJid) === cleanUserJid);

    if (isGloballyBanned) return true;

    // Verificar ban no grupo específico
    if (groupJid && bannedList.groupBans[groupJid]) {
      const isGroupBanned = bannedList.groupBans[groupJid].some((ban) => cleanJid(ban.userJid) === cleanUserJid);
      if (isGroupBanned) return true;
    }

    return false;
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
 * === FUNÇÕES DE RELATÓRIOS ===
 */

/**
 * Gera um relatório completo dos grupos
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {Object} options - Opções do relatório
 * @returns {Promise<Object>} - Relatório dos grupos
 */
const generateGroupsReport = async (omniZapClient, options = {}) => {
  try {
    const {
      includeStats = true,
      includeActivity = true,
      includeBans = true,
      groupJid = null, // Para relatório de grupo específico
    } = options;

    const report = {
      generated: Date.now(),
      type: groupJid ? 'group' : 'global',
      data: {},
    };

    if (groupJid) {
      // Relatório de grupo específico
      const metadata = await getGroupMetadata(omniZapClient, groupJid);
      const stats = await loadGroupStats();

      report.data = {
        group: {
          jid: groupJid,
          name: metadata?.subject || 'Grupo sem nome',
          description: metadata?.desc || '',
          participantCount: metadata?.participantCount || 0,
          adminCount: metadata?.adminCount || 0,
          created: metadata?.creation || null,
          lastUpdated: metadata?.lastUpdated || null,
        },
      };

      if (includeStats && stats.groups[groupJid]) {
        report.data.statistics = stats.groups[groupJid];
      }

      if (includeActivity) {
        try {
          const activityData = await fs.readFile(GROUP_ACTIVITY_FILE, 'utf8');
          const activities = JSON.parse(activityData);
          report.data.recentActivity = activities.groups[groupJid]?.logs?.slice(-20) || [];
        } catch (actError) {
          report.data.recentActivity = [];
        }
      }

      if (includeBans) {
        const bannedList = await loadBannedUsersList();
        report.data.bans = bannedList.groupBans[groupJid] || [];
      }
    } else {
      // Relatório global
      const stats = await loadGroupStats();

      report.data = {
        global: stats.global,
        groupCount: Object.keys(stats.groups).length,
        groups: includeStats ? stats.groups : {},
      };

      if (includeBans) {
        const bannedList = await loadBannedUsersList();
        report.data.bans = {
          total: bannedList.users.length,
          global: bannedList.globalBans.length,
          byGroup: Object.keys(bannedList.groupBans).length,
        };
      }
    }

    logger.info('Relatório de grupos gerado', {
      type: report.type,
      groupJid: groupJid || 'global',
    });

    return report;
  } catch (error) {
    logger.error('Erro ao gerar relatório de grupos', {
      error: error.message,
      options,
    });
    return null;
  }
};

/**
 * Obtém informações de contato usando dados centralizados
 *
 * @param {String} contactJid - JID do contato
 * @returns {Promise<Object|null>} - Dados do contato
 */
const getContactInfo = async (contactJid) => {
  try {
    const contacts = await loadContactsData();

    if (contacts[contactJid]) {
      logger.debug('Informações de contato encontradas nos dados', { contactJid });
      return {
        ...contacts[contactJid],
        source: 'data_centralized',
      };
    }

    logger.debug('Contato não encontrado nos dados', { contactJid });
    return null;
  } catch (error) {
    logger.error('Erro ao obter informações de contato', {
      error: error.message,
      contactJid,
    });
    return null;
  }
};

/**
 * === EXPORTAÇÕES ===
 */

module.exports = {
  // Funções de inicialização
  initializeDirectories,

  // Funções de verificação de permissões
  isUserAdmin,
  isBotAdmin,
  isUserInGroup,

  // Funções de dados centralizados
  loadGroupsData,
  loadContactsData,
  isDataRecent,
  getGroupMetadata,
  getContactInfo,

  // Funções de estatísticas
  loadStats,
  saveStats,
  updateGroupStats,
  updateGlobalStats,

  // Funções de atividade e logs
  logGroupActivity,
  logGroupActivityWithStats,
  cleanupOldActivities,

  // Funções utilitárias
  cleanJid,
  formatPhoneToJid,
  isGroupJid,
  getBotJid,
  getAllBotGroups,

  // Funções de banimento
  loadBannedUsersList,
  saveBannedUsersList,
  addUserToBannedList,
  removeUserFromBanList,
  isUserBanned,

  // Funções de relatórios
  generateGroupsReport,

  // Constantes centralizadas
  DATA_DIR,
  GROUPS_FILE,
  CONTACTS_FILE,
  CHATS_FILE,
  METADATA_FILE,
  STATS_FILE,
  ACTIVITY_FILE,
  BANNED_USERS_FILE,
  CONFIG,
};
