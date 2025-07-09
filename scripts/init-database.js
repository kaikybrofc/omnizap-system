#!/usr/bin/env node

/**
 * Script para inicializar o banco de dados MySQL
 *
 * Este script cria o banco de dados e todas as tabelas necessárias
 * para o funcionamento do sistema OmniZap.
 *
 * Uso: node scripts/init-database.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const logger = require('../app/utils/logger/loggerModule');
const { cleanEnv, str, num } = require('envalid');

// Validar variáveis de ambiente
const env = cleanEnv(process.env, {
  DB_HOST: str({ default: 'localhost' }),
  DB_USER: str({ default: 'root' }),
  DB_PASSWORD: str({ default: '' }),
  DB_NAME: str({ default: 'omnizap_cache' }),
  DB_PORT: num({ default: 3306 }),
});

async function initializeDatabase() {
  let connection;

  try {
    logger.info('Iniciando configuração do banco de dados...');

    // Criar conexão sem especificar o banco de dados
    connection = await mysql.createConnection({
      host: env.DB_HOST,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      port: env.DB_PORT,
    });

    // Criar o banco de dados se não existir
    logger.info(`Criando banco de dados '${env.DB_NAME}' se não existir...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // Usar o banco de dados
    await connection.query(`USE \`${env.DB_NAME}\``);

    // Criar tabelas
    logger.info('Criando tabela de mensagens...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(255) PRIMARY KEY,
        remote_jid VARCHAR(255) NOT NULL,
        from_me BOOLEAN DEFAULT FALSE,
        push_name VARCHAR(255),
        timestamp BIGINT,
        message_type VARCHAR(50),
        message_text TEXT,
        participant VARCHAR(255),
        quoted_message_id VARCHAR(255),
        raw_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_remote_jid (remote_jid),
        INDEX idx_timestamp (timestamp),
        INDEX idx_message_type (message_type),
        INDEX idx_participant (participant)
      )
    `);

    logger.info('Criando tabela de eventos...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(255) PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        event_id VARCHAR(255),
        event_timestamp BIGINT,
        event_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_event_type (event_type),
        INDEX idx_event_timestamp (event_timestamp)
      )
    `);

    logger.info('Criando tabela de grupos...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`groups\` (
        jid VARCHAR(255) PRIMARY KEY,
        subject VARCHAR(255),
        creation_timestamp BIGINT,
        owner VARCHAR(255),
        description TEXT,
        participant_count INT DEFAULT 0,
        metadata JSON,
        last_updated BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_subject (subject),
        INDEX idx_creation_timestamp (creation_timestamp),
        INDEX idx_last_updated (last_updated)
      )
    `);

    logger.info('Criando tabela de participantes de grupos...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_jid VARCHAR(255) NOT NULL,
        participant_jid VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        is_super_admin BOOLEAN DEFAULT FALSE,
        joined_timestamp BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_participant (group_jid, participant_jid),
        INDEX idx_group_jid (group_jid),
        INDEX idx_participant_jid (participant_jid),
        FOREIGN KEY (group_jid) REFERENCES \`groups\`(jid) ON DELETE CASCADE
      )
    `);

    logger.info('Criando tabela de contatos...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        jid VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        notify VARCHAR(255),
        verify VARCHAR(255),
        short_name VARCHAR(255),
        push_name VARCHAR(255),
        status TEXT,
        profile_picture_url TEXT,
        is_business BOOLEAN DEFAULT FALSE,
        is_enterprise BOOLEAN DEFAULT FALSE,
        metadata JSON,
        last_updated BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_push_name (push_name)
      )
    `);

    logger.info('Criando tabela de chats...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chats (
        jid VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        unread_count INT DEFAULT 0,
        timestamp BIGINT,
        archived BOOLEAN DEFAULT FALSE,
        pinned BOOLEAN DEFAULT FALSE,
        is_muted BOOLEAN DEFAULT FALSE,
        is_group BOOLEAN DEFAULT FALSE,
        metadata JSON,
        last_updated BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_timestamp (timestamp),
        INDEX idx_archived (archived),
        INDEX idx_is_group (is_group)
      )
    `);

    logger.info('✅ Banco de dados e tabelas criados com sucesso!');

    // Mostrar informações das tabelas
    logger.info('Tabelas disponíveis:');
    const [tables] = await connection.query('SHOW TABLES');

    tables.forEach((table) => {
      const tableName = Object.values(table)[0];
      logger.info(`- ${tableName}`);
    });

    logger.info('Configuração do banco de dados concluída.');
  } catch (error) {
    logger.error('❌ Erro ao configurar banco de dados:', {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    if (connection) {
      await connection.end();
    }
    process.exit(0);
  }
}

// Executar o script
initializeDatabase();
