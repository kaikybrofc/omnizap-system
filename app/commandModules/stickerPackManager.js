/**
 * OmniZap Sticker Pack Manager
 *
 * Módulo responsável pelo gerenciamento de packs de stickers
 * organizados por usuário com limite de 30 stickers por pack
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger/loggerModule');

const STICKER_PACKS_DIR = path.join(process.cwd(), 'temp', 'stickerPacks');
const STICKERS_PER_PACK = 30;

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
    return JSON.parse(data);
  } catch (error) {
    // Se não existe, cria estrutura inicial
    const initialData = {
      userId: userId,
      totalStickers: 0,
      packs: [],
      currentPackIndex: 0,
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

  await fs.writeFile(userDataPath, JSON.stringify(data, null, 2));
  logger.debug(`[StickerPackManager] Dados salvos para usuário ${userId}`);
}

/**
 * Cria um novo pack de stickers
 */
function createNewPack(packIndex, packName, packAuthor) {
  const packId = `com.omnizap.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;

  return {
    packId: packId,
    packIndex: packIndex,
    name: packName || `🤖 OmniZap Pack ${packIndex + 1}`,
    author: packAuthor || '👤 OmniZap User',
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

  // Se não há packs, cria o primeiro
  if (userData.packs.length === 0) {
    const newPack = createNewPack(0, packName || `🤖 OmniZap Pack 1`, packAuthor || '👤 OmniZap User');
    userData.packs.push(newPack);
    userData.currentPackIndex = 0;
    logger.info(`[StickerPackManager] Primeiro pack criado para usuário ${userId}: Pack 1`);
  }

  // Verifica se o pack atual existe e se está cheio, cria um novo
  let currentPack = userData.packs[userData.currentPackIndex];
  if (!currentPack || currentPack.stickers.length >= STICKERS_PER_PACK) {
    const newPackIndex = userData.packs.length;
    const newPack = createNewPack(newPackIndex, packName || `🤖 OmniZap Pack ${newPackIndex + 1}`, packAuthor || '👤 OmniZap User');

    userData.packs.push(newPack);
    userData.currentPackIndex = newPackIndex;
    currentPack = newPack; // Atualiza a referência para o novo pack

    logger.info(`[StickerPackManager] Novo pack criado para usuário ${userId}: Pack ${newPackIndex + 1} (pack anterior ${currentPack !== newPack && userData.packs[newPackIndex - 1] ? 'completo com ' + userData.packs[newPackIndex - 1].stickers.length + ' stickers' : 'não encontrado'})`);
  }

  // Copia o sticker para o diretório do pack
  const stickerFileName = `sticker_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.webp`;
  const packStickerPath = path.join(STICKER_PACKS_DIR, userId, `pack_${userData.currentPackIndex}`, stickerFileName);

  // Cria diretório do pack se não existir
  await fs.mkdir(path.dirname(packStickerPath), { recursive: true });

  // Copia o arquivo
  await fs.copyFile(stickerPath, packStickerPath);

  // Adiciona informações do sticker ao pack
  const stickerInfo = {
    fileName: stickerFileName,
    filePath: packStickerPath,
    addedAt: new Date().toISOString(),
    isAnimated: false,
    emojis: ['😊'],
    accessibilityLabel: `Sticker ${currentPack.stickers.length + 1}`,
    isLottie: false,
    mimetype: 'image/webp',
  };

  currentPack.stickers.push(stickerInfo);
  userData.totalStickers++;

  // Se o pack atingiu o limite, marca como completo
  if (currentPack.stickers.length >= STICKERS_PER_PACK) {
    currentPack.isComplete = true;

    // Define thumbnail (primeiro sticker do pack)
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

  // Remove arquivos físicos do pack
  try {
    const packDir = path.join(STICKER_PACKS_DIR, userId, `pack_${packIndex}`);
    await fs.rmdir(packDir, { recursive: true });
  } catch (error) {
    logger.warn(`[StickerPackManager] Erro ao remover diretório do pack: ${error.message}`);
  }

  // Remove o pack da lista
  userData.packs.splice(packIndex, 1);
  userData.totalStickers -= pack.stickers.length;

  // Reajusta índices dos packs restantes
  userData.packs.forEach((p, index) => {
    p.packIndex = index;
  });

  // Ajusta currentPackIndex se necessário
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
 * Gera pack de stickers no formato WhatsApp
 */
async function generateWhatsAppPack(userId, packIndex) {
  const pack = await getPackDetails(userId, packIndex);

  if (!pack || pack.stickers.length === 0) {
    return null;
  }

  // Gera estrutura do pack no formato WhatsApp
  const whatsappPack = {
    stickerPackId: pack.packId,
    name: pack.name,
    publisher: pack.author,
    stickers: pack.stickers.map((sticker) => ({
      fileName: sticker.fileName,
      isAnimated: sticker.isAnimated,
      emojis: sticker.emojis,
      accessibilityLabel: sticker.accessibilityLabel,
      isLottie: sticker.isLottie,
      mimetype: sticker.mimetype,
    })),
    fileLength: '0', // Será calculado durante o envio
    trayIconFileName: `${pack.packId}.png`,
    stickerPackSize: '0', // Será calculado durante o envio
    stickerPackOrigin: 'OMNIZAP',
  };

  return whatsappPack;
}

module.exports = {
  addStickerToPack,
  listUserPacks,
  getPackDetails,
  deletePack,
  renamePack,
  getUserStats,
  generateWhatsAppPack,
  getUserId,
  STICKERS_PER_PACK,
};
