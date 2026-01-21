import logger from '../utils/logger/loggerModule.js';
import { findById, upsert } from '../../database/index.js';

const groupConfigStore = {
  /**
   * Retrieves the configuration for a specific group.
   * @param {string} groupId - The JID of the group.
   * @returns {object} The group configuration, or an empty object if not found.
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
   * Updates the configuration for a specific group.
   * @param {string} groupId - The JID of the group.
   * @param {object} newConfig - The new configuration object to merge.
   * @param {string} [newConfig.welcomeMedia] - Optional path to media for welcome messages.
   * @param {string} [newConfig.farewellMedia] - Optional path to media for farewell messages.
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
