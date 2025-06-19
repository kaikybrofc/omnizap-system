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

// Importar funções de cache do socketController
const {
  getCacheStats,
  searchMessagesInCache,
  getRecentMessages,
  clearMessagesCache,
  messagesCache,
  eventsCache,
  groupMetadataCache,
  contactsCache,
  chatsCache,
} = require('../connection/socketController');

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
        await omniZapClient.sendMessage(senderJid, { text: 'olá' });
        await omniZapClient.sendMessage(senderJid, {
          text: JSON.stringify(messageInfo, null, 2),
        });
        break;

      case 'status':
        await sendStatusMessage(omniZapClient, senderJid);
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
 * Envia mensagem com status detalhado do sistema OmniZap
 */
const sendStatusMessage = async (omniZapClient, senderJid) => {
  try {
    const stats = getCacheStats();

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
• 📨 Total Mensagens: ${stats.messages.totalMessages.toLocaleString()}
• 📝 Listas Recentes: ${stats.messages.recentLists}
• 🔢 Contadores: ${stats.messages.counters}
• 👥 JIDs Únicos: ${stats.messages.uniqueJids}
• 📈 Taxa Acerto: ${formatHitRate(stats.messages.hitRate)}

🔄 *CACHE DE EVENTOS*
• 🎯 Total Eventos: ${stats.events.totalEvents.toLocaleString()}
• 📈 Taxa Acerto: ${formatHitRate(stats.events.hitRate)}
• 🏆 Principais Tipos:`;

    // Adicionar top tipos de eventos
    let eventTypesText = '';
    if (stats.events.topEventTypes && stats.events.topEventTypes.length > 0) {
      stats.events.topEventTypes.slice(0, 3).forEach(([type, count], index) => {
        eventTypesText += `\n  ${index + 1}. ${type}: ${count}`;
      });
    } else {
      eventTypesText = '\n  Nenhum evento registrado';
    }

    const statusText2 = `${eventTypesText}

👥 *GRUPOS & CONTATOS*
• 👥 Total Grupos: ${stats.groups.totalGroups}
• 📈 Taxa Grupos: ${formatHitRate(stats.groups.hitRate)}
• 👤 Total Contatos: ${stats.contacts.totalContacts}
• 📈 Taxa Contatos: ${formatHitRate(stats.contacts.hitRate)}
• 💬 Total Chats: ${stats.chats.totalChats}
• 📈 Taxa Chats: ${formatHitRate(stats.chats.hitRate)}

🖥️ *SISTEMA*
• 💾 Memória Usada: ${formatMemory(memoryUsage.heapUsed)}
• 📊 Memória Total: ${formatMemory(memoryUsage.heapTotal)}
• 🔄 RSS: ${formatMemory(memoryUsage.rss)}
• 📈 Memória Externa: ${formatMemory(memoryUsage.external)}`;

    // Adicionar top JIDs se disponível
    let topJidsText = '';
    if (stats.messages.topJids && stats.messages.topJids.length > 0) {
      topJidsText = '\n\n🏆 *TOP JIDs (MENSAGENS)*';
      stats.messages.topJids.slice(0, 3).forEach(([jid, count], index) => {
        const jidFormatted = jid.includes('@g.us')
          ? `👥 ${jid.substring(0, 15)}...`
          : `👤 ${jid.substring(0, 15)}...`;
        topJidsText += `\n${index + 1}. ${jidFormatted} (${count})`;
      });
    }

    const finalStatusText =
      statusText +
      statusText2 +
      topJidsText +
      `

━━━━━━━━━━━━━━━━━━━━━
⚡ *OmniZap v1.0.1*
🔧 Sistema de Cache Avançado`;

    // Enviar mensagem dividida se for muito longa
    if (finalStatusText.length > 4096) {
      // Dividir em partes
      const part1 = statusText + statusText2.substring(0, 1000);
      const part2 =
        statusText2.substring(1000) +
        topJidsText +
        `

━━━━━━━━━━━━━━━━━━━━━
⚡ *OmniZap v1.0.1*
🔧 Sistema de Cache Avançado`;

      await omniZapClient.sendMessage(senderJid, { text: part1 });
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay de 1 segundo
      await omniZapClient.sendMessage(senderJid, { text: part2 });
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
