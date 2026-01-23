import logger from '../utils/logger/loggerModule.js';
import { findById, upsert } from '../../database/index.js';

const GROUP_METADATA_FIELDS = [
  'id',
  'subject',
  'description',
  'owner_jid',
  'creation',
  'participants',
];

const PARTICIPANT_ACTIONS = new Set(['add', 'remove', 'promote', 'demote']);

/**
 * Normaliza o campo `participants` para o formato persistido no banco.
 * @param {unknown} value - Valor bruto de participantes.
 * @returns {string | null | undefined} JSON string, null ou undefined.
 */
const normalizeParticipantsValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    logger.warn('Erro ao serializar participantes para persistência.', { error: error.message });
    return null;
  }
};

/**
 * Faz parse do campo `participants` armazenado no banco.
 * @param {string | Array<Object> | null | undefined} participants - Valor armazenado.
 * @returns {Array<Object>} Lista de participantes normalizada.
 */
export const parseParticipantsFromDb = (participants) => {
  if (!participants) return [];
  try {
    if (typeof participants === 'string') return JSON.parse(participants);
    if (Array.isArray(participants)) return participants;
  } catch (error) {
    const preview = typeof participants === 'string' ? participants.slice(0, 200) : null;
    logger.warn('Erro ao fazer parse dos participantes salvos no banco.', {
      error: error.message,
      preview,
    });
  }
  return [];
};

/**
 * Normaliza um participante para o formato padrão (id/jid/lid/admin).
 * @param {string | Object | null | undefined} participant - Participante bruto.
 * @returns {Object | null} Participante normalizado ou null.
 */
export const normalizeParticipant = (participant) => {
  if (!participant) return null;
  if (typeof participant === 'string') {
    return {
      id: participant,
      jid: participant,
      lid: null,
      admin: null,
    };
  }

  const id = participant.id || participant.jid || null;
  const jid = participant.jid || participant.id || null;

  if (!id && !jid) return null;

  return {
    id: id || jid,
    jid: jid || id,
    lid: participant.lid || null,
    admin: participant.admin || null,
  };
};

/**
 * Gera chave canônica para dedupe.
 * @param {Object | null} participant - Participante normalizado.
 * @returns {string | null} Chave canônica ou null.
 */
export const getParticipantKey = (participant) => {
  if (!participant) return null;
  return participant.jid || participant.id || null;
};

/**
 * Normaliza a lista de participantes.
 * @param {Array<Object | string>} [participants=[]] - Lista de participantes.
 * @returns {Array<Object>} Lista normalizada e filtrada.
 */
export const normalizeParticipantsList = (participants = []) => {
  if (!Array.isArray(participants)) return [];
  return participants
    .map(normalizeParticipant)
    .filter((participant) => participant && (participant.jid || participant.id));
};

/**
 * Monta payload com os campos suportados para persistência.
 * @param {Object} data - Dados de grupo.
 * @returns {Object} Payload filtrado e normalizado.
 */
const buildGroupMetadataPayload = (data) => {
  const payload = {};
  for (const field of GROUP_METADATA_FIELDS) {
    if (data[field] !== undefined) payload[field] = data[field];
  }
  if (payload.participants !== undefined) {
    payload.participants = normalizeParticipantsValue(payload.participants);
  }
  return payload;
};

/**
 * Mescla dados existentes com atualizações, normalizando participantes.
 * @param {Object | null} existing - Dados atuais do banco.
 * @param {Object} updates - Atualizações recebidas.
 * @returns {Object} Payload final pronto para persistência.
 */
export const mergeGroupMetadata = (existing, updates) => {
  const safeExisting = existing || {};
  const merged = {
    ...safeExisting,
    ...updates,
    id: updates.id ?? safeExisting.id,
  };

  if (merged.participants !== undefined) {
    merged.participants = normalizeParticipantsValue(merged.participants);
  }

  return buildGroupMetadataPayload(merged);
};

/**
 * Faz upsert de metadados do grupo no banco.
 * @async
 * @param {string} groupId - ID do grupo.
 * @param {Object} updates - Dados a persistir.
 * @param {Object} [options] - Opções de merge.
 * @param {boolean} [options.mergeExisting=true] - Mescla com dados existentes.
 * @returns {Promise<any | null>} Resultado do upsert ou null quando inválido.
 */
