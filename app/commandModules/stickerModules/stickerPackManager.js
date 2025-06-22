/**
 * OmniZap Sticker Pack Manager
 *
 * Módulo responsável pelo gerenciamento e envio de packs de stickers
 * organizados por usuário com limite configurável de stickers por pack
 *
 * @version 1.0.4
 * @author OmniZap Team
 * @license MIT
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../../utils/logger/loggerModule');
const { STICKER_CONSTANTS, EMOJIS, RATE_LIMIT_CONFIG } = require('../../utils/constants');
const { sendStickerMessage, sendTextMessage, formatSuccessMessage } = require('../../utils/messageUtils');

const STICKER_PACKS_DIR = path.join(process.cwd(), 'temp', 'stickerPacks');
const STICKERS_PER_PACK = STICKER_CONSTANTS.STICKERS_PER_PACK;

/**
 * Garante que os diretórios necessários existam
 */
async function ensurePackDirectories() {
  try {
    await fs.mkdir(STICKER_PACKS_DIR, { recursive: true });
    return true;
  } catch (error) {
    logger.error(`[StickerPackManager] Erro ao criar diretórios: ${error.message}`);
    return false;
  }
}

/**
 * Obtém ID do usuário a partir do sender (trata grupos e conversas individuais)
 */
function getUserId(sender, messageInfo) {
  if (sender.endsWith('@g.us') && messageInfo?.key?.participant) {
    return messageInfo.key.participant.split('@')[0];
  }
  return sender.split('@')[0];
}

/**
 * Obtém o caminho do arquivo de dados do usuário
 */
function getUserDataPath(userId) {
  return path.join(STICKER_PACKS_DIR, `${userId}.json`);
}

/**
 * Carrega dados do usuário ou cria estrutura inicial
 */
