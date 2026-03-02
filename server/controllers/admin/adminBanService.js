import { randomUUID } from 'node:crypto';

export const createStickerCatalogAdminBanService = ({ executeQuery, tables, sanitizeText, normalizeGoogleSubject, normalizeEmail, normalizeJid, toIsoOrNull, revokeGoogleWebSessionsByIdentity = async () => 0 }) => {
  const TABLES = tables;

  const mapAdminBanRow = (row) => {
    if (!row || typeof row !== 'object') return null;
    return {
      id: String(row.id || '').trim(),
      google_sub: normalizeGoogleSubject(row.google_sub),
      email: normalizeEmail(row.email),
      owner_jid: normalizeJid(row.owner_jid) || null,
      reason: sanitizeText(row.reason || '', 255, { allowEmpty: true }) || null,
      created_by_google_sub: normalizeGoogleSubject(row.created_by_google_sub),
      created_by_email: normalizeEmail(row.created_by_email),
      created_at: toIsoOrNull(row.created_at),
      updated_at: toIsoOrNull(row.updated_at),
      revoked_at: toIsoOrNull(row.revoked_at),
    };
  };

  const findActiveAdminBanForIdentity = async ({ googleSub = '', email = '', ownerJid = '' } = {}) => {
    const normalizedSub = normalizeGoogleSubject(googleSub);
    const normalizedEmail = normalizeEmail(email);
    const normalizedOwnerJid = normalizeJid(ownerJid) || '';
    const clauses = [];
    const params = [];
    if (normalizedSub) {
      clauses.push('google_sub = ?');
      params.push(normalizedSub);
    }
    if (normalizedEmail) {
      clauses.push('email = ?');
      params.push(normalizedEmail);
    }
    if (normalizedOwnerJid) {
      clauses.push('owner_jid = ?');
      params.push(normalizedOwnerJid);
    }
    if (!clauses.length) return null;

    const rows = await executeQuery(
      `SELECT *
         FROM ${TABLES.STICKER_WEB_ADMIN_BAN}
        WHERE revoked_at IS NULL
          AND (${clauses.join(' OR ')})
        ORDER BY created_at DESC
        LIMIT 1`,
      params,
    );
    return mapAdminBanRow(Array.isArray(rows) ? rows[0] : null);
  };

  const listAdminBans = async ({ activeOnly = false, limit = 100 } = {}) => {
    const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
    const rows = await executeQuery(
      `SELECT *
         FROM ${TABLES.STICKER_WEB_ADMIN_BAN}
        ${activeOnly ? 'WHERE revoked_at IS NULL' : ''}
        ORDER BY created_at DESC
        LIMIT ${safeLimit}`,
    );
    return (Array.isArray(rows) ? rows : []).map(mapAdminBanRow).filter(Boolean);
  };

  const createAdminBanRecord = async ({ googleSub = '', email = '', ownerJid = '', reason = '', adminSession = null }) => {
    const normalizedSub = normalizeGoogleSubject(googleSub);
    const normalizedEmail = normalizeEmail(email);
    const normalizedOwnerJid = normalizeJid(ownerJid) || '';
    if (!normalizedSub && !normalizedEmail && !normalizedOwnerJid) {
      const error = new Error('Informe google_sub, email ou owner_jid para banir.');
      error.statusCode = 400;
      throw error;
    }

    const existing = await findActiveAdminBanForIdentity({
      googleSub: normalizedSub,
      email: normalizedEmail,
      ownerJid: normalizedOwnerJid,
    });
    if (existing) return { created: false, ban: existing };

    const banId = randomUUID();
    await executeQuery(
      `INSERT INTO ${TABLES.STICKER_WEB_ADMIN_BAN}
        (id, google_sub, email, owner_jid, reason, created_by_google_sub, created_by_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [banId, normalizedSub || null, normalizedEmail || null, normalizedOwnerJid || null, sanitizeText(reason || '', 255, { allowEmpty: true }) || null, normalizeGoogleSubject(adminSession?.googleSub) || null, normalizeEmail(adminSession?.email) || null],
    );

    if (normalizedSub || normalizedEmail || normalizedOwnerJid) {
      await revokeGoogleWebSessionsByIdentity({
        googleSub: normalizedSub,
        email: normalizedEmail,
        ownerJid: normalizedOwnerJid,
      }).catch(() => {});
    }

    const rows = await executeQuery(`SELECT * FROM ${TABLES.STICKER_WEB_ADMIN_BAN} WHERE id = ? LIMIT 1`, [banId]);
    return { created: true, ban: mapAdminBanRow(Array.isArray(rows) ? rows[0] : null) };
  };

  const revokeAdminBanRecord = async (banId) => {
    const normalizedId = sanitizeText(banId, 36, { allowEmpty: false });
    if (!normalizedId) {
      const error = new Error('ban_id invalido.');
      error.statusCode = 400;
      throw error;
    }
    await executeQuery(
      `UPDATE ${TABLES.STICKER_WEB_ADMIN_BAN}
          SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
        WHERE id = ?`,
      [normalizedId],
    );
    const rows = await executeQuery(`SELECT * FROM ${TABLES.STICKER_WEB_ADMIN_BAN} WHERE id = ? LIMIT 1`, [normalizedId]);
    return mapAdminBanRow(Array.isArray(rows) ? rows[0] : null);
  };

  const assertGoogleIdentityNotBanned = async ({ sub = '', email = '', ownerJid = '' } = {}) => {
    const ban = await findActiveAdminBanForIdentity({ googleSub: sub, email, ownerJid });
    if (!ban) return null;
    const error = new Error('Conta bloqueada pela administracao.');
    error.statusCode = 403;
    error.code = 'ADMIN_BANNED';
    error.ban = ban;
    throw error;
  };

  return {
    mapAdminBanRow,
    findActiveAdminBanForIdentity,
    listAdminBans,
    createAdminBanRecord,
    revokeAdminBanRecord,
    assertGoogleIdentityNotBanned,
  };
};
