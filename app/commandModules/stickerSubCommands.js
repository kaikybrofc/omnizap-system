/**
 * OmniZap Sticker Sub-Commands Module
 *
 * Módulo responsável pelos sub-comandos de gerenciamento de sticker packs
 *
 * @version 1.0.5
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('../utils/logger/loggerModule');
const { listUserPacks, getPackDetails, deletePack, renamePack, getUserStats, generateWhatsAppPack, getUserId, STICKERS_PER_PACK } = require('./stickerPackManager');
const { sendOmniZapMessage, sendTextMessage, sendStickerMessage, sendReaction, formatErrorMessage, formatSuccessMessage, formatHelpMessage } = require('../utils/messageUtils');
const { sendStickerPackWithRelay } = require('../utils/stickerPackSender');
const { COMMAND_PREFIX, RATE_LIMIT_CONFIG, EMOJIS } = require('../utils/constants');

/**
 * Processa sub-comandos do sticker
 */
async function processStickerSubCommand(subCommand, args, omniZapClient, messageInfo, senderJid, targetJid) {
  const userId = getUserId(senderJid, messageInfo);

  switch (subCommand.toLowerCase()) {
    case 'packs':
    case 'list':
      return await listPacks(userId);

    case 'stats':
    case 'status':
      return await showStats(userId);

    case 'info':
      return await showPackInfo(userId, args);

    case 'delete':
    case 'del':
      return await deletePackCommand(userId, args);

    case 'rename':
      return await renamePackCommand(userId, args);

    case 'send':
    case 'share':
      return await sendPackCommand(userId, args, omniZapClient, targetJid, messageInfo, senderJid);

    case 'help':
      return showStickerHelp();

    default:
      return {
        success: false,
        message: `❓ *Sub-comando desconhecido: ${subCommand}*\n\nUse \`${COMMAND_PREFIX}s help\` para ver todos os comandos disponíveis.`,
      };
  }
}

/**
 * Lista todos os packs do usuário
 */
async function listPacks(userId) {
  try {
    const packs = await listUserPacks(userId);

    if (packs.length === 0) {
      return {
        success: true,
        message: `📦 *Seus Sticker Packs*\n\n❌ Você ainda não possui nenhum pack de stickers.\n\n💡 *Como criar:*\nEnvie uma imagem ou vídeo com o comando \`/s\` para começar seu primeiro pack!`,
      };
    }

    let message = `📦 *Seus Sticker Packs* (${packs.length} pack${packs.length > 1 ? 's' : ''})\n\n`;

    packs.forEach((pack, index) => {
      const status = pack.isComplete ? '✅ Completo' : `⏳ ${pack.stickerCount}/${STICKERS_PER_PACK}`;
      const date = new Date(pack.createdAt).toLocaleDateString('pt-BR');

      message += `${index + 1}. **${pack.name}**\n`;
      message += `   👤 ${pack.author}\n`;
      message += `   📊 ${status}\n`;
      message += `   📅 ${date}\n\n`;
    });

    message += `💡 *Comandos úteis:*\n`;
    message += `• \`${COMMAND_PREFIX}s info [número]\` - Ver detalhes\n`;
    message += `• \`${COMMAND_PREFIX}s send [número]\` - Enviar pack\n`;
    message += `• \`${COMMAND_PREFIX}s stats\` - Ver estatísticas`;

    return {
      success: true,
      message: message,
    };
  } catch (error) {
    logger.error('[StickerSubCommands] Erro ao listar packs:', error);
    return {
      success: false,
      message: '❌ Erro ao carregar seus packs. Tente novamente.',
    };
  }
}

/**
 * Mostra estatísticas do usuário
 */
async function showStats(userId) {
  try {
    const stats = await getUserStats(userId);

    const createdDate = new Date(stats.createdAt).toLocaleDateString('pt-BR');
    const updatedDate = new Date(stats.lastUpdated).toLocaleDateString('pt-BR');

    let message = `📊 *Suas Estatísticas de Stickers*\n\n`;
    message += `🎯 **Total de Stickers:** ${stats.totalStickers}\n`;
    message += `📦 **Total de Packs:** ${stats.totalPacks}\n`;
    message += `✅ **Packs Completos:** ${stats.completePacks}\n`;
    message += `⏳ **Packs Incompletos:** ${stats.incompletePacks}\n\n`;

    if (stats.totalPacks > 0) {
      message += `🔄 **Pack Atual:** Pack ${stats.currentPackIndex + 1}\n`;
      message += `📈 **Progresso:** ${stats.currentPackStickers}/${STICKERS_PER_PACK} stickers\n`;
      message += `🎯 **Restam:** ${stats.stickerSlotsRemaining} slots\n\n`;
    }

    message += `📅 **Criado em:** ${createdDate}\n`;
    message += `🔄 **Atualizado em:** ${updatedDate}`;

    return {
      success: true,
      message: message,
    };
  } catch (error) {
    logger.error('[StickerSubCommands] Erro ao obter stats:', error);
    return {
      success: false,
      message: '❌ Erro ao carregar estatísticas. Tente novamente.',
    };
  }
}

