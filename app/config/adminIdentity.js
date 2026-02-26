import { encodeJid, getJidUser, isSameJidUser, normalizeJid } from './baileysConfig.js';

const ADMIN_ENV_KEY = 'USER_ADMIN';

const normalizePhoneDigits = (value) => String(value || '').replace(/\D+/g, '');

export const getAdminRawValue = () => String(process.env[ADMIN_ENV_KEY] || '').trim();

export const getAdminJid = () => {
  const raw = getAdminRawValue();
  if (!raw) return null;

  if (raw.includes('@')) {
    const normalized = normalizeJid(raw);
    return normalized || raw;
  }

  const digits = normalizePhoneDigits(raw);
  if (!digits) return null;
  return normalizeJid(encodeJid(digits, 's.whatsapp.net'));
};

export const getAdminPhone = () => {
  const adminJid = getAdminJid();
  if (!adminJid) return null;

  const user = getJidUser(adminJid);
  if (user) return user;

  const digits = normalizePhoneDigits(adminJid);
  return digits || null;
};

export const isAdminSender = (senderJid) => {
  const adminJid = getAdminJid();
  if (!adminJid || !senderJid) return false;

  const normalizedSender = normalizeJid(senderJid);
  if (!normalizedSender) return false;

  return isSameJidUser(normalizedSender, adminJid) || normalizedSender === adminJid;
};
