import { z } from 'zod';

const ensureObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const sanitizeIssuePath = (issuePath) => {
  if (!Array.isArray(issuePath) || !issuePath.length) return 'payload';
  return issuePath.map((segment) => String(segment)).join('.');
};

const buildValidationError = (error, fallbackMessage = 'Payload invalido.') => {
  const issues = Array.isArray(error?.issues)
    ? error.issues.map((issue) => ({
        path: sanitizeIssuePath(issue?.path),
        message: String(issue?.message || 'Valor invalido.'),
      }))
    : [];

  const errorMessage = issues[0]?.message || fallbackMessage;
  const wrapped = new Error(errorMessage);
  wrapped.statusCode = 400;
  wrapped.code = 'INVALID_PAYLOAD';
  wrapped.details = issues;
  return wrapped;
};

const optionalTrimmedString = (maxLength) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().max(maxLength).optional(),
  );

const optionalTimestamp = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
}, z.string().max(32).optional());

const optionalSignature = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
}, z.string().max(256).optional());

const optionalIsoDatetime = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
}, z.string().datetime({ offset: true }).optional());

const googleAuthSessionPayloadSchema = z
  .object({
    google_id_token: optionalTrimmedString(4096),
    id_token: optionalTrimmedString(4096),
    wa: optionalTrimmedString(32),
    wa_ts: optionalTimestamp,
    wa_sig: optionalSignature,
    whatsapp_login: z
      .object({
        wa: optionalTrimmedString(32),
        phone: optionalTrimmedString(32),
        wa_ts: optionalTimestamp,
        ts: optionalTimestamp,
        wa_sig: optionalSignature,
        sig: optionalSignature,
      })
      .partial()
      .optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const token = String(data.google_id_token || data.id_token || '').trim();
    if (!token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['google_id_token'],
        message: 'Token Google ausente.',
      });
    }
  });

const adminSessionPasswordPayloadSchema = z.object({
  password: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.string().min(1).max(256),
    )
    .refine((value) => value.length > 0, 'Senha obrigatoria.'),
});

const adminModeratorUpsertPayloadSchema = z
  .object({
    google_sub: optionalTrimmedString(80),
    email: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.string().email().max(255).optional(),
      )
      .optional(),
    owner_jid: optionalTrimmedString(255),
    password: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim() : value),
        z.string().min(1).max(256),
      )
      .refine((value) => value.length > 0, 'Senha obrigatoria.'),
  })
  .superRefine((data, ctx) => {
    const hasIdentity = Boolean(
      String(data.google_sub || '').trim() ||
      String(data.email || '').trim() ||
      String(data.owner_jid || '').trim(),
    );
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['google_sub'],
        message: 'Informe google_sub, email ou owner_jid.',
      });
    }
  });

const userPasswordUpsertPayloadSchema = z.object({
  password: z
    .preprocess((value) => (typeof value === 'string' ? value : ''), z.string().min(1).max(256))
    .refine((value) => value.trim().length > 0, 'Senha obrigatoria.'),
});

const userPasswordLoginPayloadSchema = z
  .object({
    google_sub: optionalTrimmedString(80),
    email: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.string().email().max(255).optional(),
      )
      .optional(),
    owner_jid: optionalTrimmedString(255),
    password: z
      .preprocess((value) => (typeof value === 'string' ? value : ''), z.string().min(1).max(256))
      .refine((value) => value.trim().length > 0, 'Senha obrigatoria.'),
  })
  .superRefine((data, ctx) => {
    const hasIdentity = Boolean(
      String(data.google_sub || '').trim() ||
      String(data.email || '').trim() ||
      String(data.owner_jid || '').trim(),
    );
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['google_sub'],
        message: 'Informe google_sub, email ou owner_jid.',
      });
    }
  });

const userPasswordRecoveryRequestPayloadSchema = z
  .object({
    google_sub: optionalTrimmedString(80),
    email: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.string().email().max(255).optional(),
      )
      .optional(),
    owner_jid: optionalTrimmedString(255),
    purpose: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['reset', 'setup']).optional(),
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hasIdentity = Boolean(
      String(data.google_sub || '').trim() ||
      String(data.email || '').trim() ||
      String(data.owner_jid || '').trim(),
    );
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['google_sub'],
        message: 'Informe google_sub, email ou owner_jid.',
      });
    }
  });

