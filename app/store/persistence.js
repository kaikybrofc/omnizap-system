const fs = require('fs').promises;
const path = require('path');
const lockfile = require('proper-lockfile');
const logger = require('../utils/logger/loggerModule');

const storePath = process.env.STORE_PATH || path.join(__dirname, '../connection/store');

async function readFromFile(dataType) {
  const filePath = path.join(storePath, `${dataType}.json`);
  try {
    await lockfile.lock(storePath, { 
      retries: { retries: 5, factor: 1, minTimeout: 200 },
      onCompromised: (err) => {
        logger.error('Lock file compromised:', err);
        throw err;
      }
    });
    const data = await fs.readFile(filePath, 'utf8');
    logger.info(`Store for ${dataType} read from ${filePath}`);
    try {
      const parsedData = JSON.parse(data);
      if (typeof parsedData !== 'object' || parsedData === null) {
        logger.warn(`Invalid data format for ${dataType}. Expected an object.`);
        return null;
      }
      return parsedData;
    } catch (parseError) {
      logger.error(`Error parsing JSON for ${dataType} from ${filePath}:`, parseError);
      return null;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn(`Store file for ${dataType} not found at ${filePath}. Starting with empty data.`);
      return null;
    } else {
      logger.error(`Error reading store for ${dataType} from ${filePath}:`, error);
      throw error;
    }
  } finally {
    await lockfile.unlock(storePath);
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
    await lockfile.lock(storePath, { 
      retries: { retries: 5, factor: 1, minTimeout: 200 },
      onCompromised: (err) => {
        logger.error('Lock file compromised:', err);
        throw err;
      }
    });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.info(`Store for ${dataType} written to ${filePath}`);
  } catch (error) {
    logger.error(`Error writing store for ${dataType} to ${filePath}:`, error);
    throw error;
  } finally {
    await lockfile.unlock(storePath);
  }
}

module.exports = { readFromFile, writeToFile };