/**
 * Mostra informações de um pack específico
 */
async function showPackInfo(userId, args) {
  if (!args || !args.trim()) {
    return {
      success: false,
      message: `❌ *Número do pack não informado*\n\nUso: \`${COMMAND_PREFIX}s info [número]\`\n\nExemplo: \`${COMMAND_PREFIX}s info 1\``,
    };
  }

  const packNumber = parseInt(args.trim()) - 1;

  if (isNaN(packNumber) || packNumber < 0) {
    return {
      success: false,
      message: `❌ *Número inválido*\n\nInforme um número válido do pack.\n\nUse \`${COMMAND_PREFIX}s packs\` para ver todos os seus packs.`,
    };
  }

  try {
    const pack = await getPackDetails(userId, packNumber);

    if (!pack) {
      return {
        success: false,
        message: `❌ *Pack ${packNumber + 1} não encontrado*\n\nUse \`${COMMAND_PREFIX}s packs\` para ver seus packs disponíveis.`,
      };
    }

    const createdDate = new Date(pack.createdAt).toLocaleDateString('pt-BR');
    const status = pack.isComplete ? '✅ Completo' : `⏳ Em progresso (${pack.stickers.length}/${STICKERS_PER_PACK})`;

    let message = `📦 *Detalhes do Pack ${packNumber + 1}*\n\n`;
    message += `📛 **Nome:** ${pack.name}\n`;
    message += `👤 **Autor:** ${pack.author}\n`;
    message += `🔢 **ID:** ${pack.packId}\n`;
    message += `📊 **Status:** ${status}\n`;
    message += `🎯 **Stickers:** ${pack.stickers.length}/${STICKERS_PER_PACK}\n`;
    message += `📅 **Criado:** ${createdDate}\n\n`;

    if (pack.isComplete) {
      message += `✅ **Pack completo e pronto!**\n`;
      message += `Use \`${COMMAND_PREFIX}s send ${packNumber + 1}\` para compartilhar\n\n`;
    } else {
      const remaining = STICKERS_PER_PACK - pack.stickers.length;
      message += `⏳ **Pack em progresso (${remaining} slots livres)**\n`;
      message += `Você pode enviar mesmo assim ou continuar adicionando stickers\n\n`;
    }

    message += `🛠️ **Comandos úteis:**\n`;
    message += `• \`${COMMAND_PREFIX}s send ${packNumber + 1}\` - Enviar pack ${pack.isComplete ? '(completo)' : '(incompleto)'}\n`;
    message += `• \`${COMMAND_PREFIX}s rename ${packNumber + 1} [novo nome]\` - Renomear\n`;
    message += `• \`${COMMAND_PREFIX}s delete ${packNumber + 1}\` - Deletar pack`;

    return {
      success: true,
      message: message,
    };
  } catch (error) {
    logger.error('[StickerSubCommands] Erro ao obter info do pack:', error);
    return {
      success: false,
      message: '❌ Erro ao carregar informações do pack. Tente novamente.',
    };
  }
}

/**
 * Deleta um pack
 */
async function deletePackCommand(userId, args) {
  if (!args || !args.trim()) {
    return {
      success: false,
      message: `❌ *Número do pack não informado*\n\nUso: \`${COMMAND_PREFIX}s delete [número]\`\n\nExemplo: \`${COMMAND_PREFIX}s delete 2\``,
    };
  }

  const packNumber = parseInt(args.trim()) - 1;

  if (isNaN(packNumber) || packNumber < 0) {
    return {
      success: false,
      message: '❌ *Número inválido*\n\nInforme um número válido do pack.',
    };
  }

  try {
    const pack = await getPackDetails(userId, packNumber);

    if (!pack) {
      return {
        success: false,
        message: `❌ *Pack ${packNumber + 1} não encontrado*`,
      };
    }

    const deleted = await deletePack(userId, packNumber);

    if (deleted) {
      return {
        success: true,
        message: `✅ *Pack deletado com sucesso!*\n\n📦 **"${pack.name}"** foi removido\n🗑️ ${pack.stickers.length} stickers deletados`,
      };
    } else {
      return {
        success: false,
        message: '❌ Erro ao deletar o pack. Tente novamente.',
      };
    }
  } catch (error) {
    logger.error('[StickerSubCommands] Erro ao deletar pack:', error);
    return {
      success: false,
      message: '❌ Erro ao deletar pack. Tente novamente.',
    };
  }
}

