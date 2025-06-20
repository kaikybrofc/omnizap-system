/**
 * OmniZap Message Controller
 *
 * Controlador responsável pelo processamento e tratamento de mensagens
 * recebidas através do WhatsApp via tecnologia Baileys
 *
 * @version 1.0.2
 * @author OmniZap Team
 * @license MIT
 */

require('dotenv').config();

// Importar os novos módulos
const { cacheManager } = require('../cache/cacheManager');
const { eventHandler } = require('../events/eventHandler');

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

/**
 * Obtém informações detalhadas do grupo do cache
 *
 * @param {String} groupJid - JID do grupo
 * @returns {Object|null} Metadados do grupo ou null
 */
const getGroupInfo = async (groupJid) => {
  try {
    if (!groupJid || !groupJid.endsWith('@g.us')) {
      return null;
    }

    return await cacheManager.getGroupMetadata(groupJid);
  } catch (error) {
    console.error('OmniZap: Erro ao obter informações do grupo:', error);
    return null;
  }
};

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
      const isGroupMessage = messageInfo.key.remoteJid.endsWith('@g.us');
      const groupJid = isGroupMessage ? messageInfo.key.remoteJid : null;
      const senderJid = isGroupMessage
        ? messageInfo.key.participant || messageInfo.key.remoteJid
        : messageInfo.key.remoteJid;

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

      if (isGroupMessage) {
        console.log(
          `OmniZap: Processando mensagem de GRUPO - Grupo: ${groupJid}, Remetente: ${senderJid}`,
        );
      } else {
        console.log(`OmniZap: Processando mensagem DIRETA de ${senderJid}`);
      }

      await processOmniZapMessage(
        messageInfo,
        omniZapClient,
        qrCodePath,
        isGroupMessage,
        groupJid,
        senderJid,
      );
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
 * @param {Boolean} isGroupMessage - Se é mensagem de grupo
 * @param {String} groupJid - JID do grupo (se for mensagem de grupo)
 * @param {String} senderJid - JID do remetente real
 * @returns {Promise<void>}
 */
