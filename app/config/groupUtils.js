/* eslint-disable no-unused-vars */
import logger from '../utils/logger/loggerModule.js';
import { findById, findAll, TABLES } from '../../database/index.js';
import { extractUserIdInfo, resolveUserIdCached } from '../services/lidMapService.js';

/**
 * Valida um ID de grupo ou usuário.
 * @param {string} id - O ID a ser validado.
 * @param {string} type - O tipo de ID ('Grupo' ou 'Usuário').
 * @returns {boolean} True se o ID for válido, false caso contrário.
 */
export function _isValidId(id, type = 'ID') {
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
export async function getGroupInfo(groupId) {
  return await getGroupInfoAsync(groupId);
}

/**
 * Retorna o assunto (nome) de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {string|null} O assunto do grupo ou null se não encontrado.
 */
export async function getGroupSubject(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return group?.subject || null;
}

/**
 * Retorna a lista de participantes de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {Array<object>|null} A lista de participantes ou null se não encontrado.
 */
export async function getGroupParticipants(groupId) {
  return await getGroupParticipantsAsync(groupId);
}

/**
 * Extrai o ID do usuário (canônico quando possível).
 * @param {object|string} userObj - Objeto de mensagem ou string do ID.
 * @returns {string|null} O ID do usuário ou null se não encontrado.
 */
export function extractUserId(userObj) {
  if (!userObj) return null;
  const info = extractUserIdInfo(userObj);
  const canonical = resolveUserIdCached(info);
  return canonical || info.raw || null;
}

/**
 * Verifica se um usuário é administrador em um grupo específico.
 * Aceita tanto string quanto objeto de mensagem para userId.
 * @param {string} groupId - O ID do grupo.
 * @param {string|object} userIdOrObj - O ID do usuário ou objeto de mensagem.
 * @returns {boolean} True se o usuário for admin, false caso contrário.
 */
export async function isUserAdmin(groupId, userIdOrObj) {
  return await isUserAdminAsync(groupId, userIdOrObj);
}

export function _normalizeDigits(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\D/g, '');
}

export function _matchesParticipantId(participant, userId) {
  if (!participant || !userId) return false;
  if (participant.id && participant.id === userId) return true;
  if (participant.lid && participant.lid === userId) return true;
  if (participant.jid && participant.jid === userId) return true;

  const participantCanonical = resolveUserIdCached({
    lid: participant.lid || participant.id || null,
    jid: participant.jid || participant.id || null,
    participantAlt: null,
  });
  const userCanonical = resolveUserIdCached({ lid: userId, jid: userId, participantAlt: null });
  if (participantCanonical && userCanonical && participantCanonical === userCanonical) return true;

  const pDigits = _normalizeDigits(participant.id || participant.lid || participant.jid || '');
  const uDigits = _normalizeDigits(userId);
  if (pDigits && uDigits && (pDigits === uDigits || pDigits.endsWith(uDigits) || uDigits.endsWith(pDigits))) {
    return true;
  }

  return false;
}

/**
 * Busca as informações do grupo no banco de dados.
 * @param {string} groupId
 * @returns {Promise<object|null>} objeto do grupo ou null
 */
export async function getGroupInfoAsync(groupId) {
  if (!_isValidId(groupId, 'Grupo')) return null;
  try {
    const row = await findById(TABLES.GROUPS_METADATA, groupId);
    if (!row) return null;
    const data = Array.isArray(row) ? row[0] : row;
    if (!data) return null;

    let participants = data.participants || data.participants_json || null;
    if (typeof participants === 'string') {
      try {
        participants = JSON.parse(participants);
      } catch (e) {
        participants = null;
      }
    }

    const group = {
      id: data.id,
      subject: data.subject || data.name || null,
      desc: data.description || data.desc || null,
      owner: data.owner_jid || data.owner || null,
      creation: data.creation || null,
      participants: Array.isArray(participants) ? participants : [],
    };
    group.size = group.participants.length;
    return group;
  } catch (error) {
    logger.error(`Erro ao buscar grupo do DB ${groupId}: ${error.message}`, { error });
    return null;
  }
}

