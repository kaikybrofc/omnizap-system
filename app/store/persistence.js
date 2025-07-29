const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const lockfile = require('proper-lockfile');
const logger = require('../utils/logger/loggerModule');

const storePath = path.resolve(process.cwd(), process.env.STORE_PATH || './temp');
const CHUNK_SIZE = 64 * 1024;

async function ensureStoreDirectory() {
  try {
    await fsp.mkdir(storePath, { recursive: true, mode: 0o777 });
    logger.info(`Diretório de armazenamento garantido: '${storePath}'`);
  } catch (error) {
    logger.error(`Erro ao criar diretório de armazenamento: ${error.message}`);
    throw error;
  }
}

async function readFromFile(dataType, expectedType = 'object') {
  await ensureStoreDirectory();
  const filePath = path.join(storePath, `${dataType}.json`);

  try {
    await fsp.access(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const emptyContent = expectedType === 'array' ? '[]' : '{}';
      await fsp.writeFile(filePath, emptyContent, { mode: 0o666 });
      logger.warn(`Arquivo ${dataType}.json não encontrado. Criando novo arquivo vazio.`);
      return expectedType === 'array' ? [] : {};
    } else {
      logger.error(`Erro ao acessar o arquivo ${filePath}: ${error.message}`);
      throw error;
    }
  }

  try {
    const fileContent = await fsp.readFile(filePath, 'utf8');
    if (!fileContent.trim()) {
      return expectedType === 'array' ? [] : {};
    }
    const data = JSON.parse(fileContent);
    logger.info(`Store para ${dataType} lido de ${filePath}`);
    return data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.warn(`Arquivo JSON malformado para ${dataType}: ${filePath}.`);
      return expectedType === 'array' ? [] : {};
    }
    logger.error(`Erro ao ler ou analisar o arquivo ${filePath}: ${error.message}`);
    throw error;
  }
}

async function writeToFile(dataType, data) {
  if (data === null || data === undefined) {
    logger.warn(`Attempted to write null or undefined data for ${dataType}. Aborting.`);
    return;
  }

  const filePath = path.join(storePath, `${dataType}.json`);
  let releaseLock = null;

  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    try {
      releaseLock = await lockfile.lock(filePath, {
        retries: { retries: 5, factor: 1, minTimeout: 200 },
        onCompromised: (err) => {
          logger.error('Lock file compromised:', err);
          throw err;
        },
      });
    } catch (lockError) {
      logger.error(`Não foi possível obter lock para ${dataType}.json: ${lockError.message}`);
      throw lockError;
    }

    const jsonString = JSON.stringify(data, null, 2);

    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath, {
        flags: 'w',
        encoding: 'utf8',
        highWaterMark: CHUNK_SIZE,
      });

      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      writeStream.write(jsonString);
      writeStream.end();
    });

    logger.info(`Store para ${dataType} escrito em ${filePath}`);
  } catch (error) {
    logger.error(`Erro ao escrever store para ${dataType} em ${filePath}:`, error);
    throw error;
  } finally {
    if (releaseLock) {
      try {
        await releaseLock();
      } catch (unlockError) {
        logger.warn(`Erro ao liberar lock de ${dataType}.json: ${unlockError.message}`);
      }
    }
  }
}

module.exports = { readFromFile, writeToFile };
