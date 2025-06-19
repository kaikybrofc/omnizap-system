/**
 * OmniZap WhatsApp Connection Controller
 *
 * Controlador responsável pela conexão e gerenciamento do socket WhatsApp
 * Utiliza Baileys para comunicação com a API WhatsApp Web
 *
 * @version 1.0.1
 * @author OmniZap Team
 * @license MIT
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const dotenv = require('dotenv');
const { cleanEnv, str } = require('envalid');
const fs = require('fs');
const path = require('path');
const NodeCache = require('node-cache');
const chalk = require('chalk');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');

dotenv.config();

const env = cleanEnv(process.env, {
  QR_CODE_PATH: str({
    default: path.join(__dirname, 'qr-code'),
    desc: 'Caminho para armazenar os arquivos de QR Code e autenticação',
  }),
});

const OmniZapColors = {
  primary: (text) => chalk.cyan(text),
  error: (text) => chalk.red(text),
  warning: (text) => chalk.yellow(text),
  success: (text) => chalk.green(text),
  info: (text) => chalk.blue(text),
  gray: (text) => chalk.gray(text),
  white: (text) => chalk.white(text),
};

const logger = require('pino')().child({}).child({ level: 'silent' });

const OmniZapMessages = {
  auth_error: () => 'OmniZap: Erro de autenticação. Escaneie o QR Code novamente.',
  timeout: () => 'OmniZap: Timeout de conexão. Tentando reconectar...',
  rate_limit: () => 'OmniZap: Muitas requisições. Tente novamente em alguns momentos.',
  connection_closed: () => 'OmniZap: Conexão fechada inesperadamente. Reconectando...',
  connection_timeout: () => 'OmniZap: Timeout de conexão. Reconectando...',
  server_error: () => 'OmniZap: Erro interno do servidor. Reconectando...',
  version_error: () => 'OmniZap: Falha na versão. Atualize a aplicação.',
  connected: () => 'OmniZap: Conectado com sucesso!',
};

const moment = require('moment-timezone');
const getCurrentDate = () => moment().format('DD/MM/YY');
const getCurrentTime = () => moment().format('HH:mm:ss');

const QR_CODE_PATH = env.QR_CODE_PATH;

if (!fs.existsSync(QR_CODE_PATH)) {
  fs.mkdirSync(QR_CODE_PATH, { recursive: true });
  console.log(OmniZapColors.info(`OmniZap: Diretório criado para QR Code: ${QR_CODE_PATH}`));
}

if (!fs.existsSync(`${QR_CODE_PATH}/creds.json`)) {
  console.log(
    OmniZapColors.primary(
      `OmniZap: Certifique-se de ter outro dispositivo para escanear o QR Code.\nCaminho QR: ${QR_CODE_PATH}\n`,
    ) + '–',
  );
}

const messageRetryCache = new NodeCache();
const messagesCache = new NodeCache({
  stdTTL: 3600, // TTL de 1 hora para mensagens em cache
  checkperiod: 600, // Verifica itens expirados a cada 10 minutos
  useClones: false, // Performance otimizada
});

// Log de inicialização do sistema de cache
console.log(OmniZapColors.info('OmniZap: Sistema de cache de mensagens inicializado'));
console.log(OmniZapColors.gray('OmniZap: TTL do cache: 1 hora | Verificação: 10 minutos'));

// Eventos do cache de mensagens
messagesCache.on('expired', (key, value) => {
  console.log(OmniZapColors.gray(`OmniZap: Mensagem expirada do cache: ${key}`));
});

messagesCache.on('flush', () => {
  console.log(OmniZapColors.warning('OmniZap: Cache de mensagens foi limpo'));
});

/**
 * Limpa mensagens antigas do cache baseado em critérios específicos
 *
 * @param {string} remoteJid - JID específico para limpar (opcional)
 * @returns {number} Número de mensagens removidas
 */