export async function getGroupParticipantsAsync(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return group ? group.participants : null;
}

export async function isUserAdminAsync(groupId, userIdOrObj) {
  const userId = extractUserId(userIdOrObj);
  if (!_isValidId(groupId, 'Grupo') || !_isValidId(userId, 'Usuário')) return false;
  const participants = await getGroupParticipantsAsync(groupId);
  if (!participants) return false;
  const participant = participants.find((p) => _matchesParticipantId(p, userId));
  return !!participant && (participant.admin === 'admin' || participant.admin === 'superadmin' || participant.isAdmin === true);
}

export async function getGroupAdminsAsync(groupId) {
  const participants = await getGroupParticipantsAsync(groupId);
  if (!participants) return [];
  return participants
    .filter((p) => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin === true)
    .map((p) => p.id || p.lid || p.jid || null)
    .filter(Boolean);
}

/**
 * Retorna todos os IDs de grupo disponíveis.
 * @returns {Array<string>} Uma lista de IDs de grupo.
 */
export async function getAllGroupIds() {
  try {
    const rows = await findAll(TABLES.GROUPS_METADATA, 10000, 0);
    if (!rows || !Array.isArray(rows)) return [];
    return rows.map((r) => r.id || r[Object.keys(r)[0]]).filter(Boolean);
  } catch (error) {
    logger.error('Erro ao buscar todos os IDs de grupos do DB', { error });
    return [];
  }
}

/**
 * Retorna o proprietário de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {string|null} O ID do proprietário do grupo ou null se não encontrado.
 */
export async function getGroupOwner(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return group?.owner || null;
}

/**
 * Retorna o timestamp de criação de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {number|null} O timestamp de criação do grupo ou null se não encontrado.
 */
export async function getGroupCreationTime(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return group?.creation || null;
}

/**
 * Retorna a descrição de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {string|null} A descrição do grupo ou null se não encontrado.
 */
export async function getGroupDescription(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return group?.desc || null;
}

/**
 * Retorna o número de participantes de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {number|null} O número de participantes do grupo ou null se não encontrado.
 */
export async function getGroupSize(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return group?.size || null;
}

/**
 * Verifica se um grupo é restrito.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for restrito, false caso contrário.
 */
export async function isGroupRestricted(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return !!group?.restrict;
}

/**
 * Verifica se um grupo é apenas para anúncios.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for apenas para anúncios, false caso contrário.
 */
export async function isGroupAnnounceOnly(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return !!group?.announce;
}

/**
 * Verifica se um grupo é uma comunidade.
 * @param {string} groupId - O ID do grupo.
 * @returns {boolean} True se o grupo for uma comunidade, false caso contrário.
 */
export async function isGroupCommunity(groupId) {
  const group = await getGroupInfoAsync(groupId);
  return !!group?.isCommunity;
}

/**
 * Retorna uma lista de IDs dos administradores de um grupo específico.
 * @param {string} groupId - O ID do grupo.
 * @returns {Array<string>} Uma lista de IDs dos administradores do grupo.
 */
export async function getGroupAdmins(groupId) {
  return await getGroupAdminsAsync(groupId);
}

/**
 * Executa uma função de grupo de forma segura, validando os parâmetros e tratando erros.
 * @param {object} sock - A instância do socket Baileys.
 * @param {string} functionName - O nome da função a ser executada.
 * @param {Array} args - Os argumentos para a função.
 * @param {string} errorMessage - A mensagem de erro a ser registrada.
 */
