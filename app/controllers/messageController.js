/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 1.0.1
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();

// Importar os novos módulos
const { cacheManager } = require('../cache/cacheManager');
const { eventHandler } = require('../events/eventHandler');

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

/**
 * Processador de mensagens WhatsApp do OmniZap
 *
 * Processa todas as mensagens recebidas através da conexão WhatsApp,
 * aplicando filtros, validações e executando as ações correspondentes
 *
 * @param {Object} messageUpdate - Objeto contendo as mensagens recebidas
 * @param {Object} omniZapClient - Cliente WhatsApp ativo para interação
 * @param {String} qrCodePath - Caminho para o QR Code se necessário
 * @returns {Promise<void>}
 */
const OmniZapMessageProcessor = async (messageUpdate, omniZapClient, qrCodePath) => {
  try {
    for (const messageInfo of messageUpdate?.messages || []) {
      const senderJid = messageInfo.key.remoteJid;

      if (!messageInfo.message) {
        console.log('OmniZap: Mensagem sem conteúdo ignorada');
        continue;
      }

      if (messageUpdate.type === 'append') {
        console.log('OmniZap: Mensagem histórica ignorada');
        continue;
      }

      if (messageInfo.key.fromMe) {
        console.log('OmniZap: Mensagem própria ignorada');
        continue;
      }

      console.log(`OmniZap: Processando mensagem de ${senderJid}`);

      await processOmniZapMessage(messageInfo, omniZapClient, qrCodePath);
    }
  } catch (error) {
    handleOmniZapError(error);
  }
};

/**
 * Processa uma mensagem individual do OmniZap
 *
 * @param {Object} messageInfo - Informações da mensagem
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @param {String} qrCodePath - Caminho do QR Code
 * @returns {Promise<void>}
 */
const processOmniZapMessage = async (messageInfo, omniZapClient, qrCodePath) => {
  try {
    const messageContent = messageInfo.message;
    const senderJid = messageInfo.key.remoteJid;
    const messageId = messageInfo.key.id;

    console.log(`OmniZap: Nova mensagem [${messageId}] de ${senderJid}`);

    const messageText = extractMessageText(messageContent);

    if (!messageText) {
      console.log('OmniZap: Mensagem sem texto ignorada');
      return;
    }

    if (messageText.startsWith(COMMAND_PREFIX)) {
      await processOmniZapCommand(messageText, messageInfo, omniZapClient);
    } else {
      console.log('OmniZap: Mensagem normal processada (sem comando)');
    }
  } catch (error) {
    console.error(`OmniZap: Erro ao processar mensagem individual:`, error);
  }
};

/**
 * Extrai o texto de diferentes tipos de mensagem
 *
 * @param {Object} messageContent - Conteúdo da mensagem
 * @returns {String|null} - Texto extraído ou null
 */
const extractMessageText = (messageContent) => {
  if (messageContent.conversation) {
    return messageContent.conversation;
  }

  if (messageContent.extendedTextMessage?.text) {
    return messageContent.extendedTextMessage.text;
  }

  if (messageContent.imageMessage?.caption) {
    return messageContent.imageMessage.caption;
  }

  if (messageContent.videoMessage?.caption) {
    return messageContent.videoMessage.caption;
  }

  return null;
};

/**
 * Processa comandos do OmniZap baseado em switch case
 *
 * @param {String} messageText - Texto da mensagem
 * @param {Object} messageInfo - Informações da mensagem
 * @param {Object} omniZapClient - Cliente WhatsApp
 * @returns {Promise<void>}
 */
const processOmniZapCommand = async (messageText, messageInfo, omniZapClient) => {
  try {
    const commandText = messageText.slice(COMMAND_PREFIX.length).trim();
    const [command, ...args] = commandText.split(' ');
    const senderJid = messageInfo.key.remoteJid;

    console.log(`OmniZap: Comando detectado: ${command} com argumentos:`, args);

    switch (command.toLowerCase()) {
      case 'help':
      case 'ajuda':
        await sendHelpMessage(omniZapClient, senderJid);
        break;

      case 'status':
        await sendStatusMessage(omniZapClient, senderJid);
        break;

      case 'cache':
        await sendCacheDetailsMessage(omniZapClient, senderJid);
        break;

      default:
        await sendUnknownCommandMessage(omniZapClient, senderJid, command);
        break;
    }
  } catch (error) {
    console.error('OmniZap: Erro ao processar comando:', error);
    await sendErrorMessage(omniZapClient, messageInfo.key.remoteJid);
  }
};