/**
 * Renomeia um pack
 */
async function renamePackCommand(userId, args) {
  if (!args || !args.trim()) {
    return {
      success: false,
      message: `❌ *Parâmetros não informados*\n\nUso: \`${COMMAND_PREFIX}s rename [número] [novo nome] | [novo autor]\`\n\nExemplo: \`${COMMAND_PREFIX}s rename 1 Meus Stickers | João Silva\``,
    };
  }

  const parts = args.trim().split(' ');
  const packNumber = parseInt(parts[0]) - 1;

  if (isNaN(packNumber) || packNumber < 0) {
    return {
      success: false,
      message: '❌ *Número do pack inválido*',
    };
  }

  const restOfArgs = parts.slice(1).join(' ');
  const [newName, newAuthor] = restOfArgs.split('|').map((s) => s.trim());

  if (!newName) {
    return {
      success: false,
      message: `❌ *Novo nome não informado*\n\nUso: \`${COMMAND_PREFIX}s rename [número] [novo nome] | [novo autor]\``,
    };
  }

  try {
    const pack = await getPackDetails(userId, packNumber);

    if (!pack) {
      return {
        success: false,
        message: `❌ *Pack ${packNumber + 1} não encontrado*`,
      };
    }

    const renamed = await renamePack(userId, packNumber, newName, newAuthor);

    if (renamed) {
      let message = `✅ *Pack renomeado com sucesso!*\n\n`;
      message += `📦 **Pack ${packNumber + 1}**\n`;
      message += `📛 **Novo nome:** ${newName}\n`;
      if (newAuthor) {
        message += `👤 **Novo autor:** ${newAuthor}`;
      }

      return {
        success: true,
        message: message,
      };
    } else {
      return {
        success: false,
        message: '❌ Erro ao renomear o pack. Tente novamente.',
      };
    }
  } catch (error) {
    logger.error('[StickerSubCommands] Erro ao renomear pack:', error);
    return {
      success: false,
      message: '❌ Erro ao renomear pack. Tente novamente.',
    };
  }
}

/**
 * Envia stickers do pack individualmente
 */
async function sendStickerPack(omniZapClient, userJid, pack, messageInfo) {
  try {
    const fs = require('fs').promises;

    // Valida stickers disponíveis
    const validStickers = [];
    for (const sticker of pack.stickers) {
      try {
        await fs.access(sticker.filePath);
        validStickers.push(sticker);
        logger.debug(`[StickerSubCommands] Sticker validado: ${sticker.fileName}`);
      } catch (error) {
        logger.warn(`[StickerSubCommands] Sticker inacessível: ${sticker.fileName}`);
      }
    }

    if (validStickers.length === 0) {
      throw new Error('Nenhum sticker válido encontrado no pack');
    }

    logger.info(`[StickerSubCommands] Enviando ${validStickers.length} stickers individualmente`);

    // Envia notificação inicial
    const packIntro = `${EMOJIS.PACK} *${pack.name}*\n👤 Por: ${pack.author}\n🎯 ${validStickers.length} stickers\n\n✨ *Enviando stickers...*`;

    await sendTextMessage(omniZapClient, userJid, packIntro, {
      originalMessage: messageInfo,
    });

    // Configurações de envio usando constantes
    let sentCount = 0;
    const { BATCH_SIZE, DELAY_BETWEEN_STICKERS, DELAY_BETWEEN_BATCHES } = RATE_LIMIT_CONFIG;

    for (let i = 0; i < validStickers.length; i += BATCH_SIZE) {
      const batch = validStickers.slice(i, i + BATCH_SIZE);

      logger.debug(`[StickerSubCommands] Enviando lote ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validStickers.length / BATCH_SIZE)}`);

      for (const sticker of batch) {
        try {
          await sendStickerMessage(omniZapClient, userJid, sticker.filePath);
          sentCount++;

          logger.debug(`[StickerSubCommands] Sticker enviado: ${sticker.fileName} (${sentCount}/${validStickers.length})`);

          // Delay entre stickers
          if (sentCount < validStickers.length) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_STICKERS));
          }
        } catch (stickerError) {
          logger.warn(`[StickerSubCommands] Falha no envio: ${sticker.fileName} - ${stickerError.message}`);
        }
      }

      // Delay entre lotes
      if (i + BATCH_SIZE < validStickers.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    // Mensagem final usando utilitário
    const successMsg = formatSuccessMessage('Pack enviado com sucesso!', `${EMOJIS.PACK} **${pack.name}**\n📨 ${sentCount}/${validStickers.length} stickers entregues`, 'Adicione os stickers aos seus favoritos para acesso rápido!');

    await sendTextMessage(omniZapClient, userJid, successMsg);

    logger.info(`[StickerSubCommands] Pack enviado com sucesso: ${pack.name}`, {
      packId: pack.packId,
      totalStickers: validStickers.length,
      sentStickers: sentCount,
      targetJid: userJid,
      successRate: `${((sentCount / validStickers.length) * 100).toFixed(1)}%`,
    });

    return true;
  } catch (error) {
    logger.error(`[StickerSubCommands] Erro ao enviar pack: ${error.message}`, {
      error: error.stack,
      packId: pack?.packId || 'unknown',
      targetJid: userJid,
    });
    throw error;
  }
}