function clearMessagesCache(remoteJid = null) {
  try {
    let removedCount = 0;
    const allKeys = messagesCache.keys();

    if (remoteJid) {
      // Remove apenas mensagens de um JID específico
      const keysToRemove = allKeys.filter((key) => key.includes(`msg_${remoteJid}_`));
      keysToRemove.forEach((key) => {
        messagesCache.del(key);
        removedCount++;
      });
      console.log(`OmniZap: ${removedCount} mensagens removidas do cache para JID: ${remoteJid}`);
    } else {
      // Remove todas as mensagens do cache
      messagesCache.flushAll();
      removedCount = allKeys.length;
      console.log(`OmniZap: Cache de mensagens completamente limpo (${removedCount} mensagens)`);
    }

    return removedCount;
  } catch (error) {
    console.error('OmniZap: Erro ao limpar cache de mensagens:', error);
    return 0;
  }
}

/**
 * Obtém estatísticas detalhadas do cache de mensagens
 *
 * @returns {Object} Estatísticas do cache
 */
function getCacheStats() {
  try {
    const stats = messagesCache.getStats();
    const keys = messagesCache.keys();

    // Análise por tipo de chave
    const messageKeys = keys.filter((k) => k.startsWith('msg_'));
    const recentKeys = keys.filter((k) => k.startsWith('recent_'));
    const counterKeys = keys.filter((k) => k.startsWith('count_'));

    // Análise por JID
    const jidStats = {};
    messageKeys.forEach((key) => {
      const parts = key.split('_');
      if (parts.length >= 2) {
        const jid = parts[1];
        jidStats[jid] = (jidStats[jid] || 0) + 1;
      }
    });

    return {
      totalMessages: messageKeys.length,
      recentLists: recentKeys.length,
      counters: counterKeys.length,
      totalKeys: keys.length,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) : 0,
      uniqueJids: Object.keys(jidStats).length,
      topJids: Object.entries(jidStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5),
    };
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao obter estatísticas do cache:'), error);
    return null;
  }
}

/**
 * Busca mensagens no cache por critérios específicos
 *
 * @param {Object} criteria - Critérios de busca
 * @param {string} criteria.remoteJid - JID específico
 * @param {string} criteria.messageType - Tipo de mensagem
 * @param {number} criteria.limit - Limite de resultados
 * @returns {Array} Array de mensagens encontradas
 */
function searchMessagesInCache(criteria = {}) {
  try {
    const { remoteJid, messageType, limit = 50 } = criteria;
    const keys = messagesCache.keys();
    let results = [];

    // Filtra chaves por JID se especificado
    let filteredKeys = keys.filter((k) => k.startsWith('msg_'));
    if (remoteJid) {
      filteredKeys = filteredKeys.filter((k) => k.includes(`msg_${remoteJid}_`));
    }

    // Recupera mensagens e filtra por tipo se especificado
    for (const key of filteredKeys) {
      if (results.length >= limit) break;

      const message = messagesCache.get(key);
      if (message) {
        if (!messageType || message._messageType === messageType) {
          results.push({
            ...message,
            _cacheKey: key,
          });
        }
      }
    }

    // Ordena por timestamp (mais recentes primeiro)
    results.sort((a, b) => (b._cacheTimestamp || 0) - (a._cacheTimestamp || 0));

    console.log(
      OmniZapColors.info(`OmniZap: 🔍 Busca no cache encontrou ${results.length} mensagens`),
    );
    return results;
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao buscar mensagens no cache:'), error);
    return [];
  }
}

/**
 * Obtém mensagens recentes de um JID específico
 *
 * @param {string} remoteJid - JID do contato/grupo
 * @param {number} limit - Número máximo de mensagens
 * @returns {Array} Array de mensagens recentes
 */
function getRecentMessages(remoteJid, limit = 20) {
  try {
    const recentMessagesKey = `recent_${remoteJid}`;
    const recentMessages = messagesCache.get(recentMessagesKey) || [];

    const limitedMessages = recentMessages.slice(0, limit);

    console.log(
      OmniZapColors.info(
        `OmniZap: 📱 Recuperadas ${
          limitedMessages.length
        } mensagens recentes para ${remoteJid.substring(0, 20)}...`,
      ),
    );
    return limitedMessages;
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao obter mensagens recentes:'), error);
    return [];
  }
}

