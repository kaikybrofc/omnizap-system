export class StickerPackError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'StickerPackError';
    this.code = code;
    this.details = details;
  }
}

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
