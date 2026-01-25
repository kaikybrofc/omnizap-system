import groupConfigStore from '../../store/groupConfigStore.js';
import logger from '../../utils/logger/loggerModule.js';
import { getGroupMetadata, getGroupInviteCode } from '../../config/groupUtils.js';
import { getJidUser } from '../../config/baileysConfig.js';
import { updateGroupParticipantsFromAction } from '../../services/groupMetadataService.js';

import fs from 'node:fs';
import path from 'node:path';
import moment from 'moment-timezone';

const replacePlaceholders = async (message, sock, groupId) => {
  logger.debug('Iniciando substituição de placeholders para a mensagem.', { groupId });
  let updatedMessage = message;
  const mentions = [];

  try {
    const metadata = await getGroupMetadata(sock, groupId);
    logger.debug('Metadados do grupo obtidos para substituição de placeholders.', {
      groupId,
      subject: metadata.subject,
    });

    if (updatedMessage.includes('@date')) {
      updatedMessage = updatedMessage.replace(/@date/g, moment().format('DD/MM/YYYY HH:mm:ss'));
    }

    if (updatedMessage.includes('@desc') && metadata.desc) {
      updatedMessage = updatedMessage.replace(/@desc/g, metadata.desc);
    }

    if (updatedMessage.includes('@admins') && metadata.participants) {
      const adminJids = metadata.participants
        .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
        .map((p) => p.id);

      const adminNames = adminJids.map((jid) => {
        const user = getJidUser(jid);
        if (user) mentions.push(jid);
        return user ? `@${user}` : 'Desconhecido';
      });
      updatedMessage = updatedMessage.replace(/@admins/g, adminNames.join(', '));
    }

    if (updatedMessage.includes('@groupname') && metadata.subject) {
      updatedMessage = updatedMessage.replace(/@groupname/g, metadata.subject);
    }

    if (updatedMessage.includes('@membercount') && metadata.participants) {
      updatedMessage = updatedMessage.replace(
        /@membercount/g,
        metadata.participants.length.toString(),
      );
    }

    if (updatedMessage.includes('@owner') && metadata.owner) {
      const ownerJid = metadata.owner;
      const ownerUser = getJidUser(ownerJid);
      if (ownerUser) {
        mentions.push(ownerJid);
        updatedMessage = updatedMessage.replace(/@owner/g, `@${ownerUser}`);
      } else {
        updatedMessage = updatedMessage.replace(/@owner/g, 'Desconhecido');
      }
    }

    if (updatedMessage.includes('@creationtime') && metadata.creation) {
      updatedMessage = updatedMessage.replace(
        /@creationtime/g,
        moment.unix(metadata.creation).format('DD/MM/YYYY HH:mm:ss'),
      );
    }

    if (updatedMessage.includes('@invitecode')) {
      try {
        const inviteCode = await getGroupInviteCode(sock, groupId);
        updatedMessage = updatedMessage.replace(/@invitecode/g, inviteCode);
      } catch (e) {
        logger.warn(
          `Não foi possível obter o código de convite para o grupo ${groupId}. O placeholder não será substituído.`,
          { error: e.message },
        );
        updatedMessage = updatedMessage.replace(
          /@invitecode/g,
          '[Código de convite não disponível]',
        );
      }
    }

    if (updatedMessage.includes('@isrestricted')) {
      updatedMessage = updatedMessage.replace(/@isrestricted/g, metadata.restrict ? 'Sim' : 'Não');
    }

    if (updatedMessage.includes('@isannounceonly')) {
      updatedMessage = updatedMessage.replace(
        /@isannounceonly/g,
        metadata.announce ? 'Sim' : 'Não',
      );
    }
  } catch (error) {
    logger.error(`Erro ao substituir placeholders para o grupo ${groupId}.`, {
      errorMessage: error.message,
      stack: error.stack,
    });
  }
  logger.debug('Substituição de placeholders finalizada.', { groupId });
  return { updatedMessage, mentions };
};

