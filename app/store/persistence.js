const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger/loggerModule');

const storePath = process.env.STORE_PATH || path.join(__dirname, '../connection/store');
const lockfilePath = path.join(storePath, 'write.lock');

async function acquireLock() {
  try {
    // Ensure the base store directory exists
    await fs.mkdir(storePath, { recursive: true });
    await fs.mkdir(lockfilePath);
    logger.info('Lock acquired.');
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') {
      logger.warn('Write operation already in progress. Waiting for lock release...');
      return false;
    }
    throw error;
  }
}

async function releaseLock() {
  try {
    await fs.rmdir(lockfilePath);
    logger.info('Lock released.');
  } catch (error) {
    logger.error('Error releasing lock:', error);
  }
}

async function readFromFile(dataType) {
  const filePath = path.join(storePath, `${dataType}.json`);
  try {
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
  }
}

async function writeToFile(dataType, data) {
  if (data === null || data === undefined) {
    logger.warn(`Attempted to write null or undefined data for ${dataType}. Aborting.`);
    return;
  }

  if (!(await acquireLock())) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return writeToFile(dataType, data);
  }

  const filePath = path.join(storePath, `${dataType}.json`);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.info(`Store for ${dataType} written to ${filePath}`);
  } catch (error) {
    logger.error(`Error writing store for ${dataType} to ${filePath}:`, error);
    throw error;
  } finally {
    await releaseLock();
  }
}

module.exports = { readFromFile, writeToFile };
