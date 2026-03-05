const DEFAULT_SITE_ORIGIN = 'https://omnizap.shop';
const DEFAULT_BRAND_NAME = 'OmniZap';

const resolveSiteOrigin = () =>
  String(process.env.SITE_ORIGIN || process.env.WHATSAPP_LOGIN_BASE_URL || DEFAULT_SITE_ORIGIN)
    .trim()
    .replace(/\/+$/, '') || DEFAULT_SITE_ORIGIN;

const normalizeTemplateKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '')
    .slice(0, 64);

const normalizeText = (value, maxLength = 500) =>
  String(value || '')
    .trim()
    .slice(0, maxLength);

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeHttpUrl = (value, fallback = '') => {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '');
  if (!normalized) return fallback;
  if (!/^https?:\/\//i.test(normalized)) return fallback;
  return normalized.slice(0, 2_000);
};

const normalizeEmailAddress = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const betweenAngles = raw.match(/<([^>]+)>/);
  const candidate = String(betweenAngles?.[1] || raw)
    .trim()
    .replace(/^mailto:/i, '');
  if (!candidate.includes('@')) return '';
  return candidate.slice(0, 255);
};

const resolveBrandConfig = (payload = {}) => {
  const siteOrigin = normalizeHttpUrl(payload?.siteOrigin || resolveSiteOrigin(), resolveSiteOrigin());
  const supportFallback = `${siteOrigin}/termos-de-uso/`;
  const replyToAddress = normalizeEmailAddress(payload?.replyTo || process.env.SMTP_REPLY_TO || process.env.EMAIL_REPLY_TO || process.env.MAIL_REPLY_TO || '');
  const fromAddress = normalizeEmailAddress(process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.MAIL_FROM || process.env.SMTP_USER || process.env.EMAIL_USER || process.env.MAIL_USER || '');

  return {
    siteOrigin,
    brandName: normalizeText(payload?.brandName || process.env.EMAIL_BRAND_NAME || DEFAULT_BRAND_NAME, 80) || DEFAULT_BRAND_NAME,
    brandTagline:
      normalizeText(payload?.brandTagline || process.env.EMAIL_BRAND_TAGLINE || 'Automacao profissional para WhatsApp.', 120) || null,
    brandLogoUrl: normalizeHttpUrl(payload?.brandLogoUrl || payload?.logoUrl || process.env.EMAIL_BRAND_LOGO_URL || '', ''),
    supportUrl: normalizeHttpUrl(payload?.supportUrl || process.env.EMAIL_BRAND_SUPPORT_URL || supportFallback, supportFallback),
    supportLabel: normalizeText(payload?.supportLabel || process.env.EMAIL_BRAND_SUPPORT_LABEL || 'Central de suporte', 80) || 'Central de suporte',
    supportEmail: replyToAddress || fromAddress || '',
  };
};

