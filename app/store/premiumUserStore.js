import groupConfigStore from './groupConfigStore.js';
import { isSameJidUser, normalizeJid } from '../config/baileysConfig.js';

const PREMIUM_CONFIG_ID = 'system:premium_users';

const normalizePremiumEntry = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return normalizeJid(raw) || raw;
};

const normalizeList = (list) => {
  const normalizedList = [];
  const values = Array.isArray(list) ? list : [];

  for (const value of values) {
    const normalized = normalizePremiumEntry(value);
    if (!normalized) continue;
    if (normalizedList.some((entry) => entry === normalized || isSameJidUser(entry, normalized))) continue;
    normalizedList.push(normalized);
  }

  return normalizedList;
};

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
    const normalizedTargets = normalizeList(usersToRemove);
    const updated = current.filter((jid) => !normalizedTargets.some((target) => target === jid || isSameJidUser(target, jid)));
    await groupConfigStore.updateGroupConfig(PREMIUM_CONFIG_ID, { premiumUsers: updated });
    return updated;
  },
};

export default premiumUserStore;
