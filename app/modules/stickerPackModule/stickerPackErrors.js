/**
 * Erro padrão para operações relacionadas a packs de figurinha.
 */
export class StickerPackError extends Error {
  /**
   * @param {string} code Código semântico do erro.
   * @param {string} message Mensagem amigável para logs/cliente.
   * @param {unknown} [details=null] Objeto técnico opcional para diagnóstico.
   */
  constructor(code, message, details = null) {
    super(message);
    this.name = 'StickerPackError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Catálogo de códigos de erro usados pelo domínio de sticker pack.
 */
export const STICKER_PACK_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',
  NOT_ALLOWED: 'NOT_ALLOWED',
  STICKER_NOT_FOUND: 'STICKER_NOT_FOUND',
  PACK_LIMIT_REACHED: 'PACK_LIMIT_REACHED',
  DUPLICATE_STICKER: 'DUPLICATE_STICKER',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};
