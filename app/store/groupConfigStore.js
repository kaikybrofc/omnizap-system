import logger from '../utils/logger/loggerModule.js';
import { findById, upsert } from '../../database/index.js';

const groupConfigStore = {
  /**
   * Recupera a configuracao de um grupo especifico.
   * @param {string} groupId - O JID do grupo.
   * @returns {object} A configuracao do grupo, ou um objeto vazio se nao encontrado.
   */
  getGroupConfig: async function (groupId) {
    try {
      const record = await findById('group_configs', groupId);
      if (!record || record.config === null || record.config === undefined) {
        return {};
      }
      if (Buffer.isBuffer(record.config)) {
        return JSON.parse(record.config.toString('utf8'));
      }
      if (typeof record.config === 'string') {
        return JSON.parse(record.config);
      }
      return record.config || {};
    } catch (error) {
      logger.error('Error loading group configuration from DB:', {
        error: error.message,
        groupId,
      });
      return {};
    }
  },

  /**
   * Atualiza a configuracao de um grupo especifico.
   * @param {string} groupId - O JID do grupo.
   * @param {object} newConfig - O novo objeto de configuracao para mesclar.
   * @param {string} [newConfig.welcomeMedia] - Caminho opcional para midia de boas-vindas.
   * @param {string} [newConfig.farewellMedia] - Caminho opcional para midia de despedida.
   */
  updateGroupConfig: async function (groupId, newConfig) {
    const currentConfig = await this.getGroupConfig(groupId);
    const updatedConfig = { ...currentConfig, ...newConfig };
    try {
      await upsert('group_configs', {
        id: groupId,
        config: JSON.stringify(updatedConfig),
      });
      return updatedConfig;
    } catch (error) {
      logger.error('Error updating group configuration in DB:', {
        error: error.message,
        groupId,
      });
      throw error;
    }
  },
};

export default groupConfigStore;
