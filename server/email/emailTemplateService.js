const resolveSiteOrigin = () =>
  String(process.env.SITE_ORIGIN || process.env.WHATSAPP_LOGIN_BASE_URL || 'https://omnizap.shop')
    .trim()
    .replace(/\/+$/, '') || 'https://omnizap.shop';

const normalizeTemplateKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '')
    .slice(0, 64);

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildWelcomeTemplate = (payload = {}) => {
  const name =
    String(payload?.name || payload?.firstName || '')
      .trim()
      .slice(0, 80) || 'você';
  const siteOrigin =
    String(payload?.siteOrigin || resolveSiteOrigin())
      .trim()
      .replace(/\/+$/, '') || resolveSiteOrigin();
  const loginUrl =
    String(payload?.loginUrl || `${siteOrigin}/login/`)
      .trim()
      .replace(/\s+/g, '') || `${siteOrigin}/login/`;

  return {
    subject: 'Bem-vindo(a) ao OmniZap',
    text: `Olá, ${name}!\n\nSua conta no OmniZap foi preparada.\nAcesse: ${loginUrl}\n\nSe você não solicitou este e-mail, pode ignorar.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:640px;margin:0 auto;padding:16px;">
        <h2 style="margin:0 0 12px;">Bem-vindo(a) ao OmniZap</h2>
        <p style="margin:0 0 12px;">Olá, <strong>${escapeHtml(name)}</strong>!</p>
        <p style="margin:0 0 16px;">Sua conta no OmniZap foi preparada.</p>
        <p style="margin:0 0 20px;">
          <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;">
            Entrar no OmniZap
          </a>
        </p>
        <p style="margin:0;color:#555;font-size:13px;">Se você não solicitou este e-mail, pode ignorar.</p>
      </div>
    `.trim(),
  };
};

const buildMagicLinkTemplate = (payload = {}) => {
  const name =
    String(payload?.name || payload?.firstName || '')
      .trim()
      .slice(0, 80) || 'você';
  const link =
    String(payload?.link || payload?.magicLink || payload?.loginUrl || '')
      .trim()
      .replace(/\s+/g, '');

  if (!link) return null;

  return {
    subject: 'Seu link de acesso ao OmniZap',
    text: `Olá, ${name}!\n\nUse este link para acessar sua conta:\n${link}\n\nEste link pode expirar em alguns minutos.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:640px;margin:0 auto;padding:16px;">
        <h2 style="margin:0 0 12px;">Seu link de acesso</h2>
        <p style="margin:0 0 12px;">Olá, <strong>${escapeHtml(name)}</strong>!</p>
        <p style="margin:0 0 16px;">Use o botão abaixo para acessar sua conta:</p>
        <p style="margin:0 0 20px;">
          <a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;">
            Acessar conta
          </a>
        </p>
        <p style="margin:0;color:#555;font-size:13px;">Este link pode expirar em alguns minutos.</p>
      </div>
    `.trim(),
  };
};

const TEMPLATE_BUILDERS = {
  welcome: buildWelcomeTemplate,
  magic_link: buildMagicLinkTemplate,
};

export const renderEmailTemplate = (templateKey, payload = {}) => {
  const normalizedTemplateKey = normalizeTemplateKey(templateKey);
  if (!normalizedTemplateKey) return null;
  const builder = TEMPLATE_BUILDERS[normalizedTemplateKey];
  if (typeof builder !== 'function') return null;
  const rendered = builder(payload || {});
  if (!rendered) return null;

  const subject =
    String(rendered.subject || '')
      .trim()
      .slice(0, 180) || '';
  const text =
    String(rendered.text || '')
      .trim()
      .slice(0, 120_000) || '';
  const html =
    String(rendered.html || '')
      .trim()
      .slice(0, 500_000) || '';

  if (!subject || (!text && !html)) return null;

  return {
    subject,
    text: text || null,
    html: html || null,
    template_key: normalizedTemplateKey,
  };
};

export const listAvailableEmailTemplates = () => Object.keys(TEMPLATE_BUILDERS);