export const handleGroupUpdate = async (sock, groupId, participants, action) => {
  logger.debug('Iniciando tratamento de evento de atualização de grupo.', {
    groupId,
    participants,
    action,
  });

  try {
    try {
      await updateGroupParticipantsFromAction(groupId, participants, action);
    } catch (error) {
      logger.error('Erro ao atualizar participantes do grupo no banco.', {
        groupId,
        action,
        errorMessage: error.message,
        stack: error.stack,
      });
    }

    const groupConfig = await groupConfigStore.getGroupConfig(groupId);
    logger.debug('Configurações do grupo carregadas.', { groupId, config: groupConfig });

    let message = '';
    const allMentions = [];

    for (const participant of participants) {
      const jid =
        typeof participant === 'string'
          ? participant
          : participant?.id || participant?.jid || participant?.phoneNumber || '';

      const participantName = getJidUser(jid) || participant?.phoneNumber || 'user';

      if (jid) allMentions.push(jid);

      switch (action) {
        case 'add':
          if (groupConfig.welcomeMessageEnabled) {
            const welcomeMsg =
              groupConfig.welcomeMessage || '👋 Bem-vindo(a) ao grupo @groupname, @user! 🎉';
            let msg = welcomeMsg.replace('{participant}', `@${participantName}`);
            msg = msg.replace(/@user/g, `@${participantName}`);
            message += `${msg}\n`;
          }
          break;
        case 'remove':
          if (groupConfig.farewellMessageEnabled) {
            const farewellMsg =
              groupConfig.farewellMessage || '😥 Adeus, @user! Sentiremos sua falta.';
            let msg = farewellMsg.replace('{participant}', `@${participantName}`);
            msg = msg.replace(/@user/g, `@${participantName}`);
            message += `${msg}\n`;
          }
          break;
        case 'promote':
          if (groupConfig.welcomeMessageEnabled) {
            message += `O usuário @${participantName} foi promovido a administrador do grupo. 🎉\n`;
          }
          break;
        case 'demote':
          if (groupConfig.welcomeMessageEnabled) {
            message += `O usuário @${participantName} não é mais um administrador do grupo. ⬇️\n`;
          }
          break;
      }
    }

    if (message) {
      logger.debug('Mensagem de evento de grupo gerada.', { groupId, action, message });
      let messageOptions = {};
      let mediaPath = null;

      const { updatedMessage, mentions: groupMentions } = await replacePlaceholders(
        message,
        sock,
        groupId,
      );
      message = updatedMessage;

      const finalMentions = [...new Set([...allMentions, ...groupMentions])];
      logger.debug('Menções para a mensagem final processadas.', {
        groupId,
        finalMentionsCount: finalMentions.length,
      });

      if (action === 'add' && groupConfig.welcomeMedia) {
        mediaPath = groupConfig.welcomeMedia;
      } else if (action === 'remove' && groupConfig.farewellMedia) {
        mediaPath = groupConfig.farewellMedia;
      }

      if (mediaPath) {
        logger.info(`Tentando enviar mensagem com mídia para o grupo ${groupId}.`, {
          action,
          mediaPath,
        });
        const absoluteMediaPath = path.resolve(mediaPath);
        logger.debug(`Caminho absoluto da mídia resolvido: ${absoluteMediaPath}`);

        if (fs.existsSync(absoluteMediaPath)) {
          logger.info(
            `Arquivo de mídia encontrado em ${absoluteMediaPath}. Preparando para enviar.`,
          );
          const mediaType = absoluteMediaPath.endsWith('.mp4') ? 'video' : 'image';
          const mediaBuffer = fs.readFileSync(absoluteMediaPath);

          if (mediaType === 'image') {
            messageOptions = {
              image: mediaBuffer,
              caption: message.trim(),
              mentions: finalMentions,
            };
          } else if (mediaType === 'video') {
            messageOptions = {
              video: mediaBuffer,
              caption: message.trim(),
              mentions: finalMentions,
            };
          }
        } else {
          logger.warn(
            `Arquivo de mídia não encontrado em ${absoluteMediaPath} para o grupo ${groupId}. Ação: ${action}. Enviando apenas a mensagem de texto.`,
          );
          messageOptions = { text: message.trim(), mentions: finalMentions };
        }
      } else {
        logger.debug('Nenhuma mídia configurada para este evento. Enviando apenas texto.', {
          groupId,
          action,
        });
        messageOptions = { text: message.trim(), mentions: finalMentions };
      }
      await sock.sendMessage(groupId, messageOptions);
      logger.info(`Mensagem de atualização de grupo enviada com sucesso para o grupo ${groupId}.`, {
        action,
        participants,
      });
    } else {
      logger.debug('Nenhuma mensagem de evento de grupo para enviar.', { groupId, action });
    }
  } catch (error) {
    logger.error(`Erro ao tratar atualização de grupo para o grupo ${groupId}, ação ${action}:`, {
      errorMessage: error.message,
      stack: error.stack,
      error,
    });
  }
};
