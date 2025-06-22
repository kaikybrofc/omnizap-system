/**
 * OmniZap Sticker Sub-Commands Module
 *
 * Módulo responsável pelos sub-comandos de gerenciamento de sticker packs
 *
 * @version 1.0.4
 * @author OmniZap Team
 * @license MIT
 */

const logger = require('../utils/logger/loggerModule');
const { listUserPacks, getPackDetails, deletePack, renamePack, getUserStats, generateWhatsAppPack, getUserId, STICKERS_PER_PACK } = require('./stickerPackManager');

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
        message: `❓ *Sub-comando desconhecido: ${subCommand}*\n\nUse \`/s help\` para ver todos os comandos disponíveis.`,
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
    message += `• \`/s info [número]\` - Ver detalhes\n`;
    message += `• \`/s send [número]\` - Enviar pack\n`;
    message += `• \`/s stats\` - Ver estatísticas`;

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
      message: '❌ *Número do pack não informado*\n\nUso: `/s info [número]`\n\nExemplo: `/s info 1`',
    };
  }

  const packNumber = parseInt(args.trim()) - 1;

  if (isNaN(packNumber) || packNumber < 0) {
    return {
      success: false,
      message: '❌ *Número inválido*\n\nInforme um número válido do pack.\n\nUse `/s packs` para ver todos os seus packs.',
    };
  }

  try {
    const pack = await getPackDetails(userId, packNumber);

    if (!pack) {
      return {
        success: false,
        message: `❌ *Pack ${packNumber + 1} não encontrado*\n\nUse \`/s packs\` para ver seus packs disponíveis.`,
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
      message += `Use \`/s send ${packNumber + 1}\` para compartilhar\n\n`;
    } else {
      const remaining = STICKERS_PER_PACK - pack.stickers.length;
      message += `⏳ **Pack em progresso (${remaining} slots livres)**\n`;
      message += `Você pode enviar mesmo assim ou continuar adicionando stickers\n\n`;
    }

    message += `🛠️ **Comandos úteis:**\n`;
    message += `• \`/s send ${packNumber + 1}\` - Enviar pack ${pack.isComplete ? '(completo)' : '(incompleto)'}\n`;
    message += `• \`/s rename ${packNumber + 1} [novo nome]\` - Renomear\n`;
    message += `• \`/s delete ${packNumber + 1}\` - Deletar pack`;

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
      message: '❌ *Número do pack não informado*\n\nUso: `/s delete [número]`\n\nExemplo: `/s delete 2`',
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
      message: '❌ *Parâmetros não informados*\n\nUso: `/s rename [número] [novo nome] | [novo autor]`\n\nExemplo: `/s rename 1 Meus Stickers | João Silva`',
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
      message: '❌ *Novo nome não informado*\n\nUso: `/s rename [número] [novo nome] | [novo autor]`',
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
    const packIntro = `📦 *${pack.name}*\n👤 Por: ${pack.author}\n🎯 ${validStickers.length} stickers\n\n✨ *Enviando stickers...*`;

    await omniZapClient.sendMessage(
      userJid,
      {
        text: packIntro,
      },
      {
        quoted: messageInfo,
      },
    );

    // Configurações de envio
    let sentCount = 0;
    const batchSize = 3; // Lotes de 3 stickers
    const delayBetweenStickers = 600; // Delay entre stickers
    const delayBetweenBatches = 1800; // Delay entre lotes

    for (let i = 0; i < validStickers.length; i += batchSize) {
      const batch = validStickers.slice(i, i + batchSize);

      logger.debug(`[StickerSubCommands] Enviando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(validStickers.length / batchSize)}`);

      for (const sticker of batch) {
        try {
          await omniZapClient.sendMessage(userJid, {
            sticker: { url: sticker.filePath },
          });
          sentCount++;

          logger.debug(`[StickerSubCommands] Sticker enviado: ${sticker.fileName} (${sentCount}/${validStickers.length})`);

          // Delay entre stickers
          if (sentCount < validStickers.length) {
            await new Promise((resolve) => setTimeout(resolve, delayBetweenStickers));
          }
        } catch (stickerError) {
          logger.warn(`[StickerSubCommands] Falha no envio: ${sticker.fileName} - ${stickerError.message}`);
        }
      }

      // Delay entre lotes
      if (i + batchSize < validStickers.length) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
      }
    }

    // Mensagem final
    const successMsg = `✅ *Pack enviado com sucesso!*\n\n📦 **${pack.name}**\n📨 ${sentCount}/${validStickers.length} stickers entregues\n\n💡 *Dica:* Adicione os stickers aos seus favoritos para acesso rápido!`;

    await omniZapClient.sendMessage(userJid, {
      text: successMsg,
    });

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
      message: '❌ *Número do pack não informado*\n\nUso: `/s send [número]`\n\nExemplo: `/s send 1`',
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

    // Enviar pack de stickers
    try {
      // Se comando foi executado em grupo, notifica no grupo antes de enviar no privado
      if (isGroupCommand) {
        await omniZapClient.sendMessage(
          targetJid,
          {
            text: `📦 *Enviando pack "${pack.name}" para seu chat privado...*\n\n✨ Aguarde alguns segundos para receber todos os stickers em seu chat privado!`,
          },
          {
            quoted: messageInfo,
          },
        );
      }

      // Envia pack de stickers no privado do usuário
      await sendStickerPack(omniZapClient, userJid, pack, messageInfo);

      return {
        success: true,
        message: `📦 *Pack compartilhado com sucesso!*\n\n📛 **${pack.name}**\n👤 ${pack.author}\n${statusMsg}\n\n✅ Os stickers foram enviados em seu chat privado e estão prontos para uso!\n\n💡 *Dica:* Você pode adicionar os stickers à sua coleção de favoritos para acesso rápido.${privateNotification}`,
      };
    } catch (sendError) {
      logger.error(`[StickerSubCommands] Erro específico no envio do pack: ${sendError.message}`, {
        packId: pack.packId,
        error: sendError.stack,
      });

      return {
        success: false,
        message: `❌ *Erro ao enviar pack*\n\n⚠️ Não foi possível enviar o pack "${pack.name}" em seu chat privado.\n\n🔧 **Possíveis causas:**\n• Arquivos de sticker corrompidos\n• Problemas de conectividade\n• Pack muito grande\n\n💡 **Soluções:**\n• Tente novamente em alguns minutos\n• Verifique se todos os stickers estão válidos\n• Considere recriar o pack se o problema persistir`,
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
  const message = `🎯 *Comandos de Sticker Packs*\n\n` + `**📦 Gerenciar Packs:**\n` + `• \`/s\` - Criar sticker da mídia\n` + `• \`/s packs\` - Listar seus packs\n` + `• \`/s stats\` - Ver estatísticas\n` + `• \`/s info [número]\` - Detalhes do pack\n\n` + `**🛠️ Editar Packs:**\n` + `• \`/s rename [nº] [nome] | [autor]\` - Renomear\n` + `• \`/s delete [número]\` - Deletar pack\n\n` + `**📤 Compartilhar:**\n` + `• \`/s send [número]\` - Enviar pack (completo ou não)\n\n` + `**ℹ️ Informações:**\n` + `• Cada pack comporta até ${STICKERS_PER_PACK} stickers\n` + `• Packs são criados automaticamente\n` + `• Packs podem ser enviados mesmo incompletos\n` + `• Novos packs são criados ao atingir ${STICKERS_PER_PACK} stickers\n\n` + `**💡 Exemplo de uso:**\n` + `1. Envie mídia: \`/s Meu Pack | João\`\n` + `2. Continue adicionando stickers\n` + `3. Envie quando quiser: \`/s send 1\``;

  return {
    success: true,
    message: message,
  };
}

module.exports = {
  processStickerSubCommand,
};