export const upsertGroupMetadata = async (groupId, updates, options = {}) => {
  const { mergeExisting = true } = options;
  const safeUpdates = {
    ...updates,
    id: groupId,
  };

  const payload = mergeExisting
    ? mergeGroupMetadata(await findById('groups_metadata', groupId), safeUpdates)
    : buildGroupMetadataPayload(safeUpdates);

  if (!payload.id) {
    logger.warn('Ignorando upsert de grupo sem ID.', { groupId, updates });
    return null;
  }

  return upsert('groups_metadata', payload);
};

/**
 * Aplica ação de participantes (add/remove/promote/demote) sobre a lista atual.
 * @param {Array<Object>} currentParticipants - Participantes atuais.
 * @param {Array<Object | string>} participants - Participantes do evento.
 * @param {string} action - Ação do evento.
 * @returns {Array<Object>} Lista atualizada.
 */
export const applyParticipantAction = (currentParticipants, participants, action) => {
  if (!PARTICIPANT_ACTIONS.has(action)) {
    logger.warn('Ação de participante inválida.', { action });
    return currentParticipants || [];
  }

  const currentMap = new Map(
    (currentParticipants || [])
      .map(normalizeParticipant)
      .filter(Boolean)
      .map((participant) => [getParticipantKey(participant), participant])
      .filter(([key]) => !!key),
  );

  const incoming = Array.isArray(participants) ? participants : [];

  for (const participant of incoming) {
    const normalized = normalizeParticipant(participant);
    const key = getParticipantKey(normalized);
    if (!normalized || !key) continue;

    if (action === 'add') {
      if (!currentMap.has(key)) currentMap.set(key, normalized);
    } else if (action === 'remove') {
      currentMap.delete(key);
    } else if (action === 'promote') {
      const entry = currentMap.get(key) || normalized;
      if (entry.admin !== 'superadmin') {
        entry.admin = 'admin';
      }
      currentMap.set(key, entry);
    } else if (action === 'demote') {
      const entry = currentMap.get(key);
      if (entry) {
        entry.admin = null;
        currentMap.set(key, entry);
      }
    }
  }

  return Array.from(currentMap.values());
};

/**
 * Atualiza participantes do grupo no banco com base em uma ação.
 * @async
 * @param {string} groupId - ID do grupo.
 * @param {Array<Object | string>} participants - Participantes do evento.
 * @param {string} action - Ação do evento.
 * @returns {Promise<Array<Object> | null>} Lista atualizada ou null.
 */
export const updateGroupParticipantsFromAction = async (groupId, participants, action) => {
  if (!groupId || !Array.isArray(participants) || participants.length === 0) return null;

  const currentGroup = await findById('groups_metadata', groupId);
  const currentParticipants = parseParticipantsFromDb(currentGroup?.participants);
  const updatedParticipants = applyParticipantAction(currentParticipants, participants, action);

  await upsertGroupMetadata(
    groupId,
    {
      participants: updatedParticipants,
    },
    { mergeExisting: true },
  );

  logger.debug('Participantes do grupo atualizados no banco.', {
    groupId,
    action,
    participantsUpdated: participants.length,
    totalParticipants: updatedParticipants.length,
  });

  return updatedParticipants;
};

/**
 * Constrói metadados de grupo a partir de um evento de update.
 * @param {Object} event - Evento do Baileys.
 * @param {Object | null} existing - Dados atuais do banco.
 * @returns {Object} Metadados prontos para persistência.
 */
export const buildGroupMetadataFromUpdate = (event, existing) => {
  const currentParticipants = parseParticipantsFromDb(existing?.participants);
  const participants = event.participants || currentParticipants;
  const normalizedParticipants = normalizeParticipantsList(participants);

  return {
    id: event.id,
    subject: event.subject ?? existing?.subject,
    description: event.desc ?? existing?.description,
    owner_jid: event.owner ?? existing?.owner_jid,
    creation: event.creation ?? existing?.creation,
    participants: normalizedParticipants,
  };
};

/**
 * Constrói metadados de grupo a partir do snapshot completo do Baileys.
 * @param {Object} group - Grupo do Baileys.
 * @returns {Object} Metadados prontos para persistência.
 */
export const buildGroupMetadataFromGroup = (group) => ({
  id: group.id,
  subject: group.subject,
  description: group.desc,
  owner_jid: group.owner,
  creation: group.creation,
  participants: normalizeParticipantsList(group.participants || []),
});
