const fs = require('fs');
const path = require('path');
const logger = require('./logger/loggerModule');

const GROUPS_FILE_PATH = path.join(
  process.cwd(),
  process.env.STORE_PATH || './temp/',
  'groups.json',
);

/**
 * Carrega os dados do arquivo groups.json de forma segura.
 * @returns {object} Os dados dos grupos ou um objeto vazio se o arquivo não existir ou ocorrer um erro.
 */
function _loadGroupsData() {
  if (!fs.existsSync(GROUPS_FILE_PATH)) {
    logger.warn(`Arquivo de grupos não encontrado em: ${GROUPS_FILE_PATH}`);
    return {};
  }
  try {
    const groupsContent = fs.readFileSync(GROUPS_FILE_PATH, 'utf8');
    return JSON.parse(groupsContent);
  } catch (error) {
    logger.error(`Erro ao carregar ou analisar o arquivo groups.json: ${error.message}`, {
      path: GROUPS_FILE_PATH,
      error,
    });
    return {};
  }
}

/**
 * Valida um ID de grupo ou usuário.
 * @param {string} id - O ID a ser validado.
 * @param {string} type - O tipo de ID ('Grupo' ou 'Usuário').
 * @returns {boolean} True se o ID for válido, false caso contrário.
 */
function _isValidId(id, type = 'ID') {
  if (typeof id !== 'string' || id.trim() === '') {
    logger.warn(`Tentativa de operação com ${type} inválido.`, { id });
    return false;
  }
  return true;
}

/**
 * Retorna todos os dados de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {object|null} Os dados do grupo ou null se não encontrado ou se o ID for inválido.
 */
function getGroupInfo(groupId) {
  if (!_isValidId(groupId, 'Grupo')) return null;
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
  return group?.subject || null;
}

/**
 * Retorna a lista de participantes de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {Array<object>|null} A lista de participantes ou null se não encontrado.
 */
function getGroupParticipants(groupId) {
  const group = getGroupInfo(groupId);
  return group?.participants || null;
}

/**
 * Verifica se um usuário é administrador em um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @param {string} userId - O ID do usuário.
 * @returns {boolean} True se o usuário for admin, false caso contrário.
 */
function isUserAdmin(groupId, userId) {
  if (!_isValidId(groupId, 'Grupo') || !_isValidId(userId, 'Usuário')) return false;
  const participants = getGroupParticipants(groupId);
  if (!participants) return false;
  const participant = participants.find((p) => p.id === userId);
  return !!participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
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
  return group?.owner || null;
}

/**
 * Retorna o timestamp de criação de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {number|null} O timestamp de criação do grupo ou null se não encontrado.
 */
function getGroupCreationTime(groupId) {
  const group = getGroupInfo(groupId);
  return group?.creation || null;
}

/**
 * Retorna a descrição de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {string|null} A descrição do grupo ou null se não encontrado.
 */
function getGroupDescription(groupId) {
  const group = getGroupInfo(groupId);
  return group?.desc || null;
}

/**
 * Retorna o número de participantes de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {number|null} O número de participantes do grupo ou null se não encontrado.
 */
function getGroupSize(groupId) {
  const group = getGroupInfo(groupId);
  return group?.size || null;
}

/**
 * Verifica se um grupo é restrito.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for restrito, false caso contrário.
 */
function isGroupRestricted(groupId) {
  const group = getGroupInfo(groupId);
  return !!group?.restrict;
}

/**
 * Verifica se um grupo é apenas para anúncios.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for apenas para anúncios, false caso contrário.
 */
function isGroupAnnounceOnly(groupId) {
  const group = getGroupInfo(groupId);
  return !!group?.announce;
}

/**
 * Verifica se um grupo é uma comunidade.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for uma comunidade, false caso contrário.
 */
function isGroupCommunity(groupId) {
  const group = getGroupInfo(groupId);
  return !!group?.isCommunity;
}

/**
 * Retorna uma lista de IDs dos administradores de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {Array<string>} Uma lista de IDs dos administradores do grupo.
 */
function getGroupAdmins(groupId) {
  const participants = getGroupParticipants(groupId);
  if (!participants) return [];
  return participants
    .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
    .map((p) => p.id);
}

// Funções que interagem com a API (sock)

/**
 * Executa uma função de grupo de forma segura, validando os parâmetros e tratando erros.
 * @param {object} sock - A instância do socket Baileys.
 * @param {string} functionName - O nome da função a ser executada.
 * @param {Array} args - Os argumentos para a função.
 * @param {string} errorMessage - A mensagem de erro a ser registrada.
 */