const userPasswordRecoveryVerifyPayloadSchema = z
  .object({
    google_sub: optionalTrimmedString(80),
    email: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.string().email().max(255).optional(),
      )
      .optional(),
    owner_jid: optionalTrimmedString(255),
    purpose: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.enum(['reset', 'setup']).optional(),
      )
      .optional(),
    code: z.preprocess(
      (value) =>
        String(value || '')
          .replace(/\D+/g, '')
          .slice(0, 6),
      z.string().regex(/^\d{6}$/, 'Codigo de verificacao deve conter 6 digitos.'),
    ),
    password: z
      .preprocess((value) => (typeof value === 'string' ? value : ''), z.string().min(1).max(256))
      .refine((value) => value.trim().length > 0, 'Senha obrigatoria.'),
  })
  .superRefine((data, ctx) => {
    const hasIdentity = Boolean(
      String(data.google_sub || '').trim() ||
      String(data.email || '').trim() ||
      String(data.owner_jid || '').trim(),
    );
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['google_sub'],
        message: 'Informe google_sub, email ou owner_jid.',
      });
    }
  });

const termsAcceptanceDocumentSchema = z.object({
  document_key: z.preprocess(
    (value) => String(value || '').trim().toLowerCase(),
    z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9_-]+$/, 'document_key invalido.'),
  ),
  document_version: z.preprocess(
    (value) => String(value || '').trim(),
    z.string().min(1).max(64),
  ),
});

const termsAcceptancePayloadSchema = z
  .object({
    accepted: z.preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1') return true;
      if (value === 0 || value === '0') return false;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'on'].includes(normalized)) return true;
        if (['false', 'no', 'off'].includes(normalized)) return false;
      }
      return value;
    }, z.boolean()),
    accepted_at: optionalIsoDatetime,
    source: optionalTrimmedString(32),
    documents: z.array(termsAcceptanceDocumentSchema).min(1).max(8),
    context: z
      .object({
        login_hint_phone: optionalTrimmedString(32),
        login_hint_ts: optionalTimestamp,
      })
      .partial()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.accepted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accepted'],
        message: 'Aceite deve ser verdadeiro.',
      });
    }
  });

const parseWithSchema = (schema, payload, fallbackMessage) => {
  const parsed = schema.safeParse(ensureObject(payload));
  if (!parsed.success) {
    throw buildValidationError(parsed.error, fallbackMessage);
  }
  return parsed.data;
};

export const parseGoogleAuthSessionPayload = (payload) =>
  parseWithSchema(googleAuthSessionPayloadSchema, payload, 'Payload de login Google invalido.');

export const parseAdminSessionPasswordPayload = (payload) =>
  parseWithSchema(adminSessionPasswordPayloadSchema, payload, 'Payload de sessao admin invalido.');

export const parseAdminModeratorUpsertPayload = (payload) =>
  parseWithSchema(adminModeratorUpsertPayloadSchema, payload, 'Payload de moderador invalido.');

export const parseUserPasswordUpsertPayload = (payload) =>
  parseWithSchema(userPasswordUpsertPayloadSchema, payload, 'Payload de senha invalido.');

export const parseUserPasswordLoginPayload = (payload) =>
  parseWithSchema(userPasswordLoginPayloadSchema, payload, 'Payload de login por senha invalido.');

export const parseUserPasswordRecoveryRequestPayload = (payload) =>
  parseWithSchema(
    userPasswordRecoveryRequestPayloadSchema,
    payload,
    'Payload de recuperacao de senha invalido.',
  );

export const parseUserPasswordRecoveryVerifyPayload = (payload) =>
  parseWithSchema(
    userPasswordRecoveryVerifyPayloadSchema,
    payload,
    'Payload de verificacao de codigo invalido.',
  );

export const parseTermsAcceptancePayload = (payload) =>
  parseWithSchema(
    termsAcceptancePayloadSchema,
    payload,
    'Payload de aceite juridico invalido.',
  );
