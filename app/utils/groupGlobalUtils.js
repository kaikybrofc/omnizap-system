/**
 * OmniZap Group Global Utils - Otimizado
 *
 * Utilitários globais para operações com grupos, otimizados para baixo consumo de memória e alta performance.
 * Utiliza o eventHandler como fonte central de dados, evitando I/O de arquivo direto.
 *
 * @version 4.0.0
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('./logger/loggerModule');
const { eventHandler } = require('../events/eventHandler');

/**
 * === FUNÇÕES DE VERIFICAÇÃO DE PERMISSÕES ===
 */

/**
 * Verifica se um usuário é administrador do grupo.
 * @param {string} groupJid - ID do grupo.
 * @param {string} userJid - ID do usuário.
 * @returns {Promise<boolean>} - True se o usuário for administrador.
 */
const isUserAdmin = async (groupJid, userJid) => {
  try {
    const groupMetadata = await getGroupMetadata(groupJid);
    if (!groupMetadata || !groupMetadata.participants) return false;

    const cleanUserJid = cleanJid(userJid);
    const member = groupMetadata.participants.find((p) => cleanJid(p.id) === cleanUserJid);

    return member ? ['admin', 'superadmin'].includes(member.admin) : false;
  } catch (error) {
    logger.error('Erro ao verificar administrador', { groupJid, userJid, error: error.message });
    return false;
  }
};

/**
 * Verifica se o bot é administrador do grupo.
 * @param {string} groupJid - ID do grupo.
 * @returns {Promise<boolean>} - True se o bot for administrador.
 */
const isBotAdmin = async (groupJid) => {
  try {
    const botJid = getBotJid();
    if (!botJid) {
      logger.warn('JID do bot não encontrado para verificar admin.', { groupJid });
      return false;
    }
    return await isUserAdmin(groupJid, botJid);
  } catch (error) {
    logger.error('Erro ao verificar se o bot é admin', { groupJid, error: error.message });
    return false;
  }
};

/**
 * Verifica se um usuário está em um grupo.
 * @param {string} groupJid - ID do grupo.
 * @param {string} userJid - ID do usuário.
 * @returns {Promise<boolean>} - True se o usuário estiver no grupo.
 */
const isUserInGroup = async (groupJid, userJid) => {
  try {
    const groupMetadata = await getGroupMetadata(groupJid);
    if (!groupMetadata || !groupMetadata.participants) return false;

    const cleanUserJid = cleanJid(userJid);
    return groupMetadata.participants.some((p) => cleanJid(p.id) === cleanUserJid);
  } catch (error) {
    logger.error('Erro ao verificar se usuário está no grupo', { groupJid, userJid, error: error.message });
    return false;
  }
};

/**
 * === FUNÇÕES DE DADOS DO GRUPO ===
 */

/**
 * Obtém metadados de um grupo do cache do eventHandler.
 * @param {string} groupJid - ID do grupo.
 * @param {boolean} forceRefresh - Forçar busca na API (usar com cuidado).
 * @returns {Promise<Object|null>} - Metadados do grupo.
 */
const getGroupMetadata = async (groupJid, forceRefresh = false) => {
  try {
    if (!groupJid) {
      logger.warn('JID do grupo não fornecido para getGroupMetadata');
      return null;
    }

    // Prioriza o cache, a menos que a atualização seja forçada.
    if (!forceRefresh) {
      const cachedMetadata = eventHandler.getGroup(groupJid);
      if (cachedMetadata) {
        logger.debug('Metadados do grupo obtidos do cache.', { groupJid });
        return cachedMetadata;
      }
    }

    // Se não estiver no cache ou se for forçado, busca via API.
    logger.debug('Buscando metadados do grupo via API.', { groupJid, forceRefresh });
    return await eventHandler.getOrFetchGroupMetadata(groupJid);

  } catch (error) {
    logger.error('Erro ao obter metadados do grupo', { groupJid, error: error.message });
    return null;
  }
};

/**
 * Obtém informações de um contato do cache do eventHandler.
 * @param {string} contactJid - JID do contato.
 * @returns {Promise<Object|null>} - Dados do contato.
 */
const getContactInfo = async (contactJid) => {
  try {
    const contactInfo = eventHandler.getContact(contactJid);
    if (contactInfo) {
      logger.debug('Informações de contato obtidas do cache.', { contactJid });
    }
    return contactInfo;
  } catch (error) {
    logger.error('Erro ao obter informações de contato', { contactJid, error: error.message });
    return null;
  }
};

