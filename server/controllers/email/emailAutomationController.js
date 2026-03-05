import logger from '../../../utils/logger/loggerModule.js';
import { getEmailAutomationStatusSnapshot, queueAutomatedEmail } from '../../email/emailAutomationService.js';
import { isEmailAutomationRuntimeEnabled, isEmailAutomationRuntimeRunning } from '../../email/emailAutomationRuntime.js';
import { getEmailTransportMetadata } from '../../email/emailTransportService.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeBasePath = (value, fallback) => {
  const raw = String(value || '').trim() || fallback;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
  return withoutTrailingSlash || fallback;
};

const EMAIL_AUTOMATION_API_BASE_PATH = normalizeBasePath(process.env.EMAIL_AUTOMATION_API_BASE_PATH, '/api/email');
const EMAIL_AUTOMATION_API_KEY =
  String(process.env.EMAIL_AUTOMATION_API_KEY || '')
    .trim()
    .slice(0, 255) || '';
const EMAIL_AUTOMATION_REQUIRE_API_KEY = parseEnvBool(process.env.EMAIL_AUTOMATION_REQUIRE_API_KEY, true);

const sendJson = (req, res, statusCode, payload) => {
  if (res.writableEnded) return true;
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(body);
  return true;
};

const readJsonBody = async (req, { maxBytes = 256 * 1024 } = {}) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error('Payload excedeu limite permitido.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error('JSON inválido.');
        error.statusCode = 400;
        reject(error);
      }
    });

    req.on('error', (error) => reject(error));
  });

const resolveApiKeyFromRequest = (req) => {
  const headerKey = String(req.headers?.['x-email-api-key'] || '').trim();
  if (headerKey) return headerKey;

  const authHeader = String(req.headers?.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
};

const assertAuthorized = (req) => {
  if (!EMAIL_AUTOMATION_REQUIRE_API_KEY) return;

  if (!EMAIL_AUTOMATION_API_KEY) {
    const error = new Error('EMAIL_AUTOMATION_API_KEY não configurada no servidor.');
    error.statusCode = 503;
    error.code = 'email_api_key_not_configured';
    throw error;
  }

  const requestKey = resolveApiKeyFromRequest(req);
  if (!requestKey || requestKey !== EMAIL_AUTOMATION_API_KEY) {
    const error = new Error('Não autorizado.');
    error.statusCode = 401;
    error.code = 'email_api_key_invalid';
    throw error;
  }
};

export const getEmailAutomationRouteConfig = () => ({
  apiBasePath: EMAIL_AUTOMATION_API_BASE_PATH,
});

export const maybeHandleEmailAutomationRequest = async (req, res, { pathname }) => {
  if (!['GET', 'HEAD', 'POST'].includes(req.method || '')) return false;

  const healthPath = `${EMAIL_AUTOMATION_API_BASE_PATH}/health`;
  const statsPath = `${EMAIL_AUTOMATION_API_BASE_PATH}/stats`;
  const enqueuePath = `${EMAIL_AUTOMATION_API_BASE_PATH}/enqueue`;
  const testPath = `${EMAIL_AUTOMATION_API_BASE_PATH}/test`;

  try {
    if (pathname === healthPath) {
      if (!['GET', 'HEAD'].includes(req.method || '')) {
        return sendJson(req, res, 405, { error: 'Method Not Allowed' });
      }

      return sendJson(req, res, 200, {
        ok: true,
        runtime_enabled: isEmailAutomationRuntimeEnabled(),
        runtime_running: isEmailAutomationRuntimeRunning(),
        api_key_required: EMAIL_AUTOMATION_REQUIRE_API_KEY,
        api_base_path: EMAIL_AUTOMATION_API_BASE_PATH,
        transport: getEmailTransportMetadata(),
      });
    }

    if (pathname === statsPath) {
      if (!['GET', 'HEAD'].includes(req.method || '')) {
        return sendJson(req, res, 405, { error: 'Method Not Allowed' });
      }
      assertAuthorized(req);

      const snapshot = await getEmailAutomationStatusSnapshot();
      return sendJson(req, res, 200, {
        ok: true,
        ...snapshot,
      });
    }

    if (pathname === enqueuePath) {
      if (req.method !== 'POST') {
        return sendJson(req, res, 405, { error: 'Method Not Allowed' });
      }
      assertAuthorized(req);

      const body = await readJsonBody(req);
      const queued = await queueAutomatedEmail({
        to: body.to,
        name: body.name,
        templateKey: body.templateKey,
        templateData: body.templateData,
        subject: body.subject,
        text: body.text,
        html: body.html,
        metadata: body.metadata,
        priority: body.priority,
        scheduledAt: body.scheduledAt,
        maxAttempts: body.maxAttempts,
        idempotencyKey: body.idempotencyKey,
      });

      return sendJson(req, res, 202, {
        ok: true,
        queued,
      });
    }

    if (pathname === testPath) {
      if (req.method !== 'POST') {
        return sendJson(req, res, 405, { error: 'Method Not Allowed' });
      }
      assertAuthorized(req);

      const body = await readJsonBody(req);
      const testRecipient = String(body.to || '').trim();
      const testName = String(body.name || 'Usuário OmniZap').trim();

      const queued = await queueAutomatedEmail({
        to: testRecipient,
        name: testName,
        templateKey: 'welcome',
        templateData: {
          name: testName,
          loginUrl: body.loginUrl,
          redirectUrl: body.redirectUrl,
          homeUrl: body.homeUrl,
          siteOrigin: body.siteOrigin,
        },
        metadata: {
          trigger: 'email_api_test',
        },
        idempotencyKey: body.idempotencyKey,
      });

      return sendJson(req, res, 202, {
        ok: true,
        queued,
      });
    }

    return false;
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);

    if (statusCode >= 500) {
      logger.error('Falha no controller de automação de e-mail.', {
        action: 'email_automation_controller_failed',
        path: pathname,
        method: req.method,
        error: error?.message,
      });
    }

    return sendJson(req, res, statusCode, {
      error: error?.message || 'Falha interna ao processar requisição de e-mail.',
      code: error?.code || null,
    });
  }
};
