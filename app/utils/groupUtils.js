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

async function createGroup(sock, title, participants) {
  try {
    const group = await sock.groupCreate(title, participants);
    logger.info(`Grupo criado com o ID: ${group.gid}`);
    await sock.sendMessage(group.id, { text: 'Olá a todos no grupo!' });
    return group;
  } catch (error) {
    logger.error(`Erro ao criar o grupo: ${error.message}`);
    throw error;
  }
}

async function updateGroupParticipants(sock, groupId, participants, action) {
  try {
    const result = await sock.groupParticipantsUpdate(groupId, participants, action);
    logger.info(`Participantes do grupo ${groupId} atualizados:`, result);
    return result;
  } catch (error) {
    logger.error(`Erro ao atualizar os participantes do grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function updateGroupSubject(sock, groupId, subject) {
  try {
    await sock.groupUpdateSubject(groupId, subject);
    logger.info(`Assunto do grupo ${groupId} atualizado para: ${subject}`);
  } catch (error) {
    logger.error(`Erro ao atualizar o assunto do grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function updateGroupDescription(sock, groupId, description) {
  try {
    await sock.groupUpdateDescription(groupId, description);
    logger.info(`Descrição do grupo ${groupId} atualizada.`);
  } catch (error) {
    logger.error(`Erro ao atualizar a descrição do grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function updateGroupSettings(sock, groupId, setting) {
  try {
    await sock.groupSettingUpdate(groupId, setting);
    logger.info(`Configurações do grupo ${groupId} atualizadas para: ${setting}`);
  } catch (error) {
    logger.error(`Erro ao atualizar as configurações do grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function leaveGroup(sock, groupId) {
  try {
    await sock.groupLeave(groupId);
    logger.info(`Saiu do grupo ${groupId}`);
  } catch (error) {
    logger.error(`Erro ao sair do grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function getGroupInviteCode(sock, groupId) {
  try {
    const code = await sock.groupInviteCode(groupId);
    logger.info(`Código de convite para o grupo ${groupId}: ${code}`);
    return code;
  } catch (error) {
    logger.error(`Erro ao obter o código de convite para o grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function revokeGroupInviteCode(sock, groupId) {
  try {
    const code = await sock.groupRevokeInvite(groupId);
    logger.info(`Código de convite para o grupo ${groupId} revogado. Novo código: ${code}`);
    return code;
  } catch (error) {
    logger.error(`Erro ao revogar o código de convite para o grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function acceptGroupInvite(sock, code) {
  try {
    const response = await sock.groupAcceptInvite(code);
    logger.info(`Entrou no grupo usando o código de convite: ${response}`);
    return response;
  } catch (error) {
    logger.error(`Erro ao aceitar o convite do grupo: ${error.message}`);
    throw error;
  }
}

async function getGroupInfoFromInvite(sock, code) {
  try {
    const response = await sock.groupGetInviteInfo(code);
    logger.info(`Informações do grupo obtidas a partir do código de convite:`, response);
    return response;
  } catch (error) {
    logger.error(`Erro ao obter informações do grupo a partir do código de convite: ${error.message}`);
    throw error;
  }
}

async function getGroupMetadata(sock, groupId) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    logger.info(`Metadados do grupo ${groupId}:`, metadata);
    return metadata;
  } catch (error) {
    logger.error(`Erro ao obter metadados do grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function acceptGroupInviteV4(sock, groupId, groupInviteMessage) {
  try {
    const response = await sock.groupAcceptInviteV4(groupId, groupInviteMessage);
    logger.info(`Entrou no grupo ${groupId} usando groupInviteMessage: ${response}`);
    return response;
  } catch (error) {
    logger.error(`Erro ao aceitar o convite do grupo ${groupId} usando groupInviteMessage: ${error.message}`);
    throw error;
  }
}

async function getGroupRequestParticipantsList(sock, groupId) {
  try {
    const response = await sock.groupRequestParticipantsList(groupId);
    logger.info(`Lista de solicitações de participação para o grupo ${groupId}:`, response);
    return response;
  } catch (error) {
    logger.error(`Erro ao obter a lista de solicitações de participação para o grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function updateGroupRequestParticipants(sock, groupId, participants, action) {
  try {
    const response = await sock.groupRequestParticipantsUpdate(groupId, participants, action);
    logger.info(`Solicitações de participação para o grupo ${groupId} atualizadas:`, response);
    return response;
  } catch (error) {
    logger.error(`Erro ao atualizar as solicitações de participação para o grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function getAllParticipatingGroups(sock) {
  try {
    const response = await sock.groupFetchAllParticipating();
    logger.info('Metadados de todos os grupos participantes obtidos:', response);
    return response;
  } catch (error) {
    logger.error(`Erro ao obter os metadados de todos os grupos participantes: ${error.message}`);
    throw error;
  }
}

async function toggleEphemeral(sock, groupId, duration) {
  try {
    await sock.groupToggleEphemeral(groupId, duration);
    logger.info(`Duração efêmera do grupo ${groupId} atualizada para: ${duration}`);
  } catch (error) {
    logger.error(`Erro ao atualizar a duração efêmera do grupo ${groupId}: ${error.message}`);
    throw error;
  }
}

async function updateGroupAddMode(sock, groupId, mode) {
  try {
    await sock.groupMemberAddMode(groupId, mode);
    logger.info(`Modo de adição de membros do grupo ${groupId} atualizado para: ${mode}`);
  } catch (error) {
    logger.error(`Erro ao atualizar o modo de adição de membros do grupo ${groupId}: ${error.message}`);
    throw error;
  }
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
  createGroup,
  updateGroupParticipants,
  updateGroupSubject,
  updateGroupDescription,
  updateGroupSettings,
  leaveGroup,
  getGroupInviteCode,
  revokeGroupInviteCode,
  acceptGroupInvite,
  getGroupInfoFromInvite,
  getGroupMetadata,
  acceptGroupInviteV4,
  getGroupRequestParticipantsList,
  updateGroupRequestParticipants,
  getAllParticipatingGroups,
  toggleEphemeral,
  updateGroupAddMode,
};
