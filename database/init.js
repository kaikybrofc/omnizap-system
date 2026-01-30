import mysql from 'mysql2/promise';
import logger from '../app/utils/logger/loggerModule.js';
import { dbConfig, TABLES } from './index.js';
import { fileURLToPath } from 'node:url';

/**
 * Nome do banco de dados que será criado ou validado.
 * Já vem resolvido com sufixo _dev ou _prod via dbConfig.
 * @type {string}
 */
const dbToCreate = dbConfig.database;

/**
 * SQL para criar o banco de dados caso ainda não exista.
 * Usa:
 * - utf8mb4: suporte total a emojis e caracteres unicode
 * - utf8mb4_unicode_ci: collation consistente para buscas
 */
const createDatabaseSQL = `
  CREATE DATABASE IF NOT EXISTS \`${dbToCreate}\`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
`;

/**
 * Tabela MESSAGES
 * Armazena todas as mensagens processadas pelo sistema.
 *
 * Campos importantes:
 * - message_id: ID global do WhatsApp (único)
 * - chat_id: conversa (grupo ou privado)
 * - sender_id: remetente da mensagem
 * - content: texto extraído
 * - raw_message: JSON original da Baileys
 * - timestamp: timestamp da mensagem no WhatsApp
 *
 * Índices:
 * - chat_id + timestamp → leitura de histórico por conversa
 * - sender_id → estatísticas por usuário
 * - timestamp → ordenação global
 */
const createMessagesTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.MESSAGES} (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    chat_id VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255),
    content TEXT,
    raw_message JSON,
    timestamp TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chat_timestamp (chat_id, timestamp),
    INDEX idx_sender (sender_id),
    INDEX idx_timestamp (timestamp)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Tabela CHATS
 * Representa uma conversa (grupo ou privado).
 *
 * - id → JID do WhatsApp
 * - name → nome do grupo ou contato
 * - raw_chat → JSON bruto retornado pela Baileys
 */
const createChatsTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.CHATS} (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    name VARCHAR(255),
    raw_chat JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Tabela GROUPS_METADATA
 * Armazena informações normalizadas de grupos.
 *
 * Usada para:
 * - admin commands
 * - estatísticas
 * - sincronização de participantes
 *
 * participants é JSON para armazenar:
 * [{ jid, lid, admin }, ...]
 */
const createGroupsMetadataTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.GROUPS_METADATA} (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    subject VARCHAR(255),
    description TEXT,
    owner_jid VARCHAR(255),
    creation BIGINT,
    participants JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Tabela GROUP_CONFIGS
 * Configurações específicas por grupo.
 *
 * Exemplo:
 * - prefixo de comandos
 * - anti-link
 * - modo restrito
 */
const createGroupConfigsTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.GROUP_CONFIGS} (
    id VARCHAR(255) PRIMARY KEY NOT NULL,
    config JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Tabela LID_MAP
 * Mapeia IDs temporários do WhatsApp (LID) para JIDs reais.
 *
 * Isso resolve problemas de:
 * - mensagens vindo com "xxx@lid"
 * - alternância entre lid e s.whatsapp.net
 *
 * Campos:
 * - lid → chave primária
 * - jid → jid real associado
 * - first_seen → quando apareceu
 * - last_seen → última vez visto
 * - source → origem do dado (message, group, etc)
 */
const createLidMapTableSQL = `
  CREATE TABLE IF NOT EXISTS ${TABLES.LID_MAP} (
    lid VARCHAR(64) PRIMARY KEY,
    jid VARCHAR(64) NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    source VARCHAR(32),
    INDEX idx_lid_map_jid (jid),
    INDEX idx_lid_map_last_seen (last_seen)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Inicializa o banco de dados:
 * 1) Conecta ao MySQL sem database
 * 2) Cria o banco se não existir
 * 3) Muda para o database correto
 * 4) Cria todas as tabelas
 * 5) Encerra a conexão
 *
 * Este script é idempotente:
 * pode ser rodado várias vezes sem quebrar nada.
 *
 * @returns {Promise<void>}
 */
export default async function initializeDatabase() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    // Cria/verifica o banco
    await connection.query(createDatabaseSQL);
    logger.info(`Banco de dados '${dbToCreate}' verificado/criado com sucesso.`);

    // Seleciona o banco recém-criado
    await connection.changeUser({ database: dbToCreate });

    // Cria todas as tabelas em paralelo
    await Promise.all([
      connection.query(createMessagesTableSQL),
      connection.query(createChatsTableSQL),
      connection.query(createGroupsMetadataTableSQL),
      connection.query(createGroupConfigsTableSQL),
      connection.query(createLidMapTableSQL),
    ]);

    logger.info('Todas as tabelas foram verificadas/criadas com sucesso.');
  } catch (error) {
    logger.error(`Erro ao inicializar o banco: ${error.code || ''} ${error.message}`);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      logger.info('Conexão com o MySQL encerrada após inicialização.');
    }
  }
}

/**
 * Permite que este arquivo seja executado diretamente:
 * node database/init.js
 */
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  initializeDatabase();
}
