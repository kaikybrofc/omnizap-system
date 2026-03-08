/**
 * Cria placeholders SQL do tipo "(?, ?, ?), (?, ?, ?)".
 * @param {number} rows
 * @param {number} cols
 * @returns {string}
 */
export const buildPlaceholders = (rows, cols) => Array.from({ length: rows }, () => `(${Array(cols).fill('?').join(', ')})`).join(', ');

/**
 * Cria placeholders repetindo um template por linha.
 * @param {number} rows
 * @param {string} rowTemplate
 * @returns {string}
 */
export const buildRowPlaceholders = (rows, rowTemplate) => Array.from({ length: rows }, () => rowTemplate).join(', ');

/**
 * Cria um executor de flush com controle de concorrencia e re-try imediato.
 * @param {object} params
 * @param {() => Promise<void>} params.onFlush
 * @param {(error: Error) => void} [params.onError]
 * @param {() => void} [params.onFinally]
 * @returns {{ run: () => Promise<void>, isInProgress: () => boolean }}
 */
export const createFlushRunner = ({ onFlush, onError, onFinally }) => {
  let inProgress = false;
  let requested = false;

  const run = async () => {
    if (inProgress) {
      requested = true;
      return;
    }
    inProgress = true;
    try {
      await onFlush();
    } catch (error) {
      if (onError) onError(error);
    } finally {
      inProgress = false;
      if (onFinally) onFinally();
      if (requested) {
        requested = false;
        setImmediate(() => {
          run().catch(() => {});
        });
      }
    }
  };

  return {
    run,
    isInProgress: () => inProgress,
  };
};
