import { sendMetricsResponse } from '../controllers/metricsController.js';

export const maybeHandleMetricsRoute = async (req, res, { pathname, metricsPath }) => {
  if (!pathname.startsWith(metricsPath)) return false;
  await sendMetricsResponse(res);
  return true;
};
