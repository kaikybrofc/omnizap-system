import { encodeJid, getJidUser, isSameJidUser, normalizeJid } from './baileysConfig.js';
import { extractUserIdInfo, resolveUserId, resolveUserIdCached } from '../services/lidMapService.js';

const ADMIN_ENV_KEY = 'USER_ADMIN';

const normalizePhoneDigits = (value) => String(value || '').replace(/\D+/g, '');

export const getAdminRawValue = () => String(process.env[ADMIN_ENV_KEY] || '').trim();

export const getAdminJid = () => {
  const raw = getAdminRawValue();
  if (!raw) return null;

  let candidate = '';
  if (raw.includes('@')) {
    candidate = normalizeJid(raw) || raw;
  } else {
    const digits = normalizePhoneDigits(raw);
    if (!digits) return null;
    candidate = normalizeJid(encodeJid(digits, 's.whatsapp.net')) || '';
  }

  if (!candidate) return null;

  const resolvedCached = resolveUserIdCached(extractUserIdInfo(candidate));
  const normalizedResolved = normalizeJid(resolvedCached || candidate);
  return normalizedResolved || candidate;
};

export const getAdminPhone = () => {
  const adminJid = getAdminJid();
  if (!adminJid) return null;

  const user = getJidUser(adminJid);
  if (user) return user;

  const digits = normalizePhoneDigits(adminJid);
  return digits || null;
};

export const resolveAdminJid = async () => {
  const cached = getAdminJid();
  if (!cached) return null;

  try {
    const resolved = await resolveUserId(extractUserIdInfo(cached));
    return normalizeJid(resolved || cached) || cached;
  } catch {
    return cached;
  }
};

export const isAdminSender = (senderJid) => {
  const adminJid = getAdminJid();
  if (!adminJid || !senderJid) return false;

  const normalizedSender = normalizeJid(senderJid);
  if (!normalizedSender) return false;

  return isSameJidUser(normalizedSender, adminJid) || normalizedSender === adminJid;
};

export const isAdminSenderAsync = async (senderIdentity) => {
  const senderInfo = extractUserIdInfo(senderIdentity);
  if (!senderInfo.raw && !senderInfo.jid && !senderInfo.lid && !senderInfo.participantAlt) return false;

  const normalizedSender = normalizeJid(senderInfo.jid || senderInfo.raw || '');
  const cachedSender = resolveUserIdCached(senderInfo);
  const normalizedCachedSender = normalizeJid(cachedSender || '');
  const resolvedSender = await resolveUserId(senderInfo).catch(() => null);
  const normalizedResolvedSender = normalizeJid(resolvedSender || '');
  const senderCandidates = new Set(
    [normalizedSender, normalizedCachedSender, normalizedResolvedSender].filter(Boolean),
  );
  if (!senderCandidates.size) return false;

  const adminJid = (await resolveAdminJid()) || getAdminJid();
  if (!adminJid) return false;
  const normalizedAdmin = normalizeJid(adminJid) || adminJid;

  for (const senderCandidate of senderCandidates) {
    if (isSameJidUser(senderCandidate, normalizedAdmin) || senderCandidate === normalizedAdmin) {
      return true;
    }
  }
  return false;
};