/**
 * Envia mensagem de ajuda com todos os comandos disponíveis
 */
const sendHelpMessage = async (omniZapClient, senderJid) => {
  try {
    const helpText = `🤖 *OmniZap - Central de Ajuda*

📋 *COMANDOS DISPONÍVEIS:*

${COMMAND_PREFIX}*help* ou ${COMMAND_PREFIX}*ajuda*
• Mostra esta mensagem de ajuda

${COMMAND_PREFIX}*status*
• Exibe status completo do sistema
• Informações de cache, memória e arquitetura

${COMMAND_PREFIX}*cache*
• Detalhes avançados do sistema de cache
• Estatísticas de hits/misses por módulo
• Informações de TTL (tempo de vida)

━━━━━━━━━━━━━━━━━━━━━

🏗️ *ARQUITETURA MODULAR:*
• Socket Controller - Gerencia conexões
• Cache Manager - Sistema de cache avançado
• Event Handler - Processamento de eventos
• Message Controller - Lógica de negócios

⚡ *OmniZap v1.0.1*
🔧 Sistema Profissional de Automação WhatsApp`;

    await omniZapClient.sendMessage(senderJid, { text: helpText });
    console.log(`OmniZap: Ajuda enviada para ${senderJid}`);
  } catch (error) {
    console.error('OmniZap: Erro ao enviar ajuda:', error);
    await omniZapClient.sendMessage(senderJid, {
      text: '❌ *Erro interno*\n\nOcorreu um erro ao exibir a ajuda.',
    });
  }
};

/**
 * Envia mensagem com status detalhado do sistema OmniZap
 */
