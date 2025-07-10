/**
 * OmniZap WhatsApp Connection Controller - Versão Melhorada
 *
 * Controlador responsável pela conexão e gerenciamento do socket WhatsApp
 * Utiliza Baileys para comunicação com a API WhatsApp Web
 * Integração bidirecional com EventHandler para cache centralizado
 *
 * @version 2.1.0
 * @author OmniZap Team
 * @license MIT
 */

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const { cleanEnv, str, bool } = require('envalid');
const path = require('path');

const { eventHandler } = require('../events/eventHandler');
const logger = require('../utils/logger/loggerModule');

dotenv.config();

const env = cleanEnv(process.env, {
  QR_CODE_PATH: str({
    default: path.join(__dirname, 'qr-code'),
    desc: 'Caminho para armazenar os arquivos de QR Code e autenticação',
  }),
  PAIRING_CODE: bool({
    default: false,
    desc: 'Usar código de pareamento em vez de QR Code',
  }),
  PHONE_NUMBER: str({
    default: '',
    desc: 'Número de telefone para o código de pareamento (somente números, com código do país)',
  }),
});

// Logger silencioso para Baileys
const baileysLogger = require('pino')({ level: 'silent' });

// Variáveis globais para gerenciamento de conexão
let activeSocket = null;
let connectionAttempts = 0;
let lastConnectionTime = null;
let isReconnecting = false;

/**
 * Configuração do EventHandler com comunicação bidirecional
 */
function setupEventHandlerIntegration() {
  // Define o socketController no eventHandler para comunicação bidirecional
  eventHandler.setSocketController({
    getActiveSocket: () => activeSocket,
    getConnectionStats: getConnectionStats,
    sendMessage: sendMessage,
    forceDisconnect: forceDisconnect,
    forceReconnect: reconnectToWhatsApp,
    getGroupInfo: getGroupInfo,
    sendPresence: sendPresence,
  });

  // Registra callbacks importantes
  eventHandler.registerCallback('connection.state.change', async (data) => {
    logger.info(`🔄 Callback: Mudança de estado de conexão: ${data.isConnected ? 'CONECTADO' : 'DESCONECTADO'}`);

    if (!data.isConnected && !isReconnecting && connectionAttempts < 5) {
      logger.info('🔄 Agendando reconexão automática...');
      setTimeout(() => {
        if (!activeSocket && !isReconnecting) {
          reconnectToWhatsApp();
        }
      }, 10000); // 10 segundos de delay
    }
  });

  eventHandler.registerCallback('group.metadata.updated', async (data) => {
    logger.debug(`👥 Callback: Metadados atualizados para grupo: ${data.metadata.subject || 'Sem nome'}`);
  });

  eventHandler.registerCallback('messages.received', async (data) => {
    logger.debug(`📨 Callback: ${data.processedCount} mensagens processadas, ${data.groupJids.length} grupos detectados`);
  });

  logger.info('🤝 SocketController: Integração bidirecional com EventHandler configurada');
}

/**
 * Obtém estatísticas de conexão
 */
function getConnectionStats() {
  const eventStats = eventHandler.getCacheStats();
  return {
    ...eventStats,
    isConnected: activeSocket !== null && activeSocket.ws?.readyState === 1,
    connectionState: activeSocket?.ws?.readyState || 'disconnected',
    lastConnection: lastConnectionTime,
    connectionAttempts: connectionAttempts,
    socketId: activeSocket?.user?.id || null,
    userPhone: activeSocket?.user?.name || null,
    uptime: lastConnectionTime ? Date.now() - lastConnectionTime : 0,
    isReconnecting: isReconnecting,
  };
}

/**
 * Conecta ao WhatsApp usando Baileys
 * Implementação baseada no exemplo oficial com integração EventHandler
 */