/**
 * Salva uma mensagem no cache com funcionalidades avançadas
 *
 * @param {Object} messageInfo - Informações completas da mensagem
 * @returns {void}
 */
function saveMessageToCache(messageInfo) {
  try {
    if (!messageInfo || !messageInfo.key || !messageInfo.key.remoteJid || !messageInfo.key.id) {
      console.warn(
        OmniZapColors.warning('OmniZap: ⚠️ Informações de mensagem inválidas para cache'),
      );
      return;
    }

    const cacheKey = `msg_${messageInfo.key.remoteJid}_${messageInfo.key.id}`;
    const remoteJid = messageInfo.key.remoteJid;

    // Adiciona metadados para o cache
    const enhancedMessage = {
      ...messageInfo,
      _cached: true,
      _cacheTimestamp: Date.now(),
      _lastAccessed: Date.now(),
      _messageType: messageInfo.message ? Object.keys(messageInfo.message)[0] : 'unknown',
    };

    // Salva a mensagem individual no cache
    messagesCache.set(cacheKey, enhancedMessage);

    // Mantém lista de mensagens recentes por JID (últimas 100 mensagens)
    const recentMessagesKey = `recent_${remoteJid}`;
    let recentMessages = messagesCache.get(recentMessagesKey) || [];

    // Adiciona a nova mensagem ao início da lista
    recentMessages.unshift(enhancedMessage);

    // Mantém apenas as últimas 100 mensagens recentes
    if (recentMessages.length > 100) {
      recentMessages = recentMessages.slice(0, 100);
    }

    // Salva a lista atualizada de mensagens recentes
    messagesCache.set(recentMessagesKey, recentMessages, 7200); // 2 horas para mensagens recentes

    // Atualiza contador de mensagens por JID
    const counterKey = `count_${remoteJid}`;
    const currentCount = messagesCache.get(counterKey) || 0;
    messagesCache.set(counterKey, currentCount + 1, 86400); // 24 horas para contadores

    console.log(
      OmniZapColors.success(
        `OmniZap: 💾 Mensagem salva no cache (${cacheKey.substring(0, 50)}...)`,
      ),
    );
    console.log(
      OmniZapColors.gray(
        `OmniZap: 📊 Tipo: ${enhancedMessage._messageType} | JID: ${remoteJid.substring(0, 20)}...`,
      ),
    );

    // Log estatísticas do cache a cada 10 mensagens
    const stats = messagesCache.getStats();
    if (stats.keys % 10 === 0) {
      console.log(
        OmniZapColors.info(
          `OmniZap: 📈 Cache Stats - Chaves: ${stats.keys}, Hits: ${stats.hits}, Misses: ${stats.misses}`,
        ),
      );
    }

    // Alerta se o cache estiver ficando muito grande
    if (stats.keys > 1000) {
      console.log(
        OmniZapColors.warning(`OmniZap: ⚠️ Cache com ${stats.keys} chaves - considere limpeza`),
      );
    }
  } catch (error) {
    console.error(OmniZapColors.error('OmniZap: ❌ Erro ao salvar mensagem no cache:'), error);
  }
}

/**
 * Inicializa a conexão WhatsApp do OmniZap
 *
 * @returns {Promise<void>}
 */
