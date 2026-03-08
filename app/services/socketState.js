let activeSocket = null;

export const setActiveSocket = (socket) => {
  activeSocket = socket;
};

export const getActiveSocket = () => activeSocket;

/**
 * Indica se uma instância de socket está aberta para operações.
 * @param {object|null|undefined} socket Instância de socket.
 * @returns {boolean}
 */
export const isSocketOpen = (socket) => {
  if (!socket?.ws) return false;
  if (typeof socket.ws.isOpen === 'boolean') return socket.ws.isOpen;
  return socket.ws.readyState === 1;
};

/**
 * Indica se o socket ativo está aberto para operações.
 * @returns {boolean}
 */
export const isActiveSocketOpen = () => isSocketOpen(activeSocket);

/**
 * Executa um método em uma instância de socket validando disponibilidade.
 * @param {object|null|undefined} socket Instância de socket.
 * @param {string} methodName Nome do método no socket.
 * @param {...any} args Argumentos do método.
 * @returns {Promise<any>}
 */
export const runSocketMethod = async (socket, methodName, ...args) => {
  if (!isSocketOpen(socket)) {
    throw new Error(`Socket do WhatsApp indisponível para "${methodName}".`);
  }

  const method = socket?.[methodName];
  if (typeof method !== 'function') {
    throw new Error(`Método "${methodName}" não disponível no socket informado.`);
  }

  return method.apply(socket, args);
};

/**
 * Executa um método do socket ativo após validar disponibilidade.
 * @param {string} methodName Nome do método no socket.
 * @param {...any} args Argumentos do método.
 * @returns {Promise<any>}
 */
export const runActiveSocketMethod = async (methodName, ...args) => runSocketMethod(activeSocket, methodName, ...args);

/**
 * Recupera a blocklist da conta conectada.
 * @returns {Promise<(string|undefined)[]>}
 */
export const fetchBlocklistFromActiveSocket = async () => runActiveSocketMethod('fetchBlocklist');

/**
 * Recupera URL da foto de perfil via socket ativo.
 * @param {string} jid JID alvo.
 * @param {'preview'|'image'} [type='image'] Resolução da imagem.
 * @param {number} [timeoutMs] Timeout opcional da query.
 * @returns {Promise<string|null>}
 */
export const profilePictureUrlFromActiveSocket = async (jid, type = 'image', timeoutMs) => {
  const url = await runActiveSocketMethod('profilePictureUrl', jid, type, timeoutMs);
  return typeof url === 'string' && url.trim() ? url : null;
};
