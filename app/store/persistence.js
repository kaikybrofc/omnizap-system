const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger/loggerModule');

const storePath = path.join(__dirname, '../connection/store');

async function readFromFile(dataType) {
  const filePath = path.join(storePath, `${dataType}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    logger.info(`Store for ${dataType} read from ${filePath}`);
    return JSON.parse(data);
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
  const filePath = path.join(storePath, `${dataType}.json`);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.info(`Store for ${dataType} written to ${filePath}`);
  } catch (error) {
    logger.error(`Error writing store for ${dataType} to ${filePath}:`, error);
    throw error;
  }
}

module.exports = { readFromFile, writeToFile };