/**
 * === FUNÇÕES DE ESTATÍSTICAS E ATIVIDADE (Simplificado) ===
 */

/**
 * Registra uma atividade de grupo.
 * Esta função agora é um wrapper para o sistema de eventos, que pode ser usado para estatísticas.
 * @param {string} groupJid - ID do grupo.
 * @param {string} activityType - Tipo de atividade.
 * @param {Object} activityData - Dados da atividade.
 */
const logGroupActivity = (groupJid, activityType, activityData = {}) => {
  try {
    logger.debug('Registrando atividade de grupo via eventHandler.', { groupJid, activityType });
    eventHandler.executeCallbacks('group.activity', {
      groupJid,
      activityType,
      ...activityData,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Erro ao registrar atividade de grupo', { groupJid, activityType, error: error.message });
  }
};

/**
 * === FUNÇÕES UTILITÁRIAS ===
 */

/**
 * Limpa um JID removendo sufixos.
 * @param {string} jid - JID a ser limpo.
 * @returns {string} - JID limpo.
 */
const cleanJid = (jid) => {
  if (!jid) return '';
  return jid.split(':')[0].split('@')[0] + (jid.includes('@g.us') ? '@g.us' : '@s.whatsapp.net');
};

/**
 * Formata um número de telefone para o formato JID.
 * @param {string} phoneNumber - Número de telefone.
 * @returns {string} - JID formatado.
 */
const formatPhoneToJid = (phoneNumber) => {
  if (!phoneNumber) return '';
  let cleaned = phoneNumber.replace(/\D/g, '');
  if (cleaned.length <= 11) {
    cleaned = '55' + cleaned;
  }
  return `${cleaned}@s.whatsapp.net`;
};

/**
 * Verifica se um JID é de um grupo.
 * @param {string} jid - JID a ser verificado.
 * @returns {boolean} - True se for JID de grupo.
 */
const isGroupJid = (jid) => {
  return jid && jid.endsWith('@g.us');
};

/**
 * Obtém o JID do bot a partir do cliente WhatsApp gerenciado pelo eventHandler.
 * @returns {string|null} - JID do bot.
 */
const getBotJid = () => {
  try {
    const client = eventHandler.getWhatsAppClient();
    return client?.user?.id || null;
  } catch (error) {
    logger.error('Erro ao obter JID do bot', { error: error.message });
    return null;
  }
};

/**
 * Obtém todos os grupos dos quais o bot participa, usando o cache.
 * @returns {Promise<string[]>} - Lista de JIDs de grupos.
 */
const getAllBotGroups = async () => {
  try {
    const groups = eventHandler.groupCache.keys();
    return groups.filter(isGroupJid);
  } catch (error) {
    logger.error('Erro ao obter grupos do bot do cache', { error: error.message });
    return [];
  }
};

/**
 * === FUNÇÕES DE BANIMENTO (Simplificado) ===
 */

// A lógica de banimento foi simplificada e pode ser gerenciada por um módulo dedicado
// ou através de um sistema de callbacks no eventHandler para manter este módulo leve.

/**
 * Adiciona um usuário à lista de banidos (exemplo de implementação).
 * A gestão de estado (lista de banidos) deve ser feita externamente.
 * @param {string} userJid - JID do usuário.
 * @param {string} groupJid - JID do grupo (opcional).
 */
const banUser = (userJid, groupJid = null) => {
  logger.info('Banimento de usuário solicitado.', { userJid, groupJid });
  // Exemplo: Disparar um evento que será tratado por outro módulo
  eventHandler.executeCallbacks('user.ban', { userJid, groupJid, timestamp: Date.now() });
};

/**
 * Remove um usuário da lista de banidos (exemplo).
 * @param {string} userJid - JID do usuário.
 * @param {string} groupJid - JID do grupo (opcional).
 */
const unbanUser = (userJid, groupJid = null) => {
  logger.info('Remoção de banimento de usuário solicitada.', { userJid, groupJid });
  eventHandler.executeCallbacks('user.unban', { userJid, groupJid, timestamp: Date.now() });
};

/**
 * === EXPORTAÇÕES ===
 */

module.exports = {
  // Funções de verificação de permissões
  isUserAdmin,
  isBotAdmin,
  isUserInGroup,

  // Funções de dados
  getGroupMetadata,
  getContactInfo,

  // Funções de atividade
  logGroupActivity,

  // Funções utilitárias
  cleanJid,
  formatPhoneToJid,
  isGroupJid,
  getBotJid,
  getAllBotGroups,

  // Funções de banimento (simplificadas)
  banUser,
  unbanUser,
};
