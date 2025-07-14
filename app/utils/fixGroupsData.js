/**
 * Utilitário para limpar dados inválidos do groups.json
 * Remove participantes sem ID válido
 *
 * @version 1.0.0
 * @author OmniZap Team
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger/loggerModule');

/**
 * Limpa dados de participantes inválidos dos grupos
 * Remove participantes que não possuem campo 'id' válido
 */
async function cleanGroupsData() {
  const groupsFilePath = path.join(__dirname, '../../temp/data/groups.json');

  try {
    logger.info('🧹 Iniciando limpeza dos dados de grupos...');

    // Lê o arquivo groups.json
    const fileContent = await fs.readFile(groupsFilePath, 'utf8');
    const groupsData = JSON.parse(fileContent);

    let totalCleaned = 0;
    let totalGroupsProcessed = 0;

    // Processa cada grupo
    for (const [groupJid, groupData] of Object.entries(groupsData)) {
      if (groupData && groupData.participants && Array.isArray(groupData.participants)) {
        const originalCount = groupData.participants.length;

        // Filtra apenas participantes válidos (com ID)
        groupData.participants = groupData.participants.filter((participant) => {
          return participant && participant.id && typeof participant.id === 'string' && participant.id.trim().length > 0;
        });

        const cleanedCount = originalCount - groupData.participants.length;
        if (cleanedCount > 0) {
          totalCleaned += cleanedCount;
          logger.info(`📋 Grupo ${groupData.subject || groupJid}: removidos ${cleanedCount} participantes inválidos`);
        }

        // Atualiza contadores
        if (groupData.participants.length > 0) {
          groupData._participantCount = groupData.participants.length;
          groupData._adminCount = groupData.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').length;
        }

        totalGroupsProcessed++;
      }
    }

    // Salva o arquivo limpo
    await fs.writeFile(groupsFilePath, JSON.stringify(groupsData, null, 2));

    logger.info(`✅ Limpeza concluída! ${totalCleaned} participantes inválidos removidos de ${totalGroupsProcessed} grupos`);

    return {
      success: true,
      totalGroupsProcessed,
      totalParticipantsCleaned: totalCleaned,
    };
  } catch (error) {
    logger.error('❌ Erro ao limpar dados dos grupos:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Valida a estrutura de um participante
 * @param {Object} participant - Objeto participante
 * @returns {boolean} - True se o participante é válido
 */
function isValidParticipant(participant) {
  return participant && participant.id && typeof participant.id === 'string' && participant.id.trim().length > 0 && (participant.id.includes('@s.whatsapp.net') || participant.id.includes('@g.us'));
}

/**
 * Executa limpeza automática se necessário
 */
async function autoCleanIfNeeded() {
  const groupsFilePath = path.join(__dirname, '../../temp/data/groups.json');

  try {
    const fileContent = await fs.readFile(groupsFilePath, 'utf8');
    const groupsData = JSON.parse(fileContent);

    let needsCleaning = false;

    // Verifica se há dados que precisam de limpeza
    for (const [groupJid, groupData] of Object.entries(groupsData)) {
      if (groupData && groupData.participants && Array.isArray(groupData.participants)) {
        const hasInvalidParticipants = groupData.participants.some((p) => !isValidParticipant(p));
        if (hasInvalidParticipants) {
          needsCleaning = true;
          break;
        }
      }
    }

    if (needsCleaning) {
      logger.info('🔍 Detectados dados inválidos em groups.json. Executando limpeza automática...');
      return await cleanGroupsData();
    } else {
      logger.info('✅ Dados de groups.json estão limpos');
      return { success: true, alreadyClean: true };
    }
  } catch (error) {
    logger.error('❌ Erro na verificação automática de limpeza:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  cleanGroupsData,
  isValidParticipant,
  autoCleanIfNeeded,
};
