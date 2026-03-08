const sendJson = (req, res, statusCode, payload) => {
  if (res.writableEnded) return true;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(JSON.stringify(payload));
  return true;
};

const isAllowedMethod = (method) => method === 'GET' || method === 'HEAD';

export const shouldHandleHealthPath = (pathname) => pathname === '/healthz' || pathname === '/readyz';

export const maybeHandleHealthRequest = async (req, res, { pathname }) => {
  if (!shouldHandleHealthPath(pathname)) return false;

  if (!isAllowedMethod(req.method || '')) {
    return sendJson(req, res, 405, { error: 'Method Not Allowed' });
  }

  if (pathname === '/healthz') {
    return sendJson(req, res, 200, {
      ok: true,
      service: 'omnizap',
      type: 'health',
    });
  }

  if (pathname === '/readyz') {
    return sendJson(req, res, 200, {
      ok: true,
      service: 'omnizap',
      type: 'ready',
    });
  }

  return false;
};