const sendStatusMessage = async (omniZapClient, senderJid) => {
  try {
    const stats = cacheManager.getStats();

    if (!stats) {
      await omniZapClient.sendMessage(senderJid, {
        text: '❌ *Erro ao obter estatísticas*\n\nNão foi possível recuperar os dados do sistema.',
      });
      return;
    }

    // Obter informações do sistema
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const currentDate = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Formatação de tempo de atividade
    const formatUptime = (seconds) => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      return `${days}d ${hours}h ${minutes}m ${secs}s`;
    };

    // Formatação de memória
    const formatMemory = (bytes) => {
      const mb = (bytes / 1024 / 1024).toFixed(2);
      return `${mb} MB`;
    };

    // Formatação de taxa de acerto
    const formatHitRate = (rate) => {
      const numRate = parseFloat(rate);
      if (numRate >= 80) return `🟢 ${rate}%`;
      if (numRate >= 60) return `🟡 ${rate}%`;
      return `🔴 ${rate}%`;
    };

    const statusText = `🚀 *OmniZap - Status do Sistema*

📊 *ESTATÍSTICAS GERAIS*
• ⏰ Data/Hora: ${currentDate}
• 🔄 Tempo Ativo: ${formatUptime(uptime)}
• 🗝️ Total de Chaves: ${stats.totals.allKeys.toLocaleString()}
• ✅ Total Hits: ${stats.totals.allHits.toLocaleString()}
• ❌ Total Misses: ${stats.totals.allMisses.toLocaleString()}
• 📈 Taxa Geral: ${formatHitRate(
      stats.totals.allHits > 0
        ? ((stats.totals.allHits / (stats.totals.allHits + stats.totals.allMisses)) * 100).toFixed(
            2,
          )
        : '0',
    )}

💬 *CACHE DE MENSAGENS*
• 📨 Total Chaves: ${stats.messages.keys.toLocaleString()}
• ✅ Hits: ${stats.messages.hits.toLocaleString()}
• ❌ Misses: ${stats.messages.misses.toLocaleString()}
• 📈 Taxa Acerto: ${formatHitRate(stats.messages.hitRate)}

🔄 *CACHE DE EVENTOS*
• 🎯 Total Chaves: ${stats.events.keys.toLocaleString()}
• ✅ Hits: ${stats.events.hits.toLocaleString()}
• ❌ Misses: ${stats.events.misses.toLocaleString()}
• 📈 Taxa Acerto: ${formatHitRate(stats.events.hitRate)}`;

    const statusText2 = `

👥 *CACHE DE GRUPOS*
• 🏷️ Total Chaves: ${stats.groups.keys.toLocaleString()}
• ✅ Hits: ${stats.groups.hits.toLocaleString()}
• ❌ Misses: ${stats.groups.misses.toLocaleString()}
• 📈 Taxa Acerto: ${formatHitRate(stats.groups.hitRate)}

👤 *CACHE DE CONTATOS*
• 📇 Total Chaves: ${stats.contacts.keys.toLocaleString()}
• ✅ Hits: ${stats.contacts.hits.toLocaleString()}
• ❌ Misses: ${stats.contacts.misses.toLocaleString()}
• 📈 Taxa Acerto: ${formatHitRate(stats.contacts.hitRate)}

💬 *CACHE DE CHATS*
• 💭 Total Chaves: ${stats.chats.keys.toLocaleString()}
• ✅ Hits: ${stats.chats.hits.toLocaleString()}
• ❌ Misses: ${stats.chats.misses.toLocaleString()}
• 📈 Taxa Acerto: ${formatHitRate(stats.chats.hitRate)}

🖥️ *SISTEMA*
• 💾 Memória Usada: ${formatMemory(memoryUsage.heapUsed)}
• 📊 Memória Total: ${formatMemory(memoryUsage.heapTotal)}
• 🔄 RSS: ${formatMemory(memoryUsage.rss)}
• 📈 Memória Externa: ${formatMemory(memoryUsage.external)}

🏗️ *ARQUITETURA MODULAR*
• 🔗 Socket Controller: ✅ Ativo
• 🔄 Cache Manager: ✅ Ativo  
• 🎯 Event Handler: ✅ Ativo
• 💬 Message Controller: ✅ Ativo`;

    const finalStatusText =
      statusText +
      statusText2 +
      `

━━━━━━━━━━━━━━━━━━━━━
⚡ *OmniZap v1.0.1*
🔧 Sistema de Cache Avançado
🏗️ Arquitetura Modular`;

    // Enviar mensagem dividida se for muito longa
    if (finalStatusText.length > 4096) {
      // Dividir em duas partes
      await omniZapClient.sendMessage(senderJid, { text: statusText });
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay de 1 segundo
      await omniZapClient.sendMessage(senderJid, {
        text:
          statusText2 +
          `

━━━━━━━━━━━━━━━━━━━━━
⚡ *OmniZap v1.0.1*
🔧 Sistema de Cache Avançado
🏗️ Arquitetura Modular`,
      });
    } else {
      await omniZapClient.sendMessage(senderJid, { text: finalStatusText });
    }

    console.log(`OmniZap: Status enviado para ${senderJid}`);
  } catch (error) {
    console.error('OmniZap: Erro ao enviar status:', error);
    await omniZapClient.sendMessage(senderJid, {
      text: '❌ *Erro interno*\n\nOcorreu um erro ao obter o status do sistema.',
    });
  }
};

/**
 * Envia mensagem com detalhes avançados do cache
 */
