import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

export const normalizeRequestId = (value) => {
  const token = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 120);
  return token || randomUUID();
};

export const parseRequestUrl = (req, host, port) => {
  const fallbackHost = `${host}:${port}`;
  const requestHost = req.headers.host || fallbackHost;
  try {
    return new URL(req.url || '/', `http://${requestHost}`);
  } catch {
    return new URL(req.url || '/', 'http://localhost');
  }
};