async function connectToWhatsApp() {
  if (isReconnecting) {
    logger.warn('🔄 Já está em processo de reconexão, aguarde...');
    return;
  }

  try {
    isReconnecting = true;
    connectionAttempts++;
    logger.info(`🔗 OmniZap: Tentativa de conexão #${connectionAttempts}`);

    // Configura o estado de autenticação
    const { state, saveCreds } = await useMultiFileAuthState(env.QR_CODE_PATH);
    const { version } = await fetchLatestBaileysVersion();

    logger.info('🔗 OmniZap: Iniciando conexão com WhatsApp...');
    logger.info(`📊 Cache Stats: ${JSON.stringify(eventHandler.getCacheStats())}`);

    // Cria o socket do WhatsApp com configurações otimizadas
    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      browser: Browsers.ubuntu('OmniZap'),
      printQRInTerminal: !env.PAIRING_CODE,
      generateHighQualityLinkPreview: true,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) => typeof jid === 'string' && jid.includes('broadcast'),
      // Melhora a performance com cache integrado
      getMessage: async (key) => {
        const cached = eventHandler.getMessage(key.remoteJid, key.id);
        if (cached) {
          logger.debug(`📱 Cache hit para getMessage: ${key.id.substring(0, 10)}...`);
        }
        return cached?.message || null;
      },
    });

    // Configura integração bidirecional uma vez por sessão
    if (connectionAttempts === 1) {
      setupEventHandlerIntegration();
    }

    // Gerencia código de pareamento se necessário
    if (env.PAIRING_CODE && !sock.authState.creds.registered) {
      if (!env.PHONE_NUMBER) {
        logger.error('❌ Número de telefone necessário para o modo de pareamento');
        throw new Error('PHONE_NUMBER é obrigatório quando PAIRING_CODE=true');
      }

      const phoneNumber = env.PHONE_NUMBER.replace(/[^0-9]/g, '');
      logger.info(`📞 Solicitando código de pareamento para: ${phoneNumber}`);

      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          logger.info('═══════════════════════════════════════════════════');
          logger.info('📱 SEU CÓDIGO DE PAREAMENTO 📱');
          logger.info(`\n          > ${code.match(/.{1,4}/g).join('-')} <\n`);
          logger.info('💡 WhatsApp → Dispositivos vinculados → Vincular com número');
          logger.info('═══════════════════════════════════════════════════');
        } catch (error) {
          logger.error('❌ Erro ao solicitar código de pareamento:', error.message);
        }
      }, 3000);
    }

    // Event handlers com melhor integração
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      logger.info(`🔗 Status da conexão: ${connection}`);

      if (qr && !env.PAIRING_CODE) {
        logger.info('📱 QR Code gerado! Escaneie com seu WhatsApp:');
        logger.info('═══════════════════════════════════════════════════');
        qrcode.generate(qr, { small: true });
        logger.info('═══════════════════════════════════════════════════');
        logger.info('💡 WhatsApp → Dispositivos vinculados → Vincular dispositivo');
        logger.warn('⏰ QR Code expira em 60 segundos');
      }

      if (connection === 'close') {
        activeSocket = null;
        lastConnectionTime = null;
        isReconnecting = false;

        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;

        logger.warn(`🔌 Conexão fechada. Motivo: ${reason}, Reconectar: ${shouldReconnect}`);

        // Atualiza estado no eventHandler
        eventHandler.updateConnectionState(false, { reason, shouldReconnect, connectionAttempts });

        if (shouldReconnect && connectionAttempts < 5) {
          logger.info(`🔄 Reconectando em 10 segundos... (Tentativa ${connectionAttempts + 1}/5)`);
          setTimeout(() => {
            if (!activeSocket) {
              connectToWhatsApp();
            }
          }, 10000);
        } else if (!shouldReconnect) {
          logger.error('❌ Sessão encerrada. Reinicie a aplicação para reconectar.');
          connectionAttempts = 0;
          eventHandler.savePersistedData();
        } else {
          logger.error('❌ Máximo de tentativas de reconexão atingido.');
          eventHandler.savePersistedData();
        }
      } else if (connection === 'open') {
        activeSocket = sock;
        lastConnectionTime = Date.now();
        connectionAttempts = 0;
        isReconnecting = false;

        logger.info('✅ OmniZap: Conectado com sucesso ao WhatsApp!');
        await sock.sendPresenceUpdate('available');

        // Atualiza estado no eventHandler
        eventHandler.updateConnectionState(true, {
          userId: sock.user?.id,
          userPhone: sock.user?.name,
          connectionTime: lastConnectionTime,
          version: version,
        });

        // Configura o cliente no event handler
        eventHandler.setWhatsAppClient(sock);

        // Log informações do usuário e estatísticas
        logger.info(`👤 Conectado como: ${sock.user?.name || 'Usuário'} (${sock.user?.id || 'ID não disponível'})`);
        const stats = eventHandler.getCacheStats();
        logger.info(`📊 Cache: ${stats.groups} grupos, ${stats.contacts} contatos, ${stats.chats} chats, Hit Rate: ${stats.cacheHitRate}%`);
      } else if (connection === 'connecting') {
        logger.info('🔄 Conectando ao WhatsApp...');
        eventHandler.updateConnectionState(false, { status: 'connecting' });
      }

      // Processa evento com contexto adicional
      eventHandler.processGenericEvent('connection.update', {
        ...update,
        _timestamp: Date.now(),
        _version: version,
        _browser: 'OmniZap-Ubuntu',
        _connectionAttempts: connectionAttempts,
        _lastConnectionTime: lastConnectionTime,
        _isReconnecting: isReconnecting,
      });
    });

    // Manipulador de mensagens aprimorado
    sock.ev.on('messages.upsert', async (messageUpdate) => {
      const messageCount = messageUpdate.messages?.length || 0;
      logger.info(`📨 Novas mensagens: ${messageCount}`);

      // Processa no event handler com contexto melhorado
      eventHandler.processMessagesUpsert({
        ...messageUpdate,
        _receivedAt: Date.now(),
        _socketId: sock.user?.id,
      });

      // Chama o handler principal se disponível
      try {
        const omniZapMainHandler = require('../../index.js');
        await omniZapMainHandler(messageUpdate, sock, env.QR_CODE_PATH);
        logger.debug('🎯 Handler principal executado com sucesso');
      } catch (error) {
        logger.error('❌ Erro no handler principal:', error.message);
      }
    });

    // Outros eventos importantes com melhor logging
    sock.ev.on('messages.update', (updates) => {
      logger.debug(`📝 Atualizações de mensagens: ${updates?.length || 0}`);
      eventHandler.processGenericEvent('messages.update', updates);
    });

    sock.ev.on('messages.delete', (deletion) => {
      logger.warn('🗑️ Mensagens deletadas');
      eventHandler.processGenericEvent('messages.delete', deletion);
    });

    sock.ev.on('messages.reaction', (reactions) => {
      logger.debug(`😀 Reações: ${reactions?.length || 0}`);
      eventHandler.processGenericEvent('messages.reaction', reactions);
    });

    sock.ev.on('message-receipt.update', (receipts) => {
      logger.debug(`📬 Recibos: ${receipts?.length || 0}`);
      eventHandler.processGenericEvent('message-receipt.update', receipts);
    });

    // Eventos de grupos com melhor integração
    sock.ev.on('groups.update', (updates) => {
      logger.info(`👥 Atualizações de grupos: ${updates?.length || 0}`);
      eventHandler.processGenericEvent('groups.update', updates);
    });

    sock.ev.on('groups.upsert', (groupsMetadata) => {
      logger.info(`👥 Novos grupos: ${groupsMetadata?.length || 0}`);
      eventHandler.processGenericEvent('groups.upsert', groupsMetadata);
    });

    sock.ev.on('group-participants.update', (event) => {
      logger.info(`👥 Participantes atualizados no grupo: ${event.id?.substring(0, 20)}...`);
      eventHandler.processGenericEvent('group-participants.update', event);
    });

    // Eventos de chats
    sock.ev.on('chats.upsert', (chats) => {
      logger.debug(`💬 Novos chats: ${chats?.length || 0}`);
      eventHandler.processGenericEvent('chats.upsert', chats);
    });

    sock.ev.on('chats.update', (updates) => {
      logger.debug(`💬 Chats atualizados: ${updates?.length || 0}`);
      eventHandler.processGenericEvent('chats.update', updates);
    });

    sock.ev.on('chats.delete', (jids) => {
      logger.warn(`💬 Chats deletados: ${jids?.length || 0}`);
      eventHandler.processGenericEvent('chats.delete', jids);
    });

    // Eventos de contatos
    sock.ev.on('contacts.upsert', (contacts) => {
      logger.debug(`👤 Novos contatos: ${contacts?.length || 0}`);
      eventHandler.processGenericEvent('contacts.upsert', contacts);
    });

    sock.ev.on('contacts.update', (updates) => {
      logger.debug(`👤 Contatos atualizados: ${updates?.length || 0}`);
      eventHandler.processGenericEvent('contacts.update', updates);
    });

    // Histórico de mensagens
    sock.ev.on('messaging-history.set', (historyData) => {
      logger.info('📚 Histórico de mensagens carregado');
      eventHandler.processGenericEvent('messaging-history.set', historyData);
    });

    // Salva credenciais quando atualizadas
    sock.ev.on('creds.update', async () => {
      logger.debug('🔐 Credenciais atualizadas - Salvando...');
      await saveCreds();
      eventHandler.processGenericEvent('creds.update', {
        timestamp: Date.now(),
        _autoSaved: true,
      });
    });

    return sock;
  } catch (error) {
    isReconnecting = false;
    logger.error('❌ Erro ao conectar ao WhatsApp:', error.message);

    // Salva dados mesmo em caso de erro
    eventHandler.savePersistedData();
    throw error;
  }
}

