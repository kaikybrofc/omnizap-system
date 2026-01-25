import groupConfigStore from './groupConfigStore.js';

const PROMPT_CONFIG_ID = 'system:ai_prompts';

const normalizeMap = (map) => (map && typeof map === 'object' ? map : {});

const aiPromptStore = {
  getAllPrompts: async function () {
    const config = await groupConfigStore.getGroupConfig(PROMPT_CONFIG_ID);
    return normalizeMap(config.prompts);
  },

  getPrompt: async function (jid) {
    if (!jid) return null;
    const prompts = await this.getAllPrompts();
    return prompts[jid] || null;
  },

  setPrompt: async function (jid, prompt) {
    if (!jid) return null;
    const prompts = await this.getAllPrompts();
    prompts[jid] = prompt;
    await groupConfigStore.updateGroupConfig(PROMPT_CONFIG_ID, { prompts });
    return prompt;
  },

  clearPrompt: async function (jid) {
    if (!jid) return null;
    const prompts = await this.getAllPrompts();
    if (prompts[jid]) {
      delete prompts[jid];
      await groupConfigStore.updateGroupConfig(PROMPT_CONFIG_ID, { prompts });
    }
    return true;
  },
};

export default aiPromptStore;