async function initializeOmniZapConnection() {
  const { state, saveCreds } = await useMultiFileAuthState(QR_CODE_PATH);
  const { version } = await fetchLatestBaileysVersion();

  /**
   * Recupera uma mensagem pela chave do store com sistema de cache avançado
   *
   * @param {Object} key - Chave da mensagem contendo remoteJid e id
   * @returns {Promise<Object|undefined>} Objeto da mensagem ou undefined se não encontrada
   */
  async function getOmniZapMessage(key) {
    if (!key || !key.remoteJid || !key.id) {
      console.warn('OmniZap: Chave de mensagem inválida:', key);
      return undefined;
    }

    try {
      // Gera chave única para o cache baseada no JID e ID da mensagem
      const cacheKey = `msg_${key.remoteJid}_${key.id}`;

      // Tenta recuperar a mensagem do cache primeiro
      const cachedMessage = messagesCache.get(cacheKey);
      if (cachedMessage) {
        console.log(
          OmniZapColors.success(
            `OmniZap: ✅ Mensagem recuperada do cache (${cacheKey.substring(0, 50)}...)`,
          ),
        );

        // Atualiza timestamp de último acesso
        cachedMessage._lastAccessed = Date.now();
        messagesCache.set(cacheKey, cachedMessage);

        return cachedMessage;
      }

      // Log de miss no cache
      console.log(
        OmniZapColors.warning(
          `OmniZap: ❌ Mensagem não encontrada no cache (${cacheKey.substring(0, 50)}...)`,
        ),
      );

      // Busca em mensagens recentes (últimas 100 mensagens) se não estiver no cache
      const recentMessagesKey = `recent_${key.remoteJid}`;
      const recentMessages = messagesCache.get(recentMessagesKey) || [];

      const foundMessage = recentMessages.find((msg) => msg && msg.key && msg.key.id === key.id);

      if (foundMessage) {
        console.log(OmniZapColors.info(`OmniZap: 🔍 Mensagem encontrada em mensagens recentes`));

        // Salva no cache para próximos acessos
        foundMessage._lastAccessed = Date.now();
        foundMessage._foundInRecent = true;
        messagesCache.set(cacheKey, foundMessage);

        return foundMessage;
      }

      // Tenta buscar em cache por padrões similares (fallback)
      const allKeys = messagesCache.keys();
      const similarKeys = allKeys.filter((k) => k.includes(key.remoteJid) && k.includes('msg_'));

      if (similarKeys.length > 0) {
        console.log(
          OmniZapColors.gray(
            `OmniZap: 🔎 Encontradas ${similarKeys.length} mensagens similares no cache`,
          ),
        );
      }

      return undefined;
    } catch (error) {
      console.error(
        OmniZapColors.error(
          `OmniZap: ❌ Erro ao carregar mensagem (JID: ${key.remoteJid}, ID: ${key.id}):`,
        ),
        error,
      );
      return undefined;
    }
  }

  const omniZapClient = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ['OmniZap', 'Chrome', '120.0.0.0'],
    msgRetryCounterCache: messageRetryCache,
    generateHighQualityLinkPreview: true,
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!message?.interactiveMessage;
      if (requiresPatch) {
        message = {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadataVersion: 2,
                deviceListMetadata: {},
              },
              ...message,
            },
          },
        };
      }
      return message;
    },
    getMessage: getOmniZapMessage,
  });

  omniZapClient.ev.process(async (events) => {
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(OmniZapColors.primary('\n📱 QR Code gerado! Escaneie com seu WhatsApp:'));
        console.log(OmniZapColors.gray('═══════════════════════════════════════════════════'));
        qrcode.generate(qr, { small: true });
        console.log(OmniZapColors.gray('═══════════════════════════════════════════════════'));
        console.log(
          OmniZapColors.info('💡 Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo'),
        );
        console.log(OmniZapColors.warning('⏰ O QR Code expira em 60 segundos\n'));
      }

      const statusCode = new Boom(lastDisconnect?.error)?.output.statusCode;

      switch (connection) {
        case 'close':
          if (statusCode) {
            switch (statusCode) {
              case 401:
                console.log(OmniZapColors.error(OmniZapMessages.auth_error()));
                break;
              case 408:
                console.log(OmniZapColors.warning(OmniZapMessages.timeout()));
                break;
              case 411:
                console.log(OmniZapColors.warning(OmniZapMessages.rate_limit()));
                break;
              case 428:
                console.log(OmniZapColors.warning(OmniZapMessages.connection_closed()));
                break;
              case 440:
                console.log(OmniZapColors.gray(OmniZapMessages.connection_timeout()));
                break;
              case 500:
                console.log(OmniZapColors.gray(OmniZapMessages.server_error()));
                break;
              case 503:
                console.log(OmniZapColors.gray('OmniZap: Erro desconhecido 503.'));
                break;
              case 515:
                console.log(OmniZapColors.gray(OmniZapMessages.version_error()));
                break;
              default:
                console.log(
                  `${OmniZapColors.error('[CONEXÃO FECHADA]')} OmniZap: Conexão fechada por erro: ${
                    lastDisconnect?.error
                  }`,
                );
            }
            initializeOmniZapConnection();
          }
          break;

        case 'connecting':
          console.log(
            OmniZapColors.primary(
              `〔 OmniZap 〕Reconectando/Iniciando - ${getCurrentDate()} ${getCurrentTime()}`,
            ),
          );
          break;

        case 'open':
          console.log(OmniZapColors.success(OmniZapMessages.connected()));
          await omniZapClient.sendPresenceUpdate('available');
          break;

        default:
          break;
      }
    }

    if (events['messages.upsert']) {
      const messageUpdate = events['messages.upsert'];

      // Salva todas as mensagens recebidas no cache com processamento melhorado
      if (messageUpdate.messages && Array.isArray(messageUpdate.messages)) {
        console.log(
          OmniZapColors.info(
            `OmniZap: 📨 Processando ${messageUpdate.messages.length} mensagem(ns)`,
          ),
        );

        let savedCount = 0;
        messageUpdate.messages.forEach((messageInfo) => {
          try {
            // Adiciona informações de contexto da mensagem
            const enhancedMessageInfo = {
              ...messageInfo,
              _receivedAt: Date.now(),
              _updateType: messageUpdate.type || 'notify',
              _batchId: Date.now().toString(),
            };

            saveMessageToCache(enhancedMessageInfo);
            savedCount++;
          } catch (error) {
            console.error(
              OmniZapColors.error('OmniZap: ❌ Erro ao processar mensagem individual:'),
              error,
            );
          }
        });

        console.log(
          OmniZapColors.success(
            `OmniZap: ✅ ${savedCount}/${messageUpdate.messages.length} mensagens salvas no cache`,
          ),
        );
      }

      const omniZapMainHandler = require('../../index.js');
      omniZapMainHandler(messageUpdate, omniZapClient, QR_CODE_PATH)
        .then(() => {
          console.log(OmniZapColors.gray('OmniZap: 🎯 Handler principal executado com sucesso'));
        })
        .catch((error) => {
          console.error(
            OmniZapColors.error('OmniZap: ❌ Erro no handler principal:'),
            String(error),
          );
        });
    }

    if (events['creds.update']) {
      await saveCreds();
    }
  });
}

