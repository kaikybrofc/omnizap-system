const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const lockfile = require('proper-lockfile');
const logger = require('../utils/logger/loggerModule');
const { Transform, pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);
const storePath = path.resolve(process.cwd(), process.env.STORE_PATH || './temp');

// Tamanho do chunk para streaming (64KB)
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
    // Verifica se o arquivo existe
    try {
      await fsp.access(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fsp.writeFile(filePath, '{}', { mode: 0o666 });
        logger.warn(`Arquivo ${dataType}.json não encontrado. Criando novo arquivo vazio.`);
        return {};
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
    }

    // Criando stream de transformação para processar chunks JSON
    let jsonBuffer = '';
    const jsonParser = new Transform({
      readableObjectMode: true,
      transform(chunk, encoding, callback) {
        try {
          jsonBuffer += chunk.toString();
          callback();
        } catch (err) {
          callback(err);
        }
      },
      flush(callback) {
        try {
          const parsedData = JSON.parse(jsonBuffer || '{}');
          if (typeof parsedData !== 'object' || parsedData === null) {
            callback(new Error(`Formato de dados inválido para ${dataType}. Esperava um objeto.`));
            return;
          }
          this.push(parsedData);
          callback();
        } catch (err) {
          callback(err);
        }
      },
    });

    const result = await new Promise((resolve, reject) => {
      const chunks = [];
      pipelineAsync(fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE }), jsonParser)
        .then(() => {
          const parsedData = chunks.length ? chunks[0] : {};
          resolve(parsedData);
        })
        .catch((err) => {
          logger.error(`Erro ao processar stream para ${dataType}:`, err);
          resolve({});
        });

      jsonParser.on('data', (chunk) => chunks.push(chunk));
    });

    logger.info(`Store para ${dataType} lido de ${filePath}`);
    return result;
  } catch (error) {
    logger.error(`Erro ao ler store para ${dataType} de ${filePath}:`, error);
    return {};
  } finally {
    try {
      // Só tenta desbloquear se o arquivo existir
      await fsp
        .access(filePath)
        .then(() => {
          return lockfile.unlock(filePath).catch(() => {
            // Ignora erros de unlock se o arquivo não estiver lockado
          });
        })
        .catch(() => {
          // Ignora erros se o arquivo não existir
        });
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

    // Cria um stream de transformação para chunking do JSON
    const jsonStringifier = new Transform({
      transform(chunk, encoding, callback) {
        try {
          const jsonChunk = JSON.stringify(chunk, null, 2);
          callback(null, jsonChunk);
        } catch (err) {
          callback(err);
        }
      },
    });

    // Cria uma Promise que resolverá quando o pipeline terminar
    await new Promise((resolve, reject) => {
      // Cria um stream de escrita
      const writeStream = fs.createWriteStream(filePath, {
        flags: 'w',
        encoding: 'utf8',
        highWaterMark: CHUNK_SIZE,
      });

      // Configura os handlers de evento
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      // Escreve os dados usando o pipeline
      jsonStringifier.pipe(writeStream);
      jsonStringifier.write(data);
      jsonStringifier.end();
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
