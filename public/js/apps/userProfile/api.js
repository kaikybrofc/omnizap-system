/* global fetch */

export const createUserProfileApi = ({ apiBasePath }) => {
  const sessionPath = `${apiBasePath}/auth/google/session`;
  const profilePath = `${apiBasePath}/me`;
  const botContactPath = `${apiBasePath}/bot-contact`;
  const supportPath = `${apiBasePath}/support`;

  const fetchJson = async (url, init = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error(payload?.error || `Falha HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }

    return payload || {};
  };

  return {
    fetchSummary: () => fetchJson(`${profilePath}?view=summary`, { method: 'GET' }),
    fetchBotContact: () => fetchJson(botContactPath, { method: 'GET' }),
    fetchSupport: () => fetchJson(supportPath, { method: 'GET' }),
    logout: () => fetchJson(sessionPath, { method: 'DELETE' }),
  };
};
