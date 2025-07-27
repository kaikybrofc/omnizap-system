const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const lockfile = require('proper-lockfile');
const logger = require('../utils/logger/loggerModule');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { parser } = require('stream-json');
const { streamObject } = require('stream-json/streamers/StreamObject');

const pipelineAsync = promisify(pipeline);
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

async function readFromFile(dataType) {
  await ensureStoreDirectory();
  const filePath = path.join(storePath, `${dataType}.json`);

  try {
    await fsp.access(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fsp.writeFile(filePath, '{}', { mode: 0o666 });
      logger.warn(`Arquivo ${dataType}.json não encontrado. Criando novo arquivo vazio.`);
      return {};
    }
    logger.error(`Erro ao acessar o arquivo ${filePath}: ${error.message}`);
    return {};
  }

  let locked = false;
  try {
    await lockfile.lock(filePath, {
      retries: { retries: 5, factor: 1, minTimeout: 200 },
      onCompromised: (err) => {
        logger.error('Lock file compromised:', err);
      },
    });
    locked = true;
  } catch (lockError) {
    logger.warn(
      `Não foi possível obter lock para ${dataType}.json: ${lockError.message}. Lendo sem lock.`,
    );
  }

  return new Promise((resolve, reject) => {
    const data = {};
    const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
    const jsonParser = parser();
    const objectStream = streamObject();

    const streamPipeline = pipeline(stream, jsonParser, objectStream, async (err) => {
      if (locked) {
        try {
          await lockfile.unlock(filePath);
        } catch (unlockError) {
          logger.warn(`Erro ao liberar lock de ${dataType}.json: ${unlockError.message}`);
        }
      }
      if (err) {
        if (err.message.includes('JSON')) {
          logger.warn(
            `Arquivo JSON malformado ou vazio para ${dataType}: ${filePath}. Retornando objeto vazio.`,
          );
          resolve({});
        } else {
          logger.error(`Erro no pipeline de stream para ${dataType}:`, err);
          resolve({});
        }
      } else {
        logger.info(`Store para ${dataType} lido de ${filePath}`);
        resolve(data);
      }
    });

    objectStream.on('data', ({ key, value }) => {
      data[key] = value;
    });

    objectStream.on('error', (err) => {
      logger.error(`Erro ao processar objeto do stream para ${dataType}:`, err);
    });

    stream.on('error', (err) => {
      logger.error(`Erro na stream de leitura para ${dataType}:`, err);
    });
  });
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

    // Obtém o lock do arquivo
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

    // Cria uma Promise que resolverá quando a escrita terminar
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath, {
        flags: 'w',
        encoding: 'utf8',
        highWaterMark: CHUNK_SIZE,
      });

      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      // Escreve a string JSON no stream
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
