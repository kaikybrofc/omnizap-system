import { readFromFile, writeToFile } from './persistence.js';
import logger from '../utils/logger/loggerModule.js';

const groupConfigStore = {
  configs: {},

  async loadData() {
    try {
      const data = await readFromFile('groupConfigs', 'object');
      this.configs = data || {};
      logger.info('Group configurations loaded.');
    } catch (loadError) {
      logger.error('Error loading group configurations:', loadError);
      this.configs = {};
    }
  },

  /**
   * Retrieves the configuration for a specific group.
   * @param {string} groupId - The JID of the group.
   * @returns {object} The group configuration, or an empty object if not found.
   */
  getGroupConfig: function (groupId) {
    return this.configs[groupId] || {};
  },

  /**
   * Updates the configuration for a specific group.
   * @param {string} groupId - The JID of the group.
   * @param {object} newConfig - The new configuration object to merge.
   * @param {string} [newConfig.welcomeMedia] - Optional path to media for welcome messages.
   * @param {string} [newConfig.farewellMedia] - Optional path to media for farewell messages.
   */
  updateGroupConfig: function (groupId, newConfig) {
    this.configs[groupId] = { ...this.configs[groupId], ...newConfig };
    this.debouncedWrite('groupConfigs');
  },

  debouncedWrites: {},
  debouncedWrite: function (dataType, delay = 1000) {
    if (this.debouncedWrites[dataType]) {
      clearTimeout(this.debouncedWrites[dataType]);
    }
    this.debouncedWrites[dataType] = setTimeout(() => {
      writeToFile(dataType, this.configs);
      delete this.debouncedWrites[dataType];
    }, delay);
  },
};

export default groupConfigStore;