initializeOmniZapConnection().catch(async (error) => {
  return console.log(OmniZapColors.error('OmniZap: Erro ao inicializar o sistema: ' + error));
});

// Exporta funções de cache para uso em outros módulos
module.exports = {
  getCacheStats,
  searchMessagesInCache,
  getRecentMessages,
  clearMessagesCache,
  saveMessageToCache,
  messagesCache, // Exporta a instância do cache para acesso direto se necessário
};

// Log de inicialização completa
console.log(
  OmniZapColors.success('🚀 OmniZap: Sistema de cache avançado inicializado com sucesso!'),
);
console.log(OmniZapColors.info('📋 Funcionalidades disponíveis:'));
console.log(OmniZapColors.gray('   • Cache inteligente de mensagens'));
console.log(OmniZapColors.gray('   • Busca por critérios específicos'));
console.log(OmniZapColors.gray('   • Mensagens recentes por JID'));
console.log(OmniZapColors.gray('   • Limpeza automática inteligente'));
console.log(OmniZapColors.gray('   • Estatísticas detalhadas'));
console.log(OmniZapColors.gray('   • Sistema de backup'));

// Timer para mostrar estatísticas detalhadas do cache a cada 30 minutos
setInterval(() => {
  const stats = getCacheStats();
  if (stats) {
    console.log(OmniZapColors.primary('📊 ═══ OmniZap Cache Statistics ═══'));
    console.log(OmniZapColors.info(`   💾 Total de mensagens: ${stats.totalMessages}`));
    console.log(OmniZapColors.info(`   📝 Listas recentes: ${stats.recentLists}`));
    console.log(OmniZapColors.info(`   🔢 Contadores: ${stats.counters}`));
    console.log(OmniZapColors.info(`   🗝️  Total de chaves: ${stats.totalKeys}`));
    console.log(OmniZapColors.success(`   ✅ Cache hits: ${stats.hits}`));
    console.log(OmniZapColors.warning(`   ❌ Cache misses: ${stats.misses}`));
    console.log(OmniZapColors.primary(`   📈 Taxa de acerto: ${stats.hitRate}%`));
    console.log(OmniZapColors.gray(`   👥 JIDs únicos: ${stats.uniqueJids}`));

    if (stats.topJids.length > 0) {
      console.log(OmniZapColors.gray('   🏆 Top JIDs:'));
      stats.topJids.forEach(([jid, count], index) => {
        console.log(
          OmniZapColors.gray(`      ${index + 1}. ${jid.substring(0, 15)}... (${count} msgs)`),
        );
      });
    }
    console.log(OmniZapColors.primary('═══════════════════════════════════'));
  }
}, 30 * 60 * 1000); // 30 minutos

