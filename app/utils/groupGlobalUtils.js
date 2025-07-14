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

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const logger = require('./logger/loggerModule');

// Caminhos para os arquivos de dados
const DATA_DIR = path.join(__dirname, '../../temp/data');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

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

    // Usa função utilitária para filtrar participantes válidos
    const validParticipants = getValidParticipants(groupMetadata.participants);
    const member = validParticipants.find((p) => cleanJid(p.id) === cleanUserJid);

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

    // Usa função utilitária para filtrar participantes válidos
    const validParticipants = getValidParticipants(groupMetadata.participants);
    return validParticipants.some((p) => cleanJid(p.id) === cleanUserJid);
  } catch (error) {
    logger.error('Erro ao verificar se usuário está no grupo', { groupJid, userJid, error: error.message });
    return false;
  }
};

/**
 * === FUNÇÕES DE DADOS DO GRUPO ===
 */

/**
 * Obtém metadados de um grupo diretamente do arquivo groups.json.
 * @param {string} groupJid - ID do grupo.
 * @param {boolean} forceRefresh - Parâmetro mantido para compatibilidade (não usado).
 * @returns {Promise<Object|null>} - Metadados do grupo.
 */
const getGroupMetadata = async (groupJid, forceRefresh = false) => {
  try {
    if (!groupJid) {
      logger.warn('JID do grupo não fornecido para getGroupMetadata');
      return null;
    }

    // Lê os dados do arquivo groups.json
    const groupsData = await readGroupsData();
    const groupMetadata = groupsData[groupJid];

    if (groupMetadata) {
      logger.debug('Metadados do grupo obtidos do arquivo.', { groupJid });
      return groupMetadata;
    } else {
      logger.debug('Grupo não encontrado nos dados locais.', { groupJid });
      return null;
    }
  } catch (error) {
    logger.error('Erro ao obter metadados do grupo', { groupJid, error: error.message });
    return null;
  }
};

/**
 * Obtém informações de um contato diretamente do arquivo contacts.json.
 * @param {string} contactJid - JID do contato.
 * @returns {Promise<Object|null>} - Dados do contato.
 */
const getContactInfo = async (contactJid) => {
  try {
    // Lê os dados do arquivo contacts.json
    const contactsData = await readContactsData();
    const contactInfo = contactsData[contactJid];

    if (contactInfo) {
      logger.debug('Informações de contato obtidas do arquivo.', { contactJid });
      return contactInfo;
    } else {
      logger.debug('Contato não encontrado nos dados locais.', { contactJid });
      return null;
    }
  } catch (error) {
    logger.error('Erro ao obter informações de contato', { contactJid, error: error.message });
    return null;
  }
};

/**
 * === FUNÇÕES DE ESTATÍSTICAS E ATIVIDADE (Simplificado) ===
 */

/**
 * Registra uma atividade de grupo (versão simplificada).
 * @param {string} groupJid - ID do grupo.
 * @param {string} activityType - Tipo de atividade.
 * @param {Object} activityData - Dados da atividade.
 */