const renderParagraphsHtml = (value, { maxParagraphs = 6, maxLength = 8_000 } = {}) => {
  const normalized = String(value || '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, maxLength);
  if (!normalized) return '';

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxParagraphs);

  if (!paragraphs.length) return '';

  return paragraphs.map((paragraph) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.65;">${escapeHtml(paragraph)}</p>`).join('');
};

const renderEmailLayout = ({
  payload = {},
  preheader = '',
  heading = '',
  greeting = '',
  intro = '',
  body = '',
  ctaLabel = '',
  ctaUrl = '',
  ctaHint = '',
  securityNote = '',
  footerMessage = '',
} = {}) => {
  const brand = resolveBrandConfig(payload);
  const safePreheader = normalizeText(preheader, 160);
  const safeHeading = normalizeText(heading, 120);
  const safeGreeting = normalizeText(greeting, 150);
  const safeIntro = normalizeText(intro, 300);
  const safeCtaLabel = normalizeText(ctaLabel, 80);
  const safeCtaUrl = normalizeHttpUrl(ctaUrl, '');
  const safeCtaHint = normalizeText(ctaHint, 220);
  const safeSecurityNote = normalizeText(securityNote, 220);
  const safeFooterMessage = normalizeText(footerMessage, 220);
  const year = new Date().getUTCFullYear();

  const logoBlock = brand.brandLogoUrl
    ? `<img src="${escapeHtml(brand.brandLogoUrl)}" alt="${escapeHtml(brand.brandName)}" width="132" style="display:block;border:0;outline:none;text-decoration:none;height:auto;margin:0 auto;" />`
    : `<div style="display:inline-block;font-size:26px;font-weight:800;color:#0f172a;letter-spacing:0.2px;">${escapeHtml(brand.brandName)}</div>`;

  const greetingBlock = safeGreeting
    ? `<p style="margin:0 0 10px;color:#0f172a;font-size:16px;font-weight:700;line-height:1.5;">${escapeHtml(safeGreeting)}</p>`
    : '';
  const introBlock = safeIntro
    ? `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.65;">${escapeHtml(safeIntro)}</p>`
    : '';
  const bodyBlock = renderParagraphsHtml(body);

  const ctaBlock =
    safeCtaUrl && safeCtaLabel
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 10px;">
          <tr>
            <td align="center" bgcolor="#1d4ed8" style="border-radius:10px;">
              <a href="${escapeHtml(safeCtaUrl)}" style="display:inline-block;padding:12px 20px;font-size:15px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(safeCtaLabel)}</a>
            </td>
          </tr>
        </table>
      `.trim()
      : '';

  const ctaHintBlock = safeCtaHint ? `<p style="margin:4px 0 0;color:#64748b;font-size:13px;line-height:1.55;">${escapeHtml(safeCtaHint)}</p>` : '';
  const fallbackLinkBlock = safeCtaUrl
    ? `<p style="margin:12px 0 0;color:#64748b;font-size:12px;line-height:1.6;word-break:break-all;">Se o botao nao funcionar, copie e cole este link no navegador: ${escapeHtml(safeCtaUrl)}</p>`
    : '';
  const securityNoteBlock = safeSecurityNote
    ? `<p style="margin:16px 0 0;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#475569;font-size:12px;line-height:1.6;">${escapeHtml(safeSecurityNote)}</p>`
    : '';

  const supportEmailLine = brand.supportEmail
    ? `<span style="display:block;margin-top:6px;">E-mail: <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(brand.supportEmail)}</a></span>`
    : '';
  const footerMessageBlock = safeFooterMessage
    ? `<span style="display:block;margin-top:6px;color:#64748b;">${escapeHtml(safeFooterMessage)}</span>`
    : '';
  const taglineBlock = brand.brandTagline
    ? `<p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.6;">${escapeHtml(brand.brandTagline)}</p>`
    : '';

  return `
<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(safePreheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:28px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;">
            <tr>
              <td align="center" style="padding:0 0 16px;">
                ${logoBlock}
                ${taglineBlock}
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #dbe3ef;border-radius:14px;padding:26px 24px;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
                <h1 style="margin:0 0 14px;color:#0f172a;font-size:25px;line-height:1.25;">${escapeHtml(safeHeading)}</h1>
                ${greetingBlock}
                ${introBlock}
                ${bodyBlock}
                ${ctaBlock}
                ${ctaHintBlock}
                ${fallbackLinkBlock}
                ${securityNoteBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 2px 0;color:#64748b;font-size:12px;line-height:1.7;text-align:left;">
                <span style="display:block;">${escapeHtml(brand.brandName)} © ${year}. Todos os direitos reservados.</span>
                <span style="display:block;margin-top:6px;">Suporte: <a href="${escapeHtml(brand.supportUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(brand.supportLabel)}</a></span>
                ${supportEmailLine}
                ${footerMessageBlock}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
};

const buildWelcomeTemplate = (payload = {}) => {
  const name = normalizeText(payload?.name || payload?.firstName || '', 80) || 'voce';
  const siteOrigin = normalizeHttpUrl(payload?.siteOrigin || resolveSiteOrigin(), resolveSiteOrigin());
  const loginUrl = normalizeHttpUrl(payload?.loginUrl || `${siteOrigin}/login/`, `${siteOrigin}/login/`);
  const subject = 'Bem-vindo(a) ao OmniZap';

  return {
    subject,
    text: [
      `Ola, ${name}!`,
      '',
      'Sua conta no OmniZap foi preparada e ja esta pronta para uso.',
      `Acesse agora: ${loginUrl}`,
      '',
      'Se voce nao solicitou este e-mail, desconsidere esta mensagem.',
    ].join('\n'),
    html: renderEmailLayout({
      payload,
      preheader: 'Sua conta no OmniZap esta pronta para uso.',
      heading: 'Bem-vindo(a) ao OmniZap',
      greeting: `Ola, ${name}!`,
      intro: 'Sua conta foi preparada com sucesso. Use o botao abaixo para entrar com seguranca.',
      ctaLabel: 'Entrar no OmniZap',
      ctaUrl: loginUrl,
      ctaHint: 'Recomendamos acessar por um dispositivo confiavel.',
      securityNote: 'Se voce nao reconhece esta acao, ignore este e-mail.',
      footerMessage: 'Este e-mail foi enviado automaticamente pelo sistema.',
    }),
  };
};

const buildMagicLinkTemplate = (payload = {}) => {
  const name = normalizeText(payload?.name || payload?.firstName || '', 80) || 'voce';
  const link = normalizeHttpUrl(payload?.link || payload?.magicLink || payload?.loginUrl || '', '');
  if (!link) return null;

  const expiresInMinutes = Number(payload?.expiresInMinutes);
  const expirationMessage =
    Number.isFinite(expiresInMinutes) && expiresInMinutes > 0
      ? `Este link expira em ${Math.max(1, Math.floor(expiresInMinutes))} minuto(s).`
      : 'Este link pode expirar em alguns minutos.';
  const subject = 'Seu link de acesso ao OmniZap';

  return {
    subject,
    text: [
      `Ola, ${name}!`,
      '',
      'Use o link abaixo para acessar sua conta com seguranca:',
      link,
      '',
      expirationMessage,
      'Se voce nao solicitou este acesso, ignore esta mensagem.',
    ].join('\n'),
    html: renderEmailLayout({
      payload,
      preheader: 'Use seu link de acesso seguro do OmniZap.',
      heading: 'Seu link de acesso',
      greeting: `Ola, ${name}!`,
      intro: 'Clique no botao abaixo para entrar na sua conta.',
      ctaLabel: 'Acessar conta',
      ctaUrl: link,
      ctaHint: expirationMessage,
      securityNote: 'Nao compartilhe este link com terceiros.',
      footerMessage: 'Para sua seguranca, este link e pessoal e temporario.',
    }),
  };
};

const buildProjectUpdateTemplate = (payload = {}) => {
  const name = normalizeText(payload?.name || payload?.firstName || '', 80) || 'usuario';
  const title = normalizeText(payload?.title || payload?.heading || 'Atualizacao do projeto OmniZap', 120) || 'Atualizacao do projeto OmniZap';
  const message =
    normalizeText(
      payload?.message || payload?.body || 'Temos uma nova atualizacao do projeto. Confira os detalhes no painel.',
      6_000,
    ) || 'Temos uma nova atualizacao do projeto. Confira os detalhes no painel.';
  const details = normalizeText(payload?.details || '', 6_000);
  const ctaUrl = normalizeHttpUrl(payload?.ctaUrl || payload?.link || payload?.loginUrl || '', '');
  const ctaLabel = normalizeText(payload?.ctaLabel || 'Ver atualizacao', 80) || 'Ver atualizacao';
  const subject = normalizeText(payload?.subject || title, 180) || title;

  const textLines = [`Ola, ${name}!`, '', title, '', message];
  if (details) {
    textLines.push('', details);
  }
  if (ctaUrl) {
    textLines.push('', `Acesse: ${ctaUrl}`);
  }
  textLines.push('', 'Mensagem automatica do OmniZap.');

  return {
    subject,
    text: textLines.join('\n'),
    html: renderEmailLayout({
      payload,
      preheader: title,
      heading: title,
      greeting: `Ola, ${name}!`,
      intro: message,
      body: details,
      ctaLabel: ctaUrl ? ctaLabel : '',
      ctaUrl,
      ctaHint: ctaUrl ? 'Abra o link para ver os detalhes completos.' : '',
      securityNote: 'Se voce nao reconhece esta comunicacao, entre em contato com o suporte.',
      footerMessage: 'Comunicado oficial do projeto OmniZap.',
    }),
  };
};

const buildStandardTemplate = (payload = {}) => {
  const name = normalizeText(payload?.name || payload?.firstName || '', 80);
  const subject = normalizeText(payload?.subject || payload?.title || 'Comunicado OmniZap', 180) || 'Comunicado OmniZap';
  const heading = normalizeText(payload?.heading || payload?.title || 'Atualizacao OmniZap', 120) || 'Atualizacao OmniZap';
  const intro = normalizeText(payload?.intro || payload?.message || payload?.summary || 'Temos uma nova comunicacao para voce.', 2_000);
  const details = normalizeText(payload?.body || payload?.details || '', 6_000);
  const ctaUrl = normalizeHttpUrl(payload?.ctaUrl || payload?.link || payload?.loginUrl || '', '');
  const ctaLabel = normalizeText(payload?.ctaLabel || (ctaUrl ? 'Abrir OmniZap' : ''), 80);
  const securityNote =
    normalizeText(payload?.securityNote || 'Se nao reconhece esta mensagem, ignore e entre em contato com o suporte.', 220) ||
    'Se nao reconhece esta mensagem, ignore e entre em contato com o suporte.';
  const footerMessage = normalizeText(payload?.footerMessage || 'Mensagem automatica do projeto OmniZap.', 220);
  const greeting = name ? `Ola, ${name}!` : '';

  const textLines = [];
  if (greeting) {
    textLines.push(greeting, '');
  }
  textLines.push(heading, '');
  if (intro) {
    textLines.push(intro);
  }
  if (details) {
    textLines.push('', details);
  }
  if (ctaUrl) {
    textLines.push('', `Acesse: ${ctaUrl}`);
  }
  textLines.push('', 'Mensagem automatica do OmniZap.');

  return {
    subject,
    text: textLines.join('\n'),
    html: renderEmailLayout({
      payload,
      preheader: heading,
      heading,
      greeting,
      intro,
      body: details,
      ctaLabel: ctaUrl ? ctaLabel : '',
      ctaUrl,
      ctaHint: ctaUrl ? 'Abra o link para ver as informacoes completas.' : '',
      securityNote,
      footerMessage,
    }),
  };
};

const TEMPLATE_BUILDERS = {
  standard: buildStandardTemplate,
  default: buildStandardTemplate,
  welcome: buildWelcomeTemplate,
  magic_link: buildMagicLinkTemplate,
  project_update: buildProjectUpdateTemplate,
};

export const renderEmailTemplate = (templateKey, payload = {}) => {
  const normalizedTemplateKey = normalizeTemplateKey(templateKey);
  if (!normalizedTemplateKey) return null;
  const builder = TEMPLATE_BUILDERS[normalizedTemplateKey];
  if (typeof builder !== 'function') return null;

  const rendered = builder(payload || {});
  if (!rendered) return null;

  const subject = normalizeText(rendered.subject, 180);
  const text = normalizeText(rendered.text, 120_000);
  const html = normalizeText(rendered.html, 500_000);

  if (!subject || (!text && !html)) return null;

  return {
    subject,
    text: text || null,
    html: html || null,
    template_key: normalizedTemplateKey,
  };
};

export const listAvailableEmailTemplates = () => Object.keys(TEMPLATE_BUILDERS);
