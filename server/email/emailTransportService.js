import nodemailer from 'nodemailer';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const resolveSmtpConfig = () => {
  const host = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || process.env.MAIL_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || process.env.MAIL_PORT || 465);
  const user = String(process.env.SMTP_USER || process.env.EMAIL_USER || process.env.MAIL_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.MAIL_PASS || '').trim();
  const from =
    String(process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.MAIL_FROM || '')
      .trim()
      .slice(0, 255) || '';
  const replyTo =
    String(process.env.SMTP_REPLY_TO || process.env.EMAIL_REPLY_TO || process.env.MAIL_REPLY_TO || '')
      .trim()
      .slice(0, 255) || '';
  const secure = parseEnvBool(process.env.SMTP_SECURE || process.env.EMAIL_SECURE || process.env.MAIL_SECURE, Number(port) === 465);

  return {
    host,
    port: Number.isFinite(port) ? Math.max(1, Math.min(65535, Math.floor(port))) : 465,
    secure,
    user,
    pass,
    from: from || (user ? `OmniZap <${user}>` : ''),
    replyTo: replyTo || null,
  };
};

const toConfigCacheKey = (config) => JSON.stringify(config);

let transportCacheKey = '';
let transporter = null;

const buildTransporter = () => {
  const config = resolveSmtpConfig();
  const cacheKey = toConfigCacheKey(config);

  if (transporter && transportCacheKey === cacheKey) {
    return { transporter, config };
  }

  transportCacheKey = cacheKey;
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  return { transporter, config };
};

export const isEmailTransportConfigured = () => {
  const config = resolveSmtpConfig();
  return Boolean(config.host && config.port && config.user && config.pass && config.from);
};

export const verifyEmailTransport = async () => {
  if (!isEmailTransportConfigured()) {
    const error = new Error('Transporte SMTP não configurado.');
    error.code = 'EMAIL_TRANSPORT_NOT_CONFIGURED';
    throw error;
  }

  const built = buildTransporter();
  await built.transporter.verify();
  return true;
};

export const sendEmailMessage = async ({
  to,
  subject,
  text = null,
  html = null,
  replyTo = null,
  cc = null,
  bcc = null,
  headers = null,
} = {}) => {
  if (!isEmailTransportConfigured()) {
    const error = new Error('Transporte SMTP não configurado.');
    error.code = 'EMAIL_TRANSPORT_NOT_CONFIGURED';
    throw error;
  }

  const normalizedTo =
    String(to || '')
      .trim()
      .slice(0, 255) || '';
  const normalizedSubject =
    String(subject || '')
      .trim()
      .slice(0, 180) || '';
  const normalizedText =
    String(text || '')
      .trim()
      .slice(0, 120_000) || '';
  const normalizedHtml =
    String(html || '')
      .trim()
      .slice(0, 500_000) || '';

  if (!normalizedTo || !normalizedTo.includes('@')) {
    const error = new Error('Destinatário de e-mail inválido.');
    error.code = 'EMAIL_INVALID_RECIPIENT';
    throw error;
  }

  if (!normalizedSubject) {
    const error = new Error('Assunto de e-mail inválido.');
    error.code = 'EMAIL_INVALID_SUBJECT';
    throw error;
  }

  if (!normalizedText && !normalizedHtml) {
    const error = new Error('Corpo do e-mail vazio.');
    error.code = 'EMAIL_EMPTY_BODY';
    throw error;
  }

  const built = buildTransporter();

  const info = await built.transporter.sendMail({
    from: built.config.from,
    to: normalizedTo,
    subject: normalizedSubject,
    text: normalizedText || undefined,
    html: normalizedHtml || undefined,
    replyTo: replyTo || built.config.replyTo || undefined,
    cc: cc || undefined,
    bcc: bcc || undefined,
    headers: headers && typeof headers === 'object' ? headers : undefined,
  });

  return {
    messageId: String(info?.messageId || '').trim() || null,
    accepted: Array.isArray(info?.accepted) ? info.accepted : [],
    rejected: Array.isArray(info?.rejected) ? info.rejected : [],
    response: String(info?.response || '').trim() || null,
  };
};

export const getEmailTransportMetadata = () => {
  const config = resolveSmtpConfig();
  return {
    configured: isEmailTransportConfigured(),
    host: config.host || null,
    port: config.port,
    secure: Boolean(config.secure),
    from: config.from || null,
    reply_to: config.replyTo || null,
    user: config.user ? `${config.user.slice(0, 3)}***` : null,
  };
};