async function loadUserData(userId) {
  const userDataPath = getUserDataPath(userId);

  try {
    const data = await fs.readFile(userDataPath, 'utf-8');
    const userData = JSON.parse(data);
    return await validateAndFixUserData(userId);
  } catch (error) {
    logger.info(`[StickerPackManager] Criando nova estrutura de dados para usuário ${userId}`);

    const initialData = {
      userId: userId,
      totalStickers: 0,
      packs: [],
      currentPackIndex: 0,
      preferences: {
        defaultPackName: STICKER_CONSTANTS.DEFAULT_PACK_NAME,
        defaultPackAuthor: STICKER_CONSTANTS.DEFAULT_AUTHOR,
        lastUsedPackName: null,
        lastUsedPackAuthor: null,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    await saveUserData(userId, initialData);
    return initialData;
  }
}

/**
 * Salva dados do usuário
 */
async function saveUserData(userId, data) {
  const userDataPath = getUserDataPath(userId);
  data.lastUpdated = new Date().toISOString();

  await ensurePackDirectories();

  await fs.writeFile(userDataPath, JSON.stringify(data, null, 2));
  logger.debug(`[StickerPackManager] Dados salvos para usuário ${userId}`);
}

/**
 * Cria um novo pack de stickers
 */
function createNewPack(packIndex, packName, packAuthor) {
  const packId = `${STICKER_CONSTANTS.PACK_ID_PREFIX}.${Date.now()}.${crypto.randomBytes(STICKER_CONSTANTS.PACK_ID_HASH_SIZE).toString('hex')}`;

  return {
    packId: packId,
    packIndex: packIndex,
    name: packName || `${STICKER_CONSTANTS.DEFAULT_PACK_NAME} ${packIndex + 1}`,
    author: packAuthor || STICKER_CONSTANTS.DEFAULT_AUTHOR,
    stickers: [],
    createdAt: new Date().toISOString(),
    isComplete: false,
    thumbnailPath: null,
  };
}

/**
 * Adiciona um sticker ao pack atual do usuário
 */
async function addStickerToPack(userId, stickerPath, packName = null, packAuthor = null, messageInfo = null) {
  await ensurePackDirectories();

  const userData = await loadUserData(userId);

  if (userData.packs.length === 0) {
    const newPack = createNewPack(0, packName || `${STICKER_CONSTANTS.DEFAULT_PACK_NAME} 1`, packAuthor || STICKER_CONSTANTS.DEFAULT_AUTHOR);
    userData.packs.push(newPack);
    userData.currentPackIndex = 0;
    logger.info(`[StickerPackManager] Primeiro pack criado para usuário ${userId}: Pack 1`);
  }

  let currentPack = userData.packs[userData.currentPackIndex];
  if (!currentPack || currentPack.stickers.length >= STICKERS_PER_PACK) {
    const newPackIndex = userData.packs.length;
    const newPack = createNewPack(newPackIndex, packName || `${STICKER_CONSTANTS.DEFAULT_PACK_NAME} ${newPackIndex + 1}`, packAuthor || STICKER_CONSTANTS.DEFAULT_AUTHOR);

    userData.packs.push(newPack);
    userData.currentPackIndex = newPackIndex;
    currentPack = newPack;

    logger.info(`[StickerPackManager] Novo pack criado para usuário ${userId}: Pack ${newPackIndex + 1} (pack anterior ${currentPack !== newPack && userData.packs[newPackIndex - 1] ? 'completo com ' + userData.packs[newPackIndex - 1].stickers.length + ' stickers' : 'não encontrado'})`);
  }

  const stickerFileName = `sticker_${Date.now()}_${crypto.randomBytes(STICKER_CONSTANTS.STICKER_FILENAME_HASH_SIZE).toString('hex')}${STICKER_CONSTANTS.STICKER_EXTENSION}`;
  const packStickerPath = path.join(STICKER_PACKS_DIR, userId, `pack_${userData.currentPackIndex}`, stickerFileName);

  await fs.mkdir(path.dirname(packStickerPath), { recursive: true });

  await fs.copyFile(stickerPath, packStickerPath);

  const stickerInfo = {
    fileName: stickerFileName,
    filePath: packStickerPath,
    addedAt: new Date().toISOString(),
    isAnimated: false,
    emojis: [EMOJIS.STICKER_DEFAULT],
    accessibilityLabel: `Sticker ${currentPack.stickers.length + 1}`,
    isLottie: false,
    mimetype: STICKER_CONSTANTS.STICKER_MIMETYPE,
  };

  currentPack.stickers.push(stickerInfo);
  userData.totalStickers++;

  if (currentPack.stickers.length >= STICKERS_PER_PACK) {
    currentPack.isComplete = true;

    if (!currentPack.thumbnailPath && currentPack.stickers.length > 0) {
      currentPack.thumbnailPath = currentPack.stickers[0].filePath;
    }

    logger.info(`[StickerPackManager] Pack ${userData.currentPackIndex + 1} completo para usuário ${userId}`);
  }

  await saveUserData(userId, userData);

  return {
    packIndex: userData.currentPackIndex,
    packName: currentPack.name,
    stickerCount: currentPack.stickers.length,
    isPackComplete: currentPack.isComplete,
    totalStickers: userData.totalStickers,
    totalPacks: userData.packs.length,
  };
}

/**
 * Lista todos os packs do usuário
 */
async function listUserPacks(userId) {
  const userData = await loadUserData(userId);

  return userData.packs.map((pack) => ({
    packIndex: pack.packIndex,
    packId: pack.packId,
    name: pack.name,
    author: pack.author,
    stickerCount: pack.stickers.length,
    isComplete: pack.isComplete,
    createdAt: pack.createdAt,
  }));
}

/**
 * Obtém detalhes de um pack específico
 */
async function getPackDetails(userId, packIndex) {
  const userData = await loadUserData(userId);

  if (packIndex < 0 || packIndex >= userData.packs.length) {
    return null;
  }

  return userData.packs[packIndex];
}

/**
 * Deleta um pack específico
 */
async function deletePack(userId, packIndex) {
  const userData = await loadUserData(userId);

  if (packIndex < 0 || packIndex >= userData.packs.length) {
    return false;
  }

  const pack = userData.packs[packIndex];

  try {
    const packDir = path.join(STICKER_PACKS_DIR, userId, `pack_${packIndex}`);
    await fs.rm(packDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn(`[StickerPackManager] Erro ao remover diretório do pack: ${error.message}`);
  }

  userData.packs.splice(packIndex, 1);
  userData.totalStickers -= pack.stickers.length;

  userData.packs.forEach((p, index) => {
    p.packIndex = index;
  });

  if (userData.currentPackIndex >= userData.packs.length) {
    userData.currentPackIndex = Math.max(0, userData.packs.length - 1);
  }

  await saveUserData(userId, userData);
  return true;
}

/**
 * Renomeia um pack
 */
async function renamePack(userId, packIndex, newName, newAuthor = null) {
  const userData = await loadUserData(userId);

  if (packIndex < 0 || packIndex >= userData.packs.length) {
    return false;
  }

  const pack = userData.packs[packIndex];
  pack.name = newName;
  if (newAuthor) {
    pack.author = newAuthor;
  }

  await saveUserData(userId, userData);
  return true;
}

/**
 * Obtém estatísticas do usuário
 */
async function getUserStats(userId) {
  const userData = await loadUserData(userId);

  const completePacks = userData.packs.filter((pack) => pack.isComplete).length;
  const incompletePacks = userData.packs.length - completePacks;
  const currentPackStickers = userData.packs[userData.currentPackIndex]?.stickers?.length || 0;

  return {
    totalStickers: userData.totalStickers,
    totalPacks: userData.packs.length,
    completePacks: completePacks,
    incompletePacks: incompletePacks,
    currentPackIndex: userData.currentPackIndex,
    currentPackStickers: currentPackStickers,
    stickerSlotsRemaining: STICKERS_PER_PACK - currentPackStickers,
    createdAt: userData.createdAt,
    lastUpdated: userData.lastUpdated,
  };
}

/**
 * Obtém as preferências do usuário
 */
async function getUserPreferences(userId) {
  const userData = await validateAndFixUserData(userId);
  return userData.preferences;
}

/**
 * Atualiza as preferências do usuário
 */
async function updateUserPreferences(userId, packName = null, packAuthor = null) {
  const userData = await loadUserData(userId);

  if (!userData.preferences) {
    userData.preferences = {
      defaultPackName: STICKER_CONSTANTS.DEFAULT_PACK_NAME,
      defaultPackAuthor: STICKER_CONSTANTS.DEFAULT_AUTHOR,
      lastUsedPackName: null,
      lastUsedPackAuthor: null,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  }

  if (packName) {
    userData.preferences.lastUsedPackName = packName;
    userData.preferences.defaultPackName = packName;
  }

  if (packAuthor) {
    userData.preferences.lastUsedPackAuthor = packAuthor;
    userData.preferences.defaultPackAuthor = packAuthor;
  }

  userData.preferences.lastUpdated = new Date().toISOString();

  await saveUserData(userId, userData);
  logger.info(`[StickerPackManager] Preferências atualizadas para usuário ${userId}`);

  return userData.preferences;
}

/**
 * Verifica e corrige a integridade dos dados do usuário
 */
async function validateAndFixUserData(userId) {
  try {
    const userDataPath = getUserDataPath(userId);

    const fileExists = await fs
      .access(userDataPath)
      .then(() => true)
      .catch(() => false);

    if (!fileExists) {
      logger.warn(`[StickerPackManager] Arquivo de dados não encontrado para usuário ${userId}, criando novo`);
      return await loadUserData(userId);
    }

    const data = await fs.readFile(userDataPath, 'utf-8');
    let userData;

    try {
      userData = JSON.parse(data);
    } catch (error) {
      logger.error(`[StickerPackManager] Arquivo JSON corrompido para usuário ${userId}, recriando`);
      return await loadUserData(userId);
    }

    if (!userData.preferences) {
      logger.info(`[StickerPackManager] Adicionando estrutura de preferências para usuário ${userId}`);
      userData.preferences = {
        defaultPackName: STICKER_CONSTANTS.DEFAULT_PACK_NAME,
        defaultPackAuthor: STICKER_CONSTANTS.DEFAULT_AUTHOR,
        lastUsedPackName: null,
        lastUsedPackAuthor: null,
        createdAt: userData.createdAt || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
      await saveUserData(userId, userData);
    }

    const requiredFields = ['userId', 'totalStickers', 'packs', 'currentPackIndex', 'createdAt', 'lastUpdated'];
    let needsUpdate = false;

    for (const field of requiredFields) {
      if (userData[field] === undefined) {
        logger.warn(`[StickerPackManager] Campo obrigatório ${field} ausente, corrigindo`);
        needsUpdate = true;

        switch (field) {
          case 'userId':
            userData.userId = userId;
            break;
          case 'totalStickers':
            userData.totalStickers = 0;
            break;
          case 'packs':
            userData.packs = [];
            break;
          case 'currentPackIndex':
            userData.currentPackIndex = 0;
            break;
          case 'createdAt':
            userData.createdAt = new Date().toISOString();
            break;
          case 'lastUpdated':
            userData.lastUpdated = new Date().toISOString();
            break;
        }
      }
    }

    if (needsUpdate) {
      await saveUserData(userId, userData);
      logger.info(`[StickerPackManager] Dados corrigidos para usuário ${userId}`);
    }

    return userData;
  } catch (error) {
    logger.error(`[StickerPackManager] Erro ao validar dados do usuário ${userId}: ${error.message}`);
    return await loadUserData(userId);
  }
}

/**
 * Envia um pack de stickers individualmente
 *
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {string} targetJid - JID de destino
 * @param {Object} pack - Pack de stickers
 * @param {Object} messageInfo - Informações da mensagem original
 * @returns {Promise<boolean>} Sucesso do envio
 */
async function sendStickerPackIndividually(omniZapClient, targetJid, pack, messageInfo = null) {
  try {
    logger.info(`[StickerPackManager] Iniciando envio individual de stickers`, {
      packId: pack.packId,
      packName: pack.name,
      stickerCount: pack.stickers.length,
      targetJid: targetJid,
    });

    if (!omniZapClient || !targetJid || !pack) {
      throw new Error('Parâmetros obrigatórios não fornecidos');
    }

    if (!pack.stickers || pack.stickers.length === 0) {
      throw new Error('Pack não possui stickers');
    }

    const validStickers = [];
    for (const sticker of pack.stickers) {
      try {
        await fs.access(sticker.filePath);
        validStickers.push(sticker);
      } catch (error) {
        logger.warn(`[StickerPackManager] Sticker inválido ignorado: ${sticker.fileName}`);
      }
    }

    if (validStickers.length === 0) {
      throw new Error('Nenhum sticker válido encontrado no pack');
    }

    const introMessage = `${EMOJIS.PACK} *${pack.name}*\n👤 Por: ${pack.author}\n🎯 ${validStickers.length} stickers\n\n✨ *Enviando stickers...*`;

    await sendTextMessage(omniZapClient, targetJid, introMessage, {
      originalMessage: messageInfo,
    });

    await sendStickersIndividually(omniZapClient, targetJid, validStickers, pack, messageInfo);

    logger.info(`[StickerPackManager] Pack enviado com sucesso`);
    return true;
  } catch (error) {
    logger.error(`[StickerPackManager] Erro no envio do pack: ${error.message}`, {
      error: error.stack,
      packId: pack?.packId,
      targetJid: targetJid,
    });
    throw error;
  }
}

/**
 * Envia stickers individualmente usando sendStickerMessage
 */
async function sendStickersIndividually(omniZapClient, targetJid, validStickers, pack, messageInfo) {
  const { BATCH_SIZE, DELAY_BETWEEN_STICKERS, DELAY_BETWEEN_BATCHES } = RATE_LIMIT_CONFIG;

  let sentCount = 0;

  logger.info(`[StickerPackManager] Enviando ${validStickers.length} stickers individualmente`);

  for (let i = 0; i < validStickers.length; i += BATCH_SIZE) {
    const batch = validStickers.slice(i, i + BATCH_SIZE);

    logger.debug(`[StickerPackManager] Enviando lote ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validStickers.length / BATCH_SIZE)}`);

    for (const sticker of batch) {
      try {
        await fs.access(sticker.filePath);

        await sendStickerMessage(omniZapClient, targetJid, sticker.filePath, {
          originalMessage: messageInfo,
          packname: pack.name,
          author: pack.author,
        });

        sentCount++;
        logger.debug(`[StickerPackManager] Sticker enviado: ${sticker.fileName} (${sentCount}/${validStickers.length})`);

        if (sentCount < validStickers.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_STICKERS));
        }
      } catch (stickerError) {
        logger.warn(`[StickerPackManager] Falha no envio do sticker ${sticker.fileName}: ${stickerError.message}`);
      }
    }

    if (i + BATCH_SIZE < validStickers.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  const successMessage = formatSuccessMessage('Pack enviado com sucesso!', `${EMOJIS.PACK} **${pack.name}**\n📨 ${sentCount}/${validStickers.length} stickers entregues`, 'Adicione os stickers aos seus favoritos para acesso rápido!');

  await sendTextMessage(omniZapClient, targetJid, successMessage, {
    originalMessage: messageInfo,
  });

  logger.info(`[StickerPackManager] Envio individual concluído`, {
    packName: pack.name,
    totalStickers: validStickers.length,
    sentStickers: sentCount,
    successRate: `${((sentCount / validStickers.length) * 100).toFixed(1)}%`,
  });
}

module.exports = {
  addStickerToPack,
  listUserPacks,
  getPackDetails,
  deletePack,
  renamePack,
  getUserStats,
  getUserId,
  sendStickerPackIndividually,
  getUserPreferences,
  updateUserPreferences,
  STICKERS_PER_PACK,
  validateAndFixUserData,
};