export async function _safeGroupApiCall(sock, functionName, args, errorMessage) {
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

export async function createGroup(sock, title, participants) {
  if (typeof title !== 'string' || title.trim() === '' || !Array.isArray(participants)) {
    throw new Error('Título ou participantes inválidos.');
  }
  const result = await _safeGroupApiCall(sock, 'groupCreate', [title, participants], 'Erro ao criar grupo');
  logger.info(`Grupo "${title}" criado com sucesso.`, { id: result.id });
  return result;
}

export async function updateGroupParticipants(sock, groupId, participants, action) {
  if (!_isValidId(groupId, 'Grupo') || !Array.isArray(participants) || !action) {
    throw new Error('Argumentos inválidos para atualizar participantes.');
  }
  return _safeGroupApiCall(sock, 'groupParticipantsUpdate', [groupId, participants, action], `Erro ao ${action} participantes no grupo ${groupId}`);
}

export async function updateGroupSubject(sock, groupId, subject) {
  if (!_isValidId(groupId, 'Grupo') || typeof subject !== 'string') {
    throw new Error('Argumentos inválidos para atualizar assunto do grupo.');
  }
  return _safeGroupApiCall(sock, 'groupUpdateSubject', [groupId, subject], `Erro ao atualizar assunto do grupo ${groupId}`);
}

export async function updateGroupDescription(sock, groupId, description) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(sock, 'groupUpdateDescription', [groupId, description], `Erro ao atualizar descrição do grupo ${groupId}`);
}

export async function updateGroupSettings(sock, groupId, setting) {
  if (!_isValidId(groupId, 'Grupo') || !setting) {
    throw new Error('Argumentos inválidos para atualizar configurações do grupo.');
  }
  return _safeGroupApiCall(sock, 'groupSettingUpdate', [groupId, setting], `Erro ao atualizar configurações do grupo ${groupId}`);
}

export async function leaveGroup(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(sock, 'groupLeave', [groupId], `Erro ao sair do grupo ${groupId}`);
}

export async function getGroupInviteCode(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(sock, 'groupInviteCode', [groupId], `Erro ao obter código de convite do grupo ${groupId}`);
}

export async function revokeGroupInviteCode(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(sock, 'groupRevokeInvite', [groupId], `Erro ao revogar código de convite do grupo ${groupId}`);
}

export async function acceptGroupInvite(sock, code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('Código de convite inválido.');
  }
  return _safeGroupApiCall(sock, 'groupAcceptInvite', [code], 'Erro ao aceitar convite de grupo');
}

export async function getGroupInfoFromInvite(sock, code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('Código de convite inválido.');
  }
  return _safeGroupApiCall(sock, 'groupGetInviteInfo', [code], 'Erro ao obter informações do convite');
}

export async function getGroupMetadata(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(sock, 'groupMetadata', [groupId], `Erro ao obter metadados do grupo ${groupId}`);
}

export async function getGroupRequestParticipantsList(sock, groupId) {
  if (!_isValidId(groupId, 'Grupo')) {
    throw new Error('ID de grupo inválido.');
  }
  return _safeGroupApiCall(sock, 'groupRequestParticipantsList', [groupId], `Erro ao listar solicitações de entrada no grupo ${groupId}`);
}

export async function updateGroupRequestParticipants(sock, groupId, participants, action) {
  if (!_isValidId(groupId, 'Grupo') || !Array.isArray(participants) || !action) {
    throw new Error('Argumentos inválidos para atualizar solicitações de entrada.');
  }
  return _safeGroupApiCall(sock, 'groupRequestParticipantsUpdate', [groupId, participants, action], `Erro ao atualizar solicitações de entrada no grupo ${groupId}`);
}

export async function getAllParticipatingGroups(sock) {
  return _safeGroupApiCall(sock, 'groupFetchAllParticipating', [], 'Erro ao obter todos os grupos participantes');
}

export async function toggleEphemeral(sock, groupId, duration) {
  if (!_isValidId(groupId, 'Grupo') || typeof duration !== 'number') {
    throw new Error('Argumentos inválidos para alternar mensagens efêmeras.');
  }
  return _safeGroupApiCall(sock, 'groupToggleEphemeral', [groupId, duration], `Erro ao alternar mensagens efêmeras no grupo ${groupId}`);
}

export async function updateGroupAddMode(sock, groupId, mode) {
  if (!_isValidId(groupId, 'Grupo') || !mode) {
    throw new Error('Argumentos inválidos para atualizar modo de adição.');
  }
  return _safeGroupApiCall(sock, 'groupMemberAddMode', [groupId, mode], `Erro ao atualizar modo de adição no grupo ${groupId}`);
}
