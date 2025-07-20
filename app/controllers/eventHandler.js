const logger = require('../utils/logger/loggerModule');

/**
 * Lida com atualizações genéricas do WhatsApp que não são mensagens.
 *
 * @param {Object} event - Objeto contendo a atualização do WhatsApp.
 */
const handleGenericUpdate = (event) => {
  logger.info('🔄 Processando evento genérico recebido:', {
    eventType: event?.type || 'unknown',
    eventData: event,
  });
};

module.exports = {
  handleGenericUpdate,
};
