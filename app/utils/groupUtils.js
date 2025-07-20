const fs = require('fs');
const path = require('path');
const logger = require('./logger/loggerModule');

const GROUPS_FILE_PATH = path.join(process.cwd(), process.env.STORE_PATH || './temp/', 'groups.json');

/**
 * Carrega os dados do arquivo groups.json.
 * @returns {object} Os dados dos grupos ou um objeto vazio se houver erro.
 */
function _loadGroupsData() {
  try {
    const groupsContent = fs.readFileSync(GROUPS_FILE_PATH, 'utf8');
    return JSON.parse(groupsContent);
  } catch (error) {
    logger.error(`Erro ao carregar groups.json: ${error.message}`);
    return {};
  }
}

/**
 * Retorna todos os dados de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {object|null} Os dados do grupo ou null se não encontrado.
 */
function getGroupInfo(groupId) {
  const groupsData = _loadGroupsData();
  return groupsData[groupId] || null;
}

/**
 * Retorna o assunto (nome) de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {string|null} O assunto do grupo ou null se não encontrado.
 */
function getGroupSubject(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.subject : null;
}

/**
 * Retorna a lista de participantes de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {Array<object>|null} A lista de participantes do grupo ou null se não encontrado.
 */
function getGroupParticipants(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.participants : null;
}

/**
 * Verifica se um usuário é administrador em um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @param {string} userId - O ID do usuário.
 * @returns {boolean} True se o usuário for admin, false caso contrário.
 */
function isUserAdmin(groupId, userId) {
  const participants = getGroupParticipants(groupId);
  if (!participants) {
    return false;
  }
  const participant = participants.find((p) => p.id === userId);
  return participant ? participant.admin === 'admin' || participant.admin === 'superadmin' : false;
}

/**
 * Retorna todos os IDs de grupo disponíveis.
 * @returns {Array<string>} Uma lista de IDs de grupo.
 */
function getAllGroupIds() {
  const groupsData = _loadGroupsData();
  return Object.keys(groupsData);
}

/**
 * Retorna o proprietário de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {string|null} O ID do proprietário do grupo ou null se não encontrado.
 */
function getGroupOwner(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.owner : null;
}

/**
 * Retorna o timestamp de criação de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {number|null} O timestamp de criação do grupo ou null se não encontrado.
 */
function getGroupCreationTime(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.creation : null;
}

/**
 * Retorna a descrição de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {string|null} A descrição do grupo ou null se não encontrado.
 */
function getGroupDescription(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.desc : null;
}

/**
 * Retorna o número de participantes de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {number|null} O número de participantes do grupo ou null se não encontrado.
 */
function getGroupSize(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.size : null;
}

/**
 * Verifica se um grupo é restrito.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for restrito, false caso contrário.
 */
function isGroupRestricted(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.restrict : false;
}

/**
 * Verifica se um grupo é apenas para anúncios.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for apenas para anúncios, false caso contrário.
 */
function isGroupAnnounceOnly(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.announce : false;
}

/**
 * Verifica se um grupo é uma comunidade.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for uma comunidade, false caso contrário.
 */
function isGroupCommunity(groupId) {
  const group = getGroupInfo(groupId);
  return group ? group.isCommunity : false;
}

/**
 * Retorna uma lista de IDs dos administradores de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {Array<string>} Uma lista de IDs dos administradores do grupo.
 */
function getGroupAdmins(groupId) {
  const participants = getGroupParticipants(groupId);
  if (!participants) {
    return [];
  }
  return participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').map((p) => p.id);
}

/**
 * Retorna uma lista de IDs de grupos que um usuário específico participa.
 * @param {string} userId - O ID do usuário.
 * @returns {Array<string>} Uma lista de IDs de grupos que o usuário participa.
 */
function getGroupsByParticipant(userId) {
  const groupsData = _loadGroupsData();
  const groupIds = [];
  for (const groupId in groupsData) {
    const participants = groupsData[groupId].participants;
    if (participants && participants.some((p) => p.id === userId)) {
      groupIds.push(groupId);
    }
  }
  return groupIds;
}

/**
 * Retorna uma lista de IDs de grupos cujo assunto contém uma palavra-chave.
 * A pesquisa não diferencia maiúsculas de minúsculas.
 * @param {string} keyword - A palavra-chave a ser pesquisada no assunto do grupo.
 * @returns {Array<string>} Uma lista de IDs de grupos que correspondem à palavra-chave.
 */
function getGroupsBySubjectKeyword(keyword) {
  const groupsData = _loadGroupsData();
  const matchingGroupIds = [];
  const lowerCaseKeyword = keyword.toLowerCase();
  for (const groupId in groupsData) {
    const subject = groupsData[groupId].subject;
    if (subject && subject.toLowerCase().includes(lowerCaseKeyword)) {
      matchingGroupIds.push(groupId);
    }
  }
  return matchingGroupIds;
}

module.exports = {
  getGroupInfo,
  getGroupSubject,
  getGroupParticipants,
  isUserAdmin,
  getAllGroupIds,
  getGroupOwner,
  getGroupCreationTime,
  getGroupDescription,
  getGroupSize,
  isGroupRestricted,
  isGroupAnnounceOnly,
  isGroupCommunity,
  getGroupAdmins,
  getGroupsByParticipant,
  getGroupsBySubjectKeyword,
};