/**
 * Envia um pack como sticker pack do WhatsApp
 */
async function sendPackCommand(userId, args, omniZapClient, targetJid, messageInfo, senderJid) {
  if (!args || !args.trim()) {
    return {
      success: false,
      message: `❌ *Número do pack não informado*\n\nUso: \`${COMMAND_PREFIX}s send [número]\`\n\nExemplo: \`${COMMAND_PREFIX}s send 1\``,
    };
  }

  const packNumber = parseInt(args.trim()) - 1;

  if (isNaN(packNumber) || packNumber < 0) {
    return {
      success: false,
      message: '❌ *Número inválido*',
    };
  }

  try {
    const pack = await getPackDetails(userId, packNumber);

    if (!pack) {
      return {
        success: false,
        message: `❌ *Pack ${packNumber + 1} não encontrado*`,
      };
    }

    if (pack.stickers.length === 0) {
      return {
        success: false,
        message: `❌ *Pack vazio*\n\n⚠️ O pack "${pack.name}" não possui stickers.\n\n💡 Adicione pelo menos um sticker antes de enviar!`,
      };
    }

    // Determinar status do pack
    const isComplete = pack.isComplete;
    const stickerCount = pack.stickers.length;
    const statusMsg = isComplete ? `✅ Pack completo (${stickerCount}/${STICKERS_PER_PACK} stickers)` : `⏳ Pack incompleto (${stickerCount}/${STICKERS_PER_PACK} stickers)`;

    // Determina o JID do usuário (sempre envia no privado)
    let userJid = senderJid;

    // Se o comando foi executado em grupo, extrai o JID do participante
    if (senderJid.endsWith('@g.us')) {
      // Verifica múltiplas fontes para encontrar o JID do usuário
      userJid = messageInfo?.key?.participant || messageInfo?.participant || messageInfo?.sender || messageInfo?.from;

      // Se ainda não encontrou, tenta extrair do pushName ou outras propriedades
      if (!userJid || userJid.endsWith('@g.us')) {
        logger.warn('[StickerSubCommands] Não foi possível extrair JID do usuário do grupo', {
          senderJid,
          messageInfo: messageInfo?.key,
        });
        return {
          success: false,
          message: '❌ *Erro interno*\n\nNão foi possível identificar seu número para envio do pack. Tente usar o comando em seu chat privado com o bot.',
        };
      }
    }

    // Validação final do JID
    if (!userJid || !userJid.includes('@')) {
      logger.error('[StickerSubCommands] JID do usuário inválido', {
        senderJid,
        extractedJid: userJid,
        messageInfo: messageInfo?.key,
      });
      return {
        success: false,
        message: '❌ *Erro interno*\n\nNão foi possível identificar seu número. Tente usar o comando em seu chat privado com o bot.',
      };
    }

    // Se o comando foi executado em grupo, informa que será enviado no privado
    const isGroupCommand = targetJid.endsWith('@g.us');
    const privateNotification = isGroupCommand ? '\n\n📱 *Nota:* O pack foi enviado em seu chat privado para melhor experiência!' : '';

    logger.info(`[StickerSubCommands] Enviando pack ${packNumber + 1} para usuário`, {
      packName: pack.name,
      stickerCount: pack.stickers.length,
      isComplete: pack.isComplete,
      originalSender: senderJid,
      originalTarget: targetJid,
      finalUserTarget: userJid,
      isGroupCommand: isGroupCommand,
      commandSource: isGroupCommand ? 'grupo' : 'privado',
      deliveryTarget: 'privado do usuário',
    });

    // Envia pack de stickers usando o novo sistema
    try {
      // Se comando foi executado em grupo, notifica no grupo antes de enviar no privado
      if (isGroupCommand) {
        await sendTextMessage(omniZapClient, targetJid, `${EMOJIS.PACK} *Enviando pack "${pack.name}" para seu chat privado...*\n\n✨ Aguarde alguns segundos para receber todos os stickers em seu chat privado!`, { originalMessage: messageInfo });
      }

      // Envia pack usando o novo sistema com relayMessage
      await sendStickerPackWithRelay(omniZapClient, userJid, pack, {
        batchSize: RATE_LIMIT_CONFIG.BATCH_SIZE,
        delayBetweenStickers: RATE_LIMIT_CONFIG.DELAY_BETWEEN_STICKERS,
        delayBetweenBatches: RATE_LIMIT_CONFIG.DELAY_BETWEEN_BATCHES,
      });

      return {
        success: true,
        message: formatSuccessMessage('Pack compartilhado com sucesso!', `📛 **${pack.name}**\n👤 ${pack.author}\n${statusMsg}\n\n${EMOJIS.SUCCESS} Os stickers foram enviados em seu chat privado e estão prontos para uso!`, `Você pode adicionar os stickers à sua coleção de favoritos para acesso rápido.${privateNotification}`),
      };
    } catch (sendError) {
      logger.error(`[StickerSubCommands] Erro específico no envio do pack: ${sendError.message}`, {
        packId: pack.packId,
        error: sendError.stack,
      });

      return {
        success: false,
        message: `❌ *Erro ao enviar pack*\n\n⚠️ Não foi possível enviar o pack "${pack.name}" em seu chat privado.\n\n🔧 **Possíveis causas:**\n• Arquivos de sticker corrompidos\n• Problemas de conectividade\n• Pack muito grande\n• Limitações da API do WhatsApp\n\n💡 **Soluções:**\n• Tente novamente em alguns minutos\n• Verifique se todos os stickers estão válidos\n• Considere recriar o pack se o problema persistir\n\n🆕 **Novo sistema de envio:** Agora usando relayMessage com proto para melhor compatibilidade!`,
      };
    }
  } catch (error) {
    logger.error('[StickerSubCommands] Erro ao enviar pack:', error);
    return {
      success: false,
      message: '❌ Erro ao enviar pack. Tente novamente.',
    };
  }
}

