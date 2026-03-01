import { sendMetricsResponse } from '../../controllers/metricsController.js';

const startsWithPath = (pathname, prefix) => {
  if (!pathname || !prefix) return false;
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
};

export const maybeHandleMetricsRequest = async (_req, res, { pathname, metricsPath }) => {
  if (!startsWithPath(pathname, metricsPath)) return false;
  await sendMetricsResponse(res);
  return true;
};
