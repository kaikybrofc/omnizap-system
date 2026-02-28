import groupConfigStore from './groupConfigStore.js';

const PREMIUM_CONFIG_ID = 'system:premium_users';

const normalizeList = (list) => Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));

const premiumUserStore = {
  getPremiumUsers: async function () {
    const config = await groupConfigStore.getGroupConfig(PREMIUM_CONFIG_ID);
    return normalizeList(config.premiumUsers);
  },

  setPremiumUsers: async function (premiumUsers) {
    const normalized = normalizeList(premiumUsers);
    await groupConfigStore.updateGroupConfig(PREMIUM_CONFIG_ID, { premiumUsers: normalized });
    return normalized;
  },

  addPremiumUsers: async function (usersToAdd) {
    const current = await this.getPremiumUsers();
    const updated = normalizeList([...current, ...usersToAdd]);
    await groupConfigStore.updateGroupConfig(PREMIUM_CONFIG_ID, { premiumUsers: updated });
    return updated;
  },

  removePremiumUsers: async function (usersToRemove) {
    const current = await this.getPremiumUsers();
    const removeSet = new Set(usersToRemove);
    const updated = current.filter((jid) => !removeSet.has(jid));
    await groupConfigStore.updateGroupConfig(PREMIUM_CONFIG_ID, { premiumUsers: updated });
    return updated;
  },
};

export default premiumUserStore;