/**
 * Força reconexão do WhatsApp
 */
async function reconnectToWhatsApp() {
  try {
    logger.info('🔄 Iniciando processo de reconexão...');

    if (activeSocket) {
      logger.info('🔌 Desconectando socket atual...');
      await forceDisconnect();
    }

    // Aguarda um pouco antes de reconectar
    await new Promise((resolve) => setTimeout(resolve, 2000));

    logger.info('🔄 Iniciando nova conexão...');
    return await connectToWhatsApp();
  } catch (error) {
    isReconnecting = false;
    logger.error('❌ Erro na reconexão:', error.message);
    throw error;
  }
}

/**
 * Obtém informações detalhadas de um grupo
 */
async function getGroupInfo(groupJid, forceRefresh = false) {
  try {
    if (!forceRefresh) {
      const cached = eventHandler.getGroup(groupJid);
      if (cached && cached._cachedAt && Date.now() - cached._cachedAt < 1800000) {
        // 30 min
        return cached;
      }
    }

    if (!activeSocket) {
      throw new Error('Socket não conectado');
    }

    const metadata = await activeSocket.groupMetadata(groupJid);

    // Atualiza cache através do eventHandler
    if (metadata) {
      eventHandler.groupCache.set(groupJid, {
        ...metadata,
        _cachedAt: Date.now(),
        _fetchedViaController: true,
      });
    }

    return metadata;
  } catch (error) {
    logger.error(`❌ Erro ao obter info do grupo ${groupJid}:`, error.message);
    throw error;
  }
}

