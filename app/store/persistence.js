// Importações de módulos nativos e de terceiros.
const fs = require('fs'); // Módulo File System do Node.js para operações de arquivo.
const fsp = fs.promises; // Versão baseada em Promises do módulo fs para operações assíncronas.
const path = require('path'); // Módulo para lidar com caminhos de arquivos e diretórios.
const lockfile = require('proper-lockfile'); // Biblioteca para garantir operações de arquivo atômicas, prevenindo condições de corrida.
const { mergeWith, isArray, unionBy } = require('lodash'); // Funções utilitárias da biblioteca lodash para manipulação de objetos e arrays.
const logger = require('../utils/logger/loggerModule'); // Módulo de logging customizado para registrar eventos e erros.

// Define o caminho para o diretório de armazenamento, com base na variável de ambiente ou um padrão.
const storePath = path.resolve(process.cwd(), process.env.STORE_PATH || './temp');
// Define o tamanho do chunk para escrita de arquivos, otimizando o uso de memória.
const CHUNK_SIZE = 64 * 1024; // 64KB

/**
 * Garante que o diretório de armazenamento exista.
 * Cria o diretório recursivamente se não existir.
 */
async function ensureStoreDirectory() {
  try {
    // Cria o diretório com permissões de leitura, escrita e execução.
    await fsp.mkdir(storePath, { recursive: true, mode: 0o777 });
    logger.debug(`Diretório de armazenamento garantido: '${storePath}'`);
  } catch (error) {
    logger.error('Erro ao criar diretório de armazenamento:', error);
    throw error; // Propaga o erro para ser tratado pelo chamador.
  }
}

/**
 * Lê dados de um arquivo JSON de forma segura.
 * @param {string} dataType - O tipo de dado, usado para nomear o arquivo (ex: 'users', 'products').
 * @param {string} [expectedType='object'] - O tipo de dado esperado ('object' ou 'array').
 * @returns {Promise<object|Array>} - Os dados lidos do arquivo.
 */
async function readFromFile(dataType, expectedType = 'object') {
  await ensureStoreDirectory(); // Garante que o diretório de armazenamento exista.
  const filePath = path.join(storePath, `${dataType}.json`); // Constrói o caminho completo do arquivo.

  try {
    // Verifica se o arquivo existe.
    await fsp.access(filePath);
  } catch (error) {
    // Se o arquivo não existir, cria um novo com conteúdo vazio apropriado.
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
    // Lê o conteúdo do arquivo.
    const fileContent = await fsp.readFile(filePath, 'utf8');
    // Se o arquivo estiver vazio, retorna o tipo esperado vazio.
    if (!fileContent.trim()) {
      return expectedType === 'array' ? [] : {};
    }
    // Analisa o conteúdo JSON e retorna os dados.
    const data = JSON.parse(fileContent);
    logger.info(`Store para ${dataType} lido de ${filePath}`);
    return data;
  } catch (error) {
    // Trata erros de sintaxe no JSON, retornando um tipo vazio para evitar quebras.
    if (error instanceof SyntaxError) {
      logger.warn(`Arquivo JSON malformado para ${dataType}: ${filePath}.`);
      return expectedType === 'array' ? [] : {};
    }
    logger.error(`Erro ao ler ou analisar o arquivo ${filePath}: ${error.message}`);
    throw error;
  }
}

/**
 * Escreve dados em um arquivo JSON, garantindo a atomicidade e consistência.
 * @param {string} dataType - O tipo de dado, usado para nomear o arquivo.
 * @param {object|Array} data - Os dados a serem escritos no arquivo.
 */
async function writeToFile(dataType, data) {
  // Previne a escrita de dados nulos ou indefinidos.
  if (data === null || data === undefined) {
    logger.warn(`Tentativa de escrever dados nulos ou indefinidos para ${dataType}. Abortando.`);
    return;
  }

  const filePath = path.join(storePath, `${dataType}.json`);
  let releaseLock = null; // Função para liberar o lock do arquivo.

  try {
    // Garante que o diretório do arquivo exista.
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    // Adquire um lock no arquivo para evitar escritas concorrentes.
    try {
      releaseLock = await lockfile.lock(filePath, {
        retries: { retries: 5, factor: 1, minTimeout: 200 }, // Tenta adquirir o lock 5 vezes.
        onCompromised: (err) => {
          logger.error('Lock do arquivo comprometido:', err);
          throw err;
        },
      });
    } catch (lockError) {
      logger.error(`Não foi possível obter lock para ${dataType}.json: ${lockError.message}`);
      throw lockError;
    }

    // Tenta ler os dados existentes para mesclá-los com os novos dados.
    let finalData = data;
    try {
      const existingData = await readFromFile(dataType, Array.isArray(data) ? 'array' : 'object');
      if (existingData) {
        // Mescla os dados, com lógica customizada para arrays (união por 'id').
        finalData = mergeWith({}, existingData, data, (objValue, srcValue) => {
          if (isArray(objValue) && isArray(srcValue)) {
            return unionBy(objValue, srcValue, 'id'); // Evita duplicatas em arrays de objetos.
          }
        });
      }
    } catch (readError) {
      logger.warn(
        `Não foi possível ler os dados existentes para ${dataType} antes de escrever. Continuando com os novos dados. Erro: ${readError.message}`,
      );
    }

    // Converte os dados finais para uma string JSON formatada.
    const jsonString = JSON.stringify(finalData, null, 2);

    // Escreve os dados no arquivo usando um stream para otimizar a performance.
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath, {
        flags: 'w', // 'w' para sobrescrever o arquivo existente.
        encoding: 'utf8',
        highWaterMark: CHUNK_SIZE, // Define o buffer do stream.
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
    // Garante que o lock seja liberado, mesmo se ocorrer um erro.
    if (releaseLock) {
      try {
        await releaseLock();
      } catch (unlockError) {
        logger.warn(`Erro ao liberar lock de ${dataType}.json: ${unlockError.message}`);
      }
    }
  }
}

// Exporta as funções para serem utilizadas em outras partes da aplicação.
module.exports = { readFromFile, writeToFile };
