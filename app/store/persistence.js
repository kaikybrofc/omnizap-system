const fs = require('fs').promises;
const path = require('path');
const lockfile = require('proper-lockfile');
const logger = require('../utils/logger/loggerModule');

const storePath = path.resolve(process.cwd(), process.env.STORE_PATH || './temp');

async function ensureStoreDirectory() {
  try {
    await fs.mkdir(storePath, { recursive: true, mode: 0o777 });
    logger.info(`Diretório de armazenamento garantido: '${storePath}'`);
  } catch (error) {
    logger.error(`Erro ao criar diretório de armazenamento: ${error.message}`);
    throw error;
  }
}

async function readFromFile(dataType) {
  await ensureStoreDirectory();
  const filePath = path.join(storePath, `${dataType}.json`);

  try {
    // Verifica se o arquivo existe
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Se o arquivo não existe, cria um vazio
        await fs.writeFile(filePath, '{}', { mode: 0o666 });
        logger.warn(`Arquivo ${dataType}.json não encontrado. Criando novo arquivo vazio.`);
      }
    }

    // Tenta obter o lock
    try {
      await lockfile.lock(filePath, {
        retries: { retries: 5, factor: 1, minTimeout: 200 },
        onCompromised: (err) => {
          logger.error('Lock file compromised:', err);
        },
      });
    } catch (lockError) {
      logger.warn(`Não foi possível obter lock para ${dataType}.json: ${lockError.message}`);
      // Continua mesmo sem o lock neste caso
    }

    const data = await fs.readFile(filePath, 'utf8');
    logger.info(`Store para ${dataType} lido de ${filePath}`);

    try {
      const parsedData = JSON.parse(data || '{}');
      if (typeof parsedData !== 'object' || parsedData === null) {
        logger.warn(`Formato de dados inválido para ${dataType}. Esperava um objeto.`);
        return {};
      }
      return parsedData;
    } catch (parseError) {
      logger.error(`Erro ao fazer parse do JSON para ${dataType} de ${filePath}:`, parseError);
      return {};
    }
  } catch (error) {
    logger.error(`Erro ao ler store para ${dataType} de ${filePath}:`, error);
    return {};
  } finally {
    try {
      await lockfile.unlock(filePath).catch(() => {});
    } catch (unlockError) {
      logger.warn(`Erro ao liberar lock de ${dataType}.json: ${unlockError.message}`);
    }
  }
}

async function writeToFile(dataType, data) {
  if (data === null || data === undefined) {
    logger.warn(`Attempted to write null or undefined data for ${dataType}. Aborting.`);
    return;
  }

  const filePath = path.join(storePath, `${dataType}.json`);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await lockfile.lock(filePath, {
      retries: { retries: 5, factor: 1, minTimeout: 200 },
      onCompromised: (err) => {
        logger.error('Lock file compromised:', err);
        throw err;
      },
    });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.info(`Store for ${dataType} written to ${filePath}`);
  } catch (error) {
    logger.error(`Error writing store for ${dataType} to ${filePath}:`, error);
    throw error;
  } finally {
    await lockfile.unlock(filePath);
  }
}

module.exports = { readFromFile, writeToFile };
