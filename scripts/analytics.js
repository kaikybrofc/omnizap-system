#!/usr/bin/env node

/**
 * OmniZap Analytics
 *
 * Ferramenta para análise de mensagens e eventos armazenados no banco de dados
 *
 * Uso: node scripts/analytics.js [--mensagens|--eventos|--grupos] [--dias=30]
 *
 * @version 1.0.0
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();
const { searchMessages, searchEvents, searchGroups } = require('../app/cache/cacheManager');
const logger = require('../app/utils/logger/loggerModule');

// Processar argumentos da linha de comando
const args = process.argv.slice(2);
const options = {
  tipo: 'mensagens', // padrão
  dias: 30, // padrão: últimos 30 dias
};

args.forEach((arg) => {
  if (arg === '--mensagens') options.tipo = 'mensagens';
  else if (arg === '--eventos') options.tipo = 'eventos';
  else if (arg === '--grupos') options.tipo = 'grupos';

  const diasMatch = arg.match(/--dias=(\d+)/);
  if (diasMatch) options.dias = parseInt(diasMatch[1], 10);
});

// Calcular data inicial com base nos dias especificados
const dataInicial = new Date();
dataInicial.setDate(dataInicial.getDate() - options.dias);

async function runAnalytics() {
  try {
    logger.info(`🔍 OmniZap Analytics: Analisando ${options.tipo} dos últimos ${options.dias} dias`);

    if (options.tipo === 'mensagens') {
      await analisarMensagens(dataInicial);
    } else if (options.tipo === 'eventos') {
      await analisarEventos(dataInicial);
    } else if (options.tipo === 'grupos') {
      await analisarGrupos();
    }

    logger.info('✅ Análise concluída!');
  } catch (error) {
    logger.error('❌ Erro ao executar análise:', {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    process.exit(0);
  }
}

async function analisarMensagens(dataInicial) {
  // Buscar mensagens no período especificado
  const mensagens = await searchMessages({
    startDate: dataInicial,
    limit: 10000, // Ajuste conforme necessário
  });

  logger.info(`Encontradas ${mensagens.length} mensagens no período.`);

  if (mensagens.length === 0) return;

  // Análise por tipo de mensagem
  const tiposMensagem = {};
  mensagens.forEach((msg) => {
    const tipo = msg._messageType || 'unknown';
    tiposMensagem[tipo] = (tiposMensagem[tipo] || 0) + 1;
  });

  logger.info('Análise por tipo de mensagem:');
  Object.entries(tiposMensagem)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tipo, quantidade]) => {
      logger.info(`- ${tipo}: ${quantidade} (${((quantidade / mensagens.length) * 100).toFixed(2)}%)`);
    });

  // Análise por contato/grupo
  const conversas = {};
  mensagens.forEach((msg) => {
    const jid = msg.key.remoteJid;
    conversas[jid] = (conversas[jid] || 0) + 1;
  });

  logger.info('Top 10 conversas mais ativas:');
  Object.entries(conversas)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([jid, quantidade], index) => {
      logger.info(`${index + 1}. ${jid}: ${quantidade} mensagens`);
    });

  // Análise por período do dia
  const periodosDia = {
    madrugada: 0, // 00:00 - 05:59
    manha: 0, // 06:00 - 11:59
    tarde: 0, // 12:00 - 17:59
    noite: 0, // 18:00 - 23:59
  };

  mensagens.forEach((msg) => {
    if (!msg.messageTimestamp) return;

    const data = new Date(msg.messageTimestamp * 1000);
    const hora = data.getHours();

    if (hora >= 0 && hora < 6) periodosDia.madrugada++;
    else if (hora >= 6 && hora < 12) periodosDia.manha++;
    else if (hora >= 12 && hora < 18) periodosDia.tarde++;
    else periodosDia.noite++;
  });

  logger.info('Distribuição de mensagens por período do dia:');
  Object.entries(periodosDia).forEach(([periodo, quantidade]) => {
    logger.info(`- ${periodo}: ${quantidade} (${((quantidade / mensagens.length) * 100).toFixed(2)}%)`);
  });
}

async function analisarEventos(dataInicial) {
  // Buscar eventos no período especificado
  const eventos = await searchEvents({
    startDate: dataInicial,
    limit: 5000, // Ajuste conforme necessário
  });

  logger.info(`Encontrados ${eventos.length} eventos no período.`);

  if (eventos.length === 0) return;

  // Análise por tipo de evento
  const tiposEvento = {};
  eventos.forEach((evento) => {
    const tipo = evento._eventType || 'unknown';
    tiposEvento[tipo] = (tiposEvento[tipo] || 0) + 1;
  });

  logger.info('Análise por tipo de evento:');
  Object.entries(tiposEvento)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tipo, quantidade]) => {
      logger.info(`- ${tipo}: ${quantidade} (${((quantidade / eventos.length) * 100).toFixed(2)}%)`);
    });

  // Análise temporal
  const eventosPorDia = {};
  eventos.forEach((evento) => {
    const data = new Date(evento._timestamp);
    const dataFormatada = `${data.getFullYear()}-${(data.getMonth() + 1).toString().padStart(2, '0')}-${data.getDate().toString().padStart(2, '0')}`;

    eventosPorDia[dataFormatada] = (eventosPorDia[dataFormatada] || 0) + 1;
  });

  logger.info('Distribuição de eventos por dia:');
  Object.entries(eventosPorDia)
    .sort()
    .forEach(([data, quantidade]) => {
      logger.info(`- ${data}: ${quantidade} eventos`);
    });
}

async function analisarGrupos() {
  // Buscar todos os grupos
  const grupos = await searchGroups({
    limit: 1000, // Ajuste conforme necessário
  });

  logger.info(`Encontrados ${grupos.length} grupos.`);

  if (grupos.length === 0) return;

  // Análise por tamanho dos grupos
  const tamanhoGrupos = {
    pequeno: 0, // 1-20 participantes
    medio: 0, // 21-100 participantes
    grande: 0, // 101-300 participantes
    enorme: 0, // >300 participantes
  };

  grupos.forEach((grupo) => {
    const participantes = grupo.participants?.length || 0;

    if (participantes <= 20) tamanhoGrupos.pequeno++;
    else if (participantes <= 100) tamanhoGrupos.medio++;
    else if (participantes <= 300) tamanhoGrupos.grande++;
    else tamanhoGrupos.enorme++;
  });

  logger.info('Distribuição de grupos por tamanho:');
  Object.entries(tamanhoGrupos).forEach(([tamanho, quantidade]) => {
    logger.info(`- ${tamanho}: ${quantidade} (${((quantidade / grupos.length) * 100).toFixed(2)}%)`);
  });

  // Top 10 grupos por quantidade de participantes
  logger.info('Top 10 grupos por número de participantes:');
  grupos
    .sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0))
    .slice(0, 10)
    .forEach((grupo, index) => {
      logger.info(`${index + 1}. ${grupo.subject || 'Sem nome'}: ${grupo.participants?.length || 0} participantes`);
    });
}

// Executar análise
runAnalytics();