const processOmniZapMessage = async (
  messageInfo,
  omniZapClient,
  qrCodePath,
  isGroupMessage,
  groupJid,
  senderJid,
) => {
  try {
    console.log(JSON.stringify(messageInfo, null, 2));
    const messageContent = messageInfo.message;
    const messageId = messageInfo.key.id;

    if (isGroupMessage) {
      console.log(
        `OmniZap: Nova mensagem de GRUPO [${messageId}] - Grupo: ${groupJid}, Remetente: ${senderJid}`,
      );
    } else {
      console.log(`OmniZap: Nova mensagem DIRETA [${messageId}] - Remetente: ${senderJid}`);
    }

    const messageText = extractMessageText(messageContent);

    if (!messageText) {
      console.log('OmniZap: Mensagem sem texto ignorada');
      return;
    }

    if (messageText.startsWith(COMMAND_PREFIX)) {
      await processOmniZapCommand(
        messageText,
        messageInfo,
        omniZapClient,
        isGroupMessage,
        groupJid,
        senderJid,
      );
    } else {
      if (isGroupMessage) {
        console.log(
          `OmniZap: Mensagem normal de grupo processada (sem comando) - Grupo: ${groupJid}`,
        );
      } else {
        console.log('OmniZap: Mensagem normal processada (sem comando)');
      }
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
 * @param {Boolean} isGroupMessage - Se é mensagem de grupo
 * @param {String} groupJid - JID do grupo (se for mensagem de grupo)
 * @param {String} senderJid - JID do remetente real
 * @returns {Promise<void>}
 */
const processOmniZapCommand = async (
  messageText,
  messageInfo,
  omniZapClient,
  isGroupMessage,
  groupJid,
  senderJid,
) => {
  try {
    const commandText = messageText.slice(COMMAND_PREFIX.length).trim();
    const [command, ...args] = commandText.split(' ');
    const targetJid = isGroupMessage ? groupJid : senderJid; // Para onde enviar a resposta

    if (isGroupMessage) {
      console.log(
        `OmniZap: Comando detectado em GRUPO: ${command} com argumentos:`,
        args,
        `- Grupo: ${groupJid}, Remetente: ${senderJid}`,
      );
    } else {
      console.log(
        `OmniZap: Comando detectado: ${command} com argumentos:`,
        args,
        `- Remetente: ${senderJid}`,
      );
    }

    switch (command.toLowerCase()) {
      case 'tese':
        // Comando de teste usando cache
        if (isGroupMessage) {
          const groupInfo = await getGroupInfo(groupJid);
          if (groupInfo) {
            await omniZapClient.sendMessage(targetJid, {
              text:
                `📋 *Teste - Dados do Cache*\n\n` +
                `🏷️ *Nome:* ${groupInfo.subject}\n` +
                `👥 *Participantes:* ${groupInfo._participantCount}\n` +
                `📅 *Cache:* ${new Date(groupInfo._cacheTimestamp).toLocaleString('pt-BR')}\n` +
                `🔄 *Último Acesso:* ${new Date(groupInfo._lastAccessed).toLocaleString('pt-BR')}`,
            });
          } else {
            await omniZapClient.sendMessage(targetJid, {
              text: '❌ Dados do grupo não encontrados no cache',
            });
          }
        } else {
          await omniZapClient.sendMessage(targetJid, {
            text: '⚠️ Este comando funciona apenas em grupos',
          });
        }
        break;

      case 'grupo':
      case 'group':
        await sendGroupInfoMessage(omniZapClient, targetJid, isGroupMessage, groupJid, senderJid);
        break;

      case 'help':
      case 'ajuda':
        await sendHelpMessage(omniZapClient, targetJid, isGroupMessage, senderJid);
        break;

      case 'status':
        await sendStatusMessage(omniZapClient, targetJid, isGroupMessage, senderJid);
        break;

      case 'cache':
        await sendCacheDetailsMessage(omniZapClient, targetJid, isGroupMessage, senderJid);
        break;

      default:
        await sendUnknownCommandMessage(
          omniZapClient,
          targetJid,
          command,
          isGroupMessage,
          senderJid,
        );
        break;
    }
  } catch (error) {
    console.error('OmniZap: Erro ao processar comando:', error);
    const targetJid = isGroupMessage ? groupJid : senderJid;
    await sendErrorMessage(omniZapClient, targetJid, isGroupMessage, senderJid);
  }
};

/**
 * Envia informações detalhadas do grupo
 */
const sendGroupInfoMessage = async (
  omniZapClient,
  targetJid,
  isGroupMessage,
  groupJid,
  senderJid,
) => {
  try {
    if (!isGroupMessage) {
      await omniZapClient.sendMessage(targetJid, {
        text: '⚠️ *Comando de Grupo*\n\nEste comando funciona apenas em grupos.',
      });
      return;
    }

    const groupInfo = await getGroupInfo(groupJid);

    if (!groupInfo) {
      await omniZapClient.sendMessage(targetJid, {
        text: '❌ *Erro*\n\nNão foi possível obter informações do grupo.',
      });
      return;
    }

    // Formatar data de criação
    const creationDate = new Date(groupInfo.creation * 1000).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Formatar data de alteração do assunto
    const subjectDate = new Date(groupInfo.subjectTime * 1000).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Contar administradores
    const admins = groupInfo.participants?.filter((p) => p.admin === 'admin') || [];
    const members = groupInfo.participants?.filter((p) => p.admin !== 'admin') || [];

    // Determinar configurações do grupo
    const groupSettings = [];
    if (groupInfo.announce) groupSettings.push('🔐 Apenas administradores podem enviar mensagens');
    if (groupInfo.restrict)
      groupSettings.push('🛡️ Apenas administradores podem editar configurações');
    if (groupInfo.joinApprovalMode) groupSettings.push('✋ Aprovação necessária para entrar');
    if (!groupInfo.memberAddMode) groupSettings.push('🚫 Membros não podem adicionar outros');
    if (groupInfo.isCommunity) groupSettings.push('🏘️ Comunidade do WhatsApp');

    const groupInfoText = `👥 *Informações do Grupo*

🏷️ *Nome:* ${groupInfo.subject}
🆔 *ID:* \`${groupInfo.id}\`
📅 *Criado em:* ${creationDate}
👤 *Criador:* ${groupInfo.owner.replace('@s.whatsapp.net', '')}

📝 *Assunto alterado em:* ${subjectDate}
✏️ *Alterado por:* ${groupInfo.subjectOwner.replace('@s.whatsapp.net', '')}

👥 *PARTICIPANTES (${groupInfo.size || 0})*
• 👑 Administradores: ${admins.length}
• 👤 Membros: ${members.length}

⚙️ *CONFIGURAÇÕES*
${groupSettings.length > 0 ? groupSettings.join('\n') : '📖 Grupo aberto (configurações padrão)'}

📊 *CACHE*
• 🔄 Carregado: ${new Date(groupInfo._cacheTimestamp).toLocaleString('pt-BR')}
• 📈 Último acesso: ${new Date(groupInfo._lastAccessed).toLocaleString('pt-BR')}

━━━━━━━━━━━━━━━━━━━━━
👤 *Solicitado por:* ${senderJid.replace('@s.whatsapp.net', '')}
⚡ *OmniZap Group Info*`;

    // Se houver muitos participantes, enviar lista separada
    if (groupInfo.participants && groupInfo.participants.length <= 20) {
      let participantsList = `\n\n👥 *LISTA DE PARTICIPANTES*\n\n`;

      // Primeiro os admins
      const adminList = admins
        .map((admin) => `👑 ${admin.id.replace('@s.whatsapp.net', '')}`)
        .join('\n');

      // Depois os membros
      const memberList = members
        .map((member) => `👤 ${member.id.replace('@s.whatsapp.net', '')}`)
        .join('\n');

      if (adminList) participantsList += adminList;
      if (memberList) participantsList += (adminList ? '\n' : '') + memberList;

      // Verifica se a mensagem não ficará muito longa
      if ((groupInfoText + participantsList).length <= 4000) {
        await omniZapClient.sendMessage(targetJid, {
          text: groupInfoText + participantsList,
        });
      } else {
        // Envia em duas partes
        await omniZapClient.sendMessage(targetJid, { text: groupInfoText });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await omniZapClient.sendMessage(targetJid, { text: participantsList });
      }
    } else {
      await omniZapClient.sendMessage(targetJid, { text: groupInfoText });

      if (groupInfo.participants && groupInfo.participants.length > 20) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await omniZapClient.sendMessage(targetJid, {
          text:
            `📋 *Lista de Participantes*\n\n` +
            `⚠️ Grupo com muitos participantes (${groupInfo.participants.length})\n` +
            `Use ${COMMAND_PREFIX}participantes para ver a lista completa.`,
        });
      }
    }

    console.log(
      `OmniZap: Informações do grupo enviadas para ${targetJid} (solicitado por ${senderJid})`,
    );
  } catch (error) {
    console.error('OmniZap: Erro ao enviar informações do grupo:', error);
    await omniZapClient.sendMessage(targetJid, {
      text: '❌ *Erro interno*\n\nOcorreu um erro ao obter informações do grupo.',
    });
  }
};

/**
 * Envia mensagem de ajuda com todos os comandos disponíveis
 */
const sendHelpMessage = async (
  omniZapClient,
  targetJid,
  isGroupMessage = false,
  senderJid = null,
) => {
  try {
    const contextInfo = isGroupMessage
      ? `\n\n👥 *Contexto:* Mensagem de grupo\n👤 *Solicitante:* ${senderJid}`
      : `\n\n👤 *Contexto:* Mensagem direta`;

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

${COMMAND_PREFIX}*grupo* ou ${COMMAND_PREFIX}*group*
• Informações detalhadas do grupo (apenas em grupos)
• Lista de participantes e configurações
• Dados obtidos do cache inteligente

━━━━━━━━━━━━━━━━━━━━━

🏗️ *ARQUITETURA MODULAR:*
• Socket Controller - Gerencia conexões
• Cache Manager - Sistema de cache avançado
• Event Handler - Processamento de eventos
• Message Controller - Lógica de negócios

⚡ *OmniZap v1.0.1*
🔧 Sistema Profissional de Automação WhatsApp${contextInfo}`;

    await omniZapClient.sendMessage(targetJid, { text: helpText });

    if (isGroupMessage) {
      console.log(`OmniZap: Ajuda enviada para grupo ${targetJid} (solicitada por ${senderJid})`);
    } else {
      console.log(`OmniZap: Ajuda enviada para ${targetJid}`);
    }
  } catch (error) {
    console.error('OmniZap: Erro ao enviar ajuda:', error);
    await omniZapClient.sendMessage(targetJid, {
      text: '❌ *Erro interno*\n\nOcorreu um erro ao exibir a ajuda.',
    });
  }
};

/**
 * Envia mensagem com status detalhado do sistema OmniZap
 */
const sendStatusMessage = async (
  omniZapClient,
  targetJid,
  isGroupMessage = false,
  senderJid = null,
) => {
  try {
    const stats = cacheManager.getStats();

    if (!stats) {
      await omniZapClient.sendMessage(targetJid, {
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

    const contextInfo = isGroupMessage
      ? `\n\n👥 *Contexto:* Grupo ${targetJid}\n👤 *Solicitante:* ${senderJid}`
      : `\n\n👤 *Contexto:* Mensagem direta`;

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
🏗️ Arquitetura Modular${contextInfo}`;

    // Enviar mensagem dividida se for muito longa
    if (finalStatusText.length > 4096) {
      // Dividir em duas partes
      await omniZapClient.sendMessage(targetJid, { text: statusText });
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay de 1 segundo
      await omniZapClient.sendMessage(targetJid, {
        text:
          statusText2 +
          `

━━━━━━━━━━━━━━━━━━━━━
⚡ *OmniZap v1.0.1*
🔧 Sistema de Cache Avançado
🏗️ Arquitetura Modular${contextInfo}`,
      });
    } else {
      await omniZapClient.sendMessage(targetJid, { text: finalStatusText });
    }

    if (isGroupMessage) {
      console.log(`OmniZap: Status enviado para grupo ${targetJid} (solicitado por ${senderJid})`);
    } else {
      console.log(`OmniZap: Status enviado para ${targetJid}`);
    }
  } catch (error) {
    console.error('OmniZap: Erro ao enviar status:', error);
    await omniZapClient.sendMessage(targetJid, {
      text: '❌ *Erro interno*\n\nOcorreu um erro ao obter o status do sistema.',
    });
  }
};

/**
 * Envia mensagem com detalhes avançados do cache
 */
const sendCacheDetailsMessage = async (
  omniZapClient,
  targetJid,
  isGroupMessage = false,
  senderJid = null,
) => {
  try {
    const stats = cacheManager.getStats();

    if (!stats) {
      await omniZapClient.sendMessage(targetJid, {
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

    const contextInfo = isGroupMessage
      ? `\n\n👥 *Contexto:* Grupo ${targetJid}\n👤 *Solicitante:* ${senderJid}`
      : `\n\n👤 *Contexto:* Mensagem direta`;

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

🔄 *Cache Manager Ativo*${contextInfo}`;

    await omniZapClient.sendMessage(targetJid, { text: cacheDetailsText });

    if (isGroupMessage) {
      console.log(
        `OmniZap: Detalhes do cache enviados para grupo ${targetJid} (solicitado por ${senderJid})`,
      );
    } else {
      console.log(`OmniZap: Detalhes do cache enviados para ${targetJid}`);
    }
  } catch (error) {
    console.error('OmniZap: Erro ao enviar detalhes do cache:', error);
    await omniZapClient.sendMessage(targetJid, {
      text: '❌ *Erro interno*\n\nOcorreu um erro ao obter os detalhes do cache.',
    });
  }
};

const sendUnknownCommandMessage = async (
  omniZapClient,
  targetJid,
  command,
  isGroupMessage = false,
  senderJid = null,
) => {
  const contextInfo = isGroupMessage
    ? `\n\n👥 *Contexto:* Grupo\n👤 *Solicitante:* ${senderJid}`
    : `\n\n👤 *Contexto:* Mensagem direta`;

  const unknownText = `❓ *Comando Desconhecido*

🚫 **Comando:** ${COMMAND_PREFIX}${command}

💡 **Dica:** Use ${COMMAND_PREFIX}help para ver todos os comandos disponíveis${contextInfo}`;

  await omniZapClient.sendMessage(targetJid, { text: unknownText });
};

/**
 * Envia mensagem de erro
 */
const sendErrorMessage = async (
  omniZapClient,
  targetJid,
  isGroupMessage = false,
  senderJid = null,
) => {
  const contextInfo = isGroupMessage
    ? `\n\n👥 *Contexto:* Grupo\n👤 *Solicitante:* ${senderJid}`
    : `\n\n👤 *Contexto:* Mensagem direta`;

  await omniZapClient.sendMessage(targetJid, {
    text: `❌ *Erro interno*\n\nOcorreu um erro ao processar seu comando. Tente novamente.${contextInfo}`,
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