/**
 * Mostra ajuda dos comandos de sticker
 */
function showStickerHelp() {
  const commands = [
    {
      name: 's',
      description: 'Criar sticker da mídia',
      example: 's Meu Pack | João',
    },
    {
      name: 's packs',
      description: 'Listar seus packs',
      example: 's packs',
    },
    {
      name: 's stats',
      description: 'Ver estatísticas',
      example: 's stats',
    },
    {
      name: 's info [número]',
      description: 'Detalhes do pack',
      example: 's info 1',
    },
    {
      name: 's rename [nº] [nome] | [autor]',
      description: 'Renomear pack',
      example: 's rename 1 Meus Stickers | João Silva',
    },
    {
      name: 's delete [número]',
      description: 'Deletar pack',
      example: 's delete 2',
    },
    {
      name: 's send [número]',
      description: 'Enviar pack (completo ou não)',
      example: 's send 1',
    },
  ];

  const footer = `**ℹ️ Informações:**\n• Cada pack comporta até ${STICKERS_PER_PACK} stickers\n• Packs são criados automaticamente\n• Packs podem ser enviados mesmo incompletos\n• Novos packs são criados ao atingir ${STICKERS_PER_PACK} stickers\n\n**💡 Exemplo completo:**\n1. Envie mídia: \`${COMMAND_PREFIX}s Meu Pack | João\`\n2. Continue adicionando stickers\n3. Envie quando quiser: \`${COMMAND_PREFIX}s send 1\``;

  const message = formatHelpMessage('Comandos de Sticker Packs', commands, footer);

  return {
    success: true,
    message: message,
  };
}

module.exports = {
  processStickerSubCommand,
};