async function _safeGroupApiCall(sock, functionName, args, errorMessage) {
  if (!sock || typeof sock[functionName] !== 'function') {
    logger.error(`Objeto de socket inválido ou função ${functionName} não encontrada.`);
    throw new Error(`Socket inválido para a operação ${functionName}.`);
  }
  try {
    return await sock[functionName](...args);
  } catch (error) {
    logger.error(errorMessage, {
      function: functionName,
      args,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function createGroup(sock, title, participants) {
  if (typeof title !== 'string' || title.trim() === '' || !Array.isArray(participants)) {
    throw new Error('Título ou participantes inválidos.');
  }
  const result = await _safeGroupApiCall(
    sock,
    'groupCreate',
    [title, participants],
    'Erro ao criar grupo',
  );
  logger.info(`Grupo "${title}" criado com sucesso.`, { id: result.id });
  return result;
}

async function updateGroupParticipants(sock, groupId, participants, action) {
  if (!_isValidId(groupId, 'Grupo') || !Array.isArray(participants) || !action) {
    throw new Error('Argumentos inválidos para atualizar participantes.');
  }
  return _safeGroupApiCall(
    sock,
    'groupParticipantsUpdate',
    [groupId, participants, action],
    `Erro ao ${action} participantes no grupo ${groupId}`,
  );
}

async function updateGroupSubject(sock, groupId, subject) {
  if (!_isValidId(groupId, 'Grupo') || typeof subject !== 'string') {
    throw new Error('Argumentos inválidos para atualizar assunto do grupo.');
  }
  return _safeGroupApiCall(
    sock,
    'groupUpdateSubject',
    [groupId, subject],
    `Erro ao atualizar assunto do grupo ${groupId}`,
  );
}

async function updateGroupDescription(sock, groupId, description) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(
    sock,
    'groupUpdateDescription',
    [groupId, description],
    `Erro ao atualizar descrição do grupo ${groupId}`,
  );
}

async function updateGroupSettings(sock, groupId, setting) {
  if (!_isValidId(groupId, 'Grupo') || !setting) {
    throw new Error('Argumentos inválidos para atualizar configurações do grupo.');
  }
  return _safeGroupApiCall(
    sock,
    'groupSettingUpdate',
    [groupId, setting],
    `Erro ao atualizar configurações do grupo ${groupId}`,
  );
}

async function leaveGroup(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(sock, 'groupLeave', [groupId], `Erro ao sair do grupo ${groupId}`);
}

async function getGroupInviteCode(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(
    sock,
    'groupInviteCode',
    [groupId],
    `Erro ao obter código de convite do grupo ${groupId}`,
  );
}

async function revokeGroupInviteCode(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(
    sock,
    'groupRevokeInvite',
    [groupId],
    `Erro ao revogar código de convite do grupo ${groupId}`,
  );
}

async function acceptGroupInvite(sock, code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('Código de convite inválido.');
  }
  return _safeGroupApiCall(
    sock,
    'groupAcceptInvite',
    [code],
    'Erro ao aceitar convite de grupo',
  );
}

async function getGroupInfoFromInvite(sock, code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('Código de convite inválido.');
  }
  return _safeGroupApiCall(
    sock,
    'groupGetInviteInfo',
    [code],
    'Erro ao obter informações do convite',
  );
}

async function getGroupMetadata(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(
    sock,
    'groupMetadata',
    [groupId],
    `Erro ao obter metadados do grupo ${groupId}`,
  );
}

async function getGroupRequestParticipantsList(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(
    sock,
    'groupRequestParticipantsList',
    [groupId],
    `Erro ao listar solicitações de entrada no grupo ${groupId}`,
  );
}

async function updateGroupRequestParticipants(sock, groupId, participants, action) {
  if (!_isValidId(groupId, 'Grupo') || !Array.isArray(participants) || !action) {
    throw new Error('Argumentos inválidos para atualizar solicitações de entrada.');
  }
  return _safeGroupApiCall(
    sock,
    'groupRequestParticipantsUpdate',
    [groupId, participants, action],
    `Erro ao atualizar solicitações de entrada no grupo ${groupId}`,
  );
}

async function getAllParticipatingGroups(sock) {
  return _safeGroupApiCall(
    sock,
    'groupFetchAllParticipating',
    [],
    'Erro ao obter todos os grupos participantes',
  );
}

async function toggleEphemeral(sock, groupId, duration) {
  if (!_isValidId(groupId, 'Grupo') || typeof duration !== 'number') {
    throw new Error('Argumentos inválidos para alternar mensagens efêmeras.');
  }
  return _safeGroupApiCall(
    sock,
    'groupToggleEphemeral',
    [groupId, duration],
    `Erro ao alternar mensagens efêmeras no grupo ${groupId}`,
  );
}

async function updateGroupAddMode(sock, groupId, mode) {
  if (!_isValidId(groupId, 'Grupo') || !mode) {
    throw new Error('Argumentos inválidos para atualizar modo de adição.');
  }
  return _safeGroupApiCall(
    sock,
    'groupMemberAddMode',
    [groupId, mode],
    `Erro ao atualizar modo de adição no grupo ${groupId}`,
  );
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
  getGroupRequestParticipantsList,
  updateGroupRequestParticipants,
  getAllParticipatingGroups,
  toggleEphemeral,
  updateGroupAddMode,
};