/**
 * Envia presença (online/offline/typing)
 */
async function sendPresence(presence, jid = null) {
  if (!activeSocket) {
    throw new Error('Socket não conectado');
  }

  try {
    if (jid) {
      await activeSocket.sendPresenceUpdate(presence, jid);
    } else {
      await activeSocket.sendPresenceUpdate(presence);
    }

    logger.debug(`👁️ Presença enviada: ${presence}${jid ? ` para ${jid.substring(0, 20)}...` : ' globalmente'}`);
  } catch (error) {
    logger.error('❌ Erro ao enviar presença:', error.message);
    throw error;
  }
}

/**
 * Obtém o socket ativo atual
 */
function getActiveSocket() {
  return activeSocket;
}

/**
 * Força desconexão e limpeza
 */
async function forceDisconnect() {
  if (activeSocket) {
    try {
      await activeSocket.logout();
      activeSocket = null;
      lastConnectionTime = null;
      isReconnecting = false;
      logger.info('🔌 Desconectado manualmente');
    } catch (error) {
      logger.error('❌ Erro ao desconectar:', error.message);
    }
  }
  eventHandler.savePersistedData();
}

/**
 * Envia mensagem usando o socket ativo
 */
async function sendMessage(jid, content, options = {}) {
  if (!activeSocket) {
    throw new Error('Socket não conectado');
  }

  try {
    const result = await activeSocket.sendMessage(jid, content, options);
    logger.debug(`📤 Mensagem enviada para ${jid.substring(0, 20)}...`);

    // Registra no eventHandler para estatísticas
    eventHandler.processGenericEvent('message.sent', {
      jid,
      content: typeof content,
      options,
      timestamp: Date.now(),
      _sentViaController: true,
    });

    return result;
  } catch (error) {
    logger.error(`❌ Erro ao enviar mensagem para ${jid}:`, error.message);
    throw error;
  }
}

// Inicia a conexão automaticamente
connectToWhatsApp().catch((error) => {
  logger.error('💥 Falha crítica na inicialização:', error.message);

  // Tenta novamente após 30 segundos
  setTimeout(() => {
    logger.info('🔄 Tentando reinicialização após falha crítica...');
    connectToWhatsApp().catch(() => {
      logger.error('💥 Falha definitiva na inicialização');
      process.exit(1);
    });
  }, 30000);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🛑 Encerrando aplicação graciosamente...');
  await forceDisconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Encerrando aplicação graciosamente...');
  await forceDisconnect();
  process.exit(0);
});

module.exports = {
  connectToWhatsApp,
  reconnectToWhatsApp,
  eventHandler,
  getActiveSocket,
  getConnectionStats,
  getGroupInfo,
  forceDisconnect,
  sendMessage,
  sendPresence,
  env,
};