const sendCacheDetailsMessage = async (omniZapClient, senderJid) => {
  try {
    const stats = cacheManager.getStats();

    if (!stats) {
      await omniZapClient.sendMessage(senderJid, {
        text: '❌ *Erro ao obter detalhes do cache*\n\nNão foi possível recuperar os dados.',
      });
      return;
    }

    // Formatação de taxa de acerto
    const formatHitRate = (rate) => {
      const numRate = parseFloat(rate);
      if (numRate >= 80) return `🟢 ${rate}%`;
      if (numRate >= 60) return `🟡 ${rate}%`;
      return `🔴 ${rate}%`;
    };

    const cacheDetailsText = `🔄 *Detalhes do Cache OmniZap*

📊 *RESUMO GERAL*
• 🔑 Total de Chaves: ${stats.totals.allKeys.toLocaleString()}
• ✅ Total de Hits: ${stats.totals.allHits.toLocaleString()}
• ❌ Total de Misses: ${stats.totals.allMisses.toLocaleString()}
• 📈 Taxa Geral: ${formatHitRate(
      stats.totals.allHits > 0
        ? ((stats.totals.allHits / (stats.totals.allHits + stats.totals.allMisses)) * 100).toFixed(
            2,
          )
        : '0',
    )}

💬 *MENSAGENS (TTL: 1h)*
• 🔑 Chaves: ${stats.messages.keys.toLocaleString()}
• ✅ Hits: ${stats.messages.hits.toLocaleString()}
• ❌ Misses: ${stats.messages.misses.toLocaleString()}
• 📈 Taxa: ${formatHitRate(stats.messages.hitRate)}

🎯 *EVENTOS (TTL: 30min)*
• 🔑 Chaves: ${stats.events.keys.toLocaleString()}
• ✅ Hits: ${stats.events.hits.toLocaleString()}
• ❌ Misses: ${stats.events.misses.toLocaleString()}
• 📈 Taxa: ${formatHitRate(stats.events.hitRate)}

👥 *GRUPOS (TTL: 2h)*
• 🔑 Chaves: ${stats.groups.keys.toLocaleString()}
• ✅ Hits: ${stats.groups.hits.toLocaleString()}
• ❌ Misses: ${stats.groups.misses.toLocaleString()}
• 📈 Taxa: ${formatHitRate(stats.groups.hitRate)}

👤 *CONTATOS (TTL: 4h)*
• 🔑 Chaves: ${stats.contacts.keys.toLocaleString()}
• ✅ Hits: ${stats.contacts.hits.toLocaleString()}
• ❌ Misses: ${stats.contacts.misses.toLocaleString()}
• 📈 Taxa: ${formatHitRate(stats.contacts.hitRate)}

💬 *CHATS (TTL: 1h)*
• 🔑 Chaves: ${stats.chats.keys.toLocaleString()}
• ✅ Hits: ${stats.chats.hits.toLocaleString()}
• ❌ Misses: ${stats.chats.misses.toLocaleString()}
• 📈 Taxa: ${formatHitRate(stats.chats.hitRate)}

━━━━━━━━━━━━━━━━━━━━━
📋 *Legenda:*
• TTL = Time To Live (tempo de vida)
• Hits = Acessos com sucesso
• Misses = Acessos sem sucesso
• Taxa = Eficiência do cache

🔄 *Cache Manager Ativo*`;

    await omniZapClient.sendMessage(senderJid, { text: cacheDetailsText });
    console.log(`OmniZap: Detalhes do cache enviados para ${senderJid}`);
  } catch (error) {
    console.error('OmniZap: Erro ao enviar detalhes do cache:', error);
    await omniZapClient.sendMessage(senderJid, {
      text: '❌ *Erro interno*\n\nOcorreu um erro ao obter os detalhes do cache.',
    });
  }
};

const sendUnknownCommandMessage = async (omniZapClient, senderJid, command) => {
  const unknownText = `❓ *Comando Desconhecido*

🚫 **Comando:** ${COMMAND_PREFIX}${command}

💡 **Dica:** Use ${COMMAND_PREFIX}help para ver todos os comandos disponíveis`;

  await omniZapClient.sendMessage(senderJid, { text: unknownText });
};

/**
 * Envia mensagem de erro
 */
const sendErrorMessage = async (omniZapClient, senderJid) => {
  await omniZapClient.sendMessage(senderJid, {
    text: `❌ *Erro interno*\n\nOcorreu um erro ao processar seu comando. Tente novamente.`,
  });
};

/**
 * Manipulador de erros do OmniZap
 *
 * @param {Error} error - Objeto de erro
 */
const handleOmniZapError = (error) => {
  if (error.message && error.message.includes('network')) {
    console.error('OmniZap: Erro de rede detectado:', error.message);
  } else if (error.message && error.message.includes('timeout')) {
    console.error('OmniZap: Timeout detectado:', error.message);
  } else {
    console.error('OmniZap: Erro geral no processamento:', error);
  }
};

module.exports = OmniZapMessageProcessor;