// Sistema de limpeza automática inteligente do cache
setInterval(() => {
  try {
    const stats = getCacheStats();
    const shouldClean =
      stats &&
      (stats.totalKeys > 2000 || // Muitas chaves
        stats.totalMessages > 1500 || // Muitas mensagens
        stats.hitRate < 30); // Taxa de acerto baixa

    if (shouldClean) {
      console.log(
        OmniZapColors.warning('🧹 OmniZap: Iniciando limpeza automática inteligente do cache...'),
      );

      // Remove mensagens mais antigas (mantém últimas 500)
      const allKeys = messagesCache.keys();
      const messageKeys = allKeys.filter((k) => k.startsWith('msg_'));

      if (messageKeys.length > 500) {
        // Obtém mensagens com timestamps para ordenação
        const messagesWithTimestamp = [];

        messageKeys.forEach((key) => {
          const msg = messagesCache.get(key);
          if (msg && msg._cacheTimestamp) {
            messagesWithTimestamp.push({
              key,
              timestamp: msg._cacheTimestamp,
              lastAccessed: msg._lastAccessed || msg._cacheTimestamp,
            });
          }
        });

        // Ordena por último acesso (menos acessadas primeiro)
        messagesWithTimestamp.sort((a, b) => a.lastAccessed - b.lastAccessed);

        // Remove as mais antigas
        const toRemove = messagesWithTimestamp.slice(0, messagesWithTimestamp.length - 500);
        let removedCount = 0;

        toRemove.forEach(({ key }) => {
          messagesCache.del(key);
          removedCount++;
        });

        console.log(
          OmniZapColors.success(`🧹 OmniZap: ${removedCount} mensagens antigas removidas`),
        );
      }

      // Limpa contadores antigos
      const counterKeys = allKeys.filter((k) => k.startsWith('count_'));
      if (counterKeys.length > 0) {
        counterKeys.forEach((key) => messagesCache.del(key));
        console.log(OmniZapColors.info(`🧹 OmniZap: ${counterKeys.length} contadores limpos`));
      }

      const newStats = getCacheStats();
      console.log(
        OmniZapColors.success(
          `✅ OmniZap: Limpeza concluída - ${newStats.totalKeys} chaves restantes`,
        ),
      );
    } else {
      console.log(OmniZapColors.gray('🧹 OmniZap: Cache em bom estado - limpeza não necessária'));
    }
  } catch (error) {
    console.error(OmniZapColors.error('🧹 OmniZap: Erro na limpeza automática:'), error);
  }
}, 2 * 60 * 60 * 1000); // 2 horas

// Backup das estatísticas do cache para análise (opcional)
setInterval(() => {
  try {
    const stats = getCacheStats();
    if (stats) {
      const backup = {
        timestamp: new Date().toISOString(),
        stats: stats,
        uptime: process.uptime(),
      };

      // Salva estatísticas para análise futura
      messagesCache.set('cache_stats_backup', backup, 86400); // 24 horas
      console.log(OmniZapColors.gray('💾 OmniZap: Backup de estatísticas salvo'));
    }
  } catch (error) {
    console.error(OmniZapColors.error('💾 OmniZap: Erro ao salvar backup de estatísticas:'), error);
  }
}, 60 * 60 * 1000); // 1 hora
