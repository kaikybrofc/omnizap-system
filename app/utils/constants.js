/**
 * OmniZap Constants Module
 *
 * Módulo centralizado para constantes e configurações do sistema
 *
 * @version 1.0.4
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const { str, cleanEnv } = require('envalid');

const env = cleanEnv(process.env, {
  COMMAND_PREFIX: str({ default: '/', desc: 'Prefixo para comandos no chat' }),
});

/**
 * Prefixo padrão para comandos
 */
const COMMAND_PREFIX = env.COMMAND_PREFIX;

/**
 * Constantes do sistema de stickers
 */
const STICKER_CONSTANTS = {
  STICKERS_PER_PACK: 30,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  SUPPORTED_FORMATS: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'],
  DEFAULT_PACK_NAME: '🤖 OmniZap Pack',
  DEFAULT_AUTHOR: '👤 OmniZap User',
  STICKER_MIMETYPE: 'image/webp',
  STICKER_EXTENSION: '.webp',
  PACK_ID_PREFIX: 'com.omnizap',
  PACK_ORIGIN: 'OMNIZAP',
  PACK_ID_HASH_SIZE: 8,
  STICKER_FILENAME_HASH_SIZE: 4,
};

/**
 * Configurações de rate limiting para envio
 */
const RATE_LIMIT_CONFIG = {
  BATCH_SIZE: 3,
  DELAY_BETWEEN_STICKERS: 600,
  DELAY_BETWEEN_BATCHES: 1800,
  MAX_RETRIES: 3,
};

/**
 * Emojis e símbolos padrão
 */
const EMOJIS = {
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  LOADING: '⏳',
  PACK: '📦',
  STATS: '📊',
  SEND: '📤',
  DELETE: '🗑️',
  EDIT: '✏️',
  HELP: '❓',
  STICKER_DEFAULT: '😊',
};

module.exports = {
  COMMAND_PREFIX,
  STICKER_CONSTANTS,
  RATE_LIMIT_CONFIG,
  EMOJIS,
};