const logGroupActivity = (groupJid, activityType, activityData = {}) => {
  try {
    logger.info('Atividade de grupo registrada.', {
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
 * Filtra participantes válidos de um grupo (que possuem ID).
 * @param {Array} participants - Array de participantes do grupo.
 * @returns {Array} - Array com apenas participantes válidos.
 */
const getValidParticipants = (participants) => {
  if (!Array.isArray(participants)) return [];
  return participants.filter((p) => p && p.id && typeof p.id === 'string');
};

/**
 * Limpa um JID removendo sufixos.
 * @param {string} jid - JID a ser limpo.
 * @returns {string} - JID limpo.
 */
const cleanJid = (jid) => {
  if (!jid || typeof jid !== 'string') {
    logger.warn('cleanJid recebeu valor inválido:', { jid, type: typeof jid });
    return '';
  }
  try {
    return jid.split(':')[0].split('@')[0] + (jid.includes('@g.us') ? '@g.us' : '@s.whatsapp.net');
  } catch (error) {
    logger.error('Erro ao limpar JID', { jid, error: error.message });
    return '';
  }
};

/**
 * Formata um número de telefone para o formato JID.
 * @param {string} phoneNumber - Número de telefone.
 * @returns {string} - JID formatado.
 */
const formatPhoneToJid = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    logger.warn('formatPhoneToJid recebeu valor inválido:', { phoneNumber, type: typeof phoneNumber });
    return '';
  }
  try {
    let cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.length <= 11) {
      cleaned = '55' + cleaned;
    }
    return `${cleaned}@s.whatsapp.net`;
  } catch (error) {
    logger.error('Erro ao formatar telefone para JID', { phoneNumber, error: error.message });
    return '';
  }
};

/**
 * Verifica se um JID é de um grupo.
 * @param {string} jid - JID a ser verificado.
 * @returns {boolean} - True se for JID de grupo.
 */
const isGroupJid = (jid) => {
  if (!jid || typeof jid !== 'string') {
    return false;
  }
  return jid.endsWith('@g.us');
};

/**
 * Obtém o JID do bot usando a abordagem do socket ativo, com fallbacks robustos.
 * Prioriza o socket ativo do WhatsApp, depois metadados salvos, e por último análise de grupos.
 * @returns {string|null} - JID do bot.
 */
const getBotJid = () => {
  try {
    // MÉTODO PRIMÁRIO: Obtém JID diretamente do socket ativo (mais confiável)
    try {
      const { getActiveSocket } = require('../connection/socketController');
      const activeSocket = getActiveSocket();

      if (activeSocket && activeSocket.user && activeSocket.user.id) {
        const botJid = activeSocket.user.id;
        logger.debug('🤖 JID do bot obtido do socket ativo.', { botJid });

        // Salva o JID nos metadados para uso futuro (sem await para manter função síncrona)
        setBotJid(botJid).catch((err) => logger.debug('Erro ao salvar JID do bot nos metadados:', err.message));
        return botJid;
      }
    } catch (socketError) {
      logger.debug('⚠️ Socket não disponível, tentando métodos alternativos', { error: socketError.message });
    }

    // MÉTODO SECUNDÁRIO: Tenta ler de metadata se estiver disponível
    const metadata = readMetadataSync();
    if (metadata?.botJid) {
      logger.debug('🤖 JID do bot obtido dos metadados.', { botJid: metadata.botJid });
      return metadata.botJid;
    }

    // MÉTODO TERCIÁRIO: Como fallback, analisa os grupos para encontrar um padrão comum de bot
    const groupsData = readGroupsDataSync();

    // Procura por padrões de JID de bot nos grupos
    for (const [groupJid, groupData] of Object.entries(groupsData)) {
      if (groupData.participants && Array.isArray(groupData.participants)) {
        // Procura por participantes que podem ser bots (normalmente têm números específicos)
        const possibleBots = groupData.participants.filter(
          (p) =>
            p.id &&
            (p.id.includes('bot') ||
              p.id.includes('559591122954') || // JID específico que pode ser o bot
              p.admin === 'admin' ||
              p.admin === 'superadmin'),
        );

        if (possibleBots.length > 0) {
          // Retorna o primeiro bot encontrado e salva nos metadados
          const botJid = possibleBots[0].id;
          logger.debug('🤖 JID do bot obtido por análise de grupos.', { botJid });
          setBotJid(botJid).catch((err) => logger.debug('Erro ao salvar JID do bot nos metadados:', err.message));
          return botJid;
        }
      }
    }

    logger.warn('⚠️ JID do bot não encontrado em nenhum método disponível');
    return null;
  } catch (error) {
    logger.error('❌ Erro ao obter JID do bot', { error: error.message });
    return null;
  }
};

/**
 * Define/salva o JID do bot nos metadados (função auxiliar).
 * @param {string} botJid - JID do bot.
 * @returns {Promise<void>}
 */
const setBotJid = async (botJid) => {
  try {
    const metadata = await readMetadata();
    metadata.botJid = botJid;

    await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf8');
    logger.info('JID do bot salvo nos metadados', { botJid });
  } catch (error) {
    logger.error('Erro ao salvar JID do bot', { botJid, error: error.message });
  }
};

/**
 * Obtém todos os grupos dos quais o bot participa, lendo do arquivo groups.json.
 * @returns {Promise<string[]>} - Lista de JIDs de grupos.
 */
const getAllBotGroups = async () => {
  try {
    const groupsData = await readGroupsData();
    const groupJids = Object.keys(groupsData).filter(isGroupJid);
    return groupJids;
  } catch (error) {
    logger.error('Erro ao obter grupos do bot', { error: error.message });
    return [];
  }
};

/**
 * === FUNÇÕES DE BANIMENTO (Simplificado) ===
 */

// A lógica de banimento foi simplificada e pode ser gerenciada por um módulo dedicado
// ou através de um sistema de callbacks no eventHandler para manter este módulo leve.

/**
 * Adiciona um usuário à lista de banidos (versão simplificada).
 * @param {string} userJid - JID do usuário.
 * @param {string} groupJid - JID do grupo (opcional).
 */
const banUser = (userJid, groupJid = null) => {
  logger.info('Banimento de usuário solicitado.', { userJid, groupJid, timestamp: Date.now() });
};

/**
 * Remove um usuário da lista de banidos (versão simplificada).
 * @param {string} userJid - JID do usuário.
 * @param {string} groupJid - JID do grupo (opcional).
 */
const unbanUser = (userJid, groupJid = null) => {
  logger.info('Remoção de banimento de usuário solicitada.', { userJid, groupJid, timestamp: Date.now() });
};

/**
 * === FUNÇÕES AUXILIARES PARA LEITURA DE DADOS ===
 */

/**
 * Lê os dados dos grupos do arquivo groups.json.
 * @returns {Promise<Object>} - Dados dos grupos.
 */
const readGroupsData = async () => {
  try {
    const data = await fs.readFile(GROUPS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Arquivo groups.json não encontrado, retornando objeto vazio');
      return {};
    }
    logger.error('Erro ao ler dados dos grupos', { error: error.message });
    return {};
  }
};

/**
 * Lê os dados dos grupos do arquivo groups.json de forma síncrona.
 * @returns {Object} - Dados dos grupos.
 */
const readGroupsDataSync = () => {
  try {
    const data = fsSync.readFileSync(GROUPS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.debug('Arquivo groups.json não encontrado, retornando objeto vazio');
      return {};
    }
    logger.debug('Erro ao ler dados dos grupos sincronamente', { error: error.message });
    return {};
  }
};

/**
 * Lê os dados dos contatos do arquivo contacts.json.
 * @returns {Promise<Object>} - Dados dos contatos.
 */
const readContactsData = async () => {
  try {
    const data = await fs.readFile(CONTACTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Arquivo contacts.json não encontrado, retornando objeto vazio');
      return {};
    }
    logger.error('Erro ao ler dados dos contatos', { error: error.message });
    return {};
  }
};

/**
 * Lê os metadados do arquivo metadata.json.
 * @returns {Promise<Object>} - Metadados.
 */
const readMetadata = async () => {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Arquivo metadata.json não encontrado, retornando objeto vazio');
      return {};
    }
    logger.error('Erro ao ler metadados', { error: error.message });
    return {};
  }
};

/**
 * Lê os metadados do arquivo metadata.json de forma síncrona.
 * @returns {Object} - Metadados.
 */
const readMetadataSync = () => {
  try {
    const data = fsSync.readFileSync(METADATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.debug('Arquivo metadata.json não encontrado, retornando objeto vazio');
      return {};
    }
    logger.debug('Erro ao ler metadados sincronamente', { error: error.message });
    return {};
  }
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
  getValidParticipants,
  cleanJid,
  formatPhoneToJid,
  isGroupJid,
  getBotJid,
  setBotJid,
  getAllBotGroups,

  // Funções de banimento (simplificadas)
  banUser,
  unbanUser,

  // Funções auxiliares de leitura de dados
  readGroupsData,
  readGroupsDataSync,
  readContactsData,
  readMetadata,
  readMetadataSync,
};
