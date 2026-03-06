import groupConfigStore from '../../store/groupConfigStore.js';
import logger from '../../../utils/logger/loggerModule.js';
import { getGroupMetadata, getGroupInviteCode, getGroupRequestParticipantsList, updateGroupRequestParticipants } from '../../config/groupUtils.js';
import { getJidUser, isSameJidUser, resolveBotJid } from '../../config/baileysConfig.js';
import { updateGroupParticipantsFromAction } from '../../services/groupMetadataService.js';
import { CAPTCHA_TIMEOUT_MINUTES, clearCaptchaForUser, registerCaptchaChallenge } from '../../services/captchaService.js';

import fs from 'node:fs';
import path from 'node:path';
import moment from 'moment-timezone';
import { sendAndStore } from '../../services/messagePersistenceService.js';

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
      const adminJids = metadata.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').map((p) => p.id);

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
      updatedMessage = updatedMessage.replace(/@membercount/g, metadata.participants.length.toString());
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
      updatedMessage = updatedMessage.replace(/@creationtime/g, moment.unix(metadata.creation).format('DD/MM/YYYY HH:mm:ss'));
    }

    if (updatedMessage.includes('@invitecode')) {
      try {
        const inviteCode = await getGroupInviteCode(sock, groupId);
        updatedMessage = updatedMessage.replace(/@invitecode/g, inviteCode);
      } catch (e) {
        logger.warn(`Não foi possível obter o código de convite para o grupo ${groupId}. O placeholder não será substituído.`, { error: e.message });
        updatedMessage = updatedMessage.replace(/@invitecode/g, '[Código de convite não disponível]');
      }
    }

    if (updatedMessage.includes('@isrestricted')) {
      updatedMessage = updatedMessage.replace(/@isrestricted/g, metadata.restrict ? 'Sim' : 'Não');
    }

    if (updatedMessage.includes('@isannounceonly')) {
      updatedMessage = updatedMessage.replace(/@isannounceonly/g, metadata.announce ? 'Sim' : 'Não');
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

const buildCaptchaLine = (participantName) => `\n🤖 *Verificação humana*\n@${participantName}, reaja a esta mensagem ou envie qualquer mensagem em até *${CAPTCHA_TIMEOUT_MINUTES} minutos* para continuar no grupo.\n\n`;

const ACTIONS_TO_SKIP_AUTO_APPROVE = new Set(['reject', 'rejected', 'cancel', 'canceled', 'approve', 'approved', 'accept', 'accepted', 'remove', 'removed']);

const shouldAutoApproveAction = (action) => {
  if (!action) return true;
  return !ACTIONS_TO_SKIP_AUTO_APPROVE.has(action);
};

const normalizeParticipantsInput = (participants) => {
  if (Array.isArray(participants)) return participants.filter(Boolean);
  if (!participants) return [];
  return [participants];
};

const resolveParticipantJid = (participant) => {
  if (!participant) return '';
  if (typeof participant === 'string') return participant;
  return participant.id || participant.jid || participant.participant || participant.participantAlt || participant.lid || participant.phoneNumber || '';
};

const extractJoinRequestParticipants = (payload) => {
  const rawParticipants = [];

  if (payload?.participant) rawParticipants.push(payload.participant);
  if (payload?.participants && Array.isArray(payload.participants)) {
    rawParticipants.push(...payload.participants);
  }
  if (payload?.participantsJids && Array.isArray(payload.participantsJids)) {
    rawParticipants.push(...payload.participantsJids);
  }

  const participants = rawParticipants
    .map((participant) => {
      if (!participant) return null;
      if (typeof participant === 'string') return participant;
      return participant.id || participant.jid || participant.participant || participant.participantAlt || participant.lid || null;
    })
    .filter(Boolean);

  return Array.from(new Set(participants));
};

export const handleGroupUpdate = async (sock, groupId, participants, action) => {
  const normalizedParticipants = normalizeParticipantsInput(participants);
  const normalizedAction = String(action || '')
    .trim()
    .toLowerCase();

  logger.debug('Iniciando tratamento de evento de atualização de grupo.', {
    groupId,
    participants: normalizedParticipants,
    action: normalizedAction,
  });

  try {
    try {
      await updateGroupParticipantsFromAction(groupId, normalizedParticipants, normalizedAction);
    } catch (error) {
      logger.error('Erro ao atualizar participantes do grupo no banco.', {
        groupId,
        action: normalizedAction,
        errorMessage: error.message,
        stack: error.stack,
      });
    }

    const groupConfig = await groupConfigStore.getGroupConfig(groupId);
    logger.debug('Configurações do grupo carregadas.', { groupId, config: groupConfig });

    let message = '';
    const allMentions = [];
    const captchaParticipants = [];
    const captchaEnabled = Boolean(groupConfig.captchaEnabled);
    const botJid = resolveBotJid(sock?.user?.id);

    for (const participant of normalizedParticipants) {
      const jid = resolveParticipantJid(participant);

      const participantName = getJidUser(jid) || participant?.phoneNumber || 'user';

      if (jid) allMentions.push(jid);

      switch (normalizedAction) {
        case 'add':
          {
            const shouldRequestCaptcha = captchaEnabled && jid && (!botJid || !isSameJidUser(jid, botJid));

            if (shouldRequestCaptcha) {
              captchaParticipants.push(jid);
            }

            if (groupConfig.welcomeMessageEnabled) {
              const welcomeMsg = groupConfig.welcomeMessage || '👋 Bem-vindo(a) ao grupo @groupname, @user! 🎉';
              let msg = welcomeMsg.replace('{participant}', `@${participantName}`);
              msg = msg.replace(/@user/g, `@${participantName}`);
              if (shouldRequestCaptcha) {
                msg = `${buildCaptchaLine(participantName)}\n${msg}`;
              }
              message += `${msg}\n`;
            } else if (shouldRequestCaptcha) {
              message += `${buildCaptchaLine(participantName)}\n`;
            }
          }
          break;
        case 'remove':
          if (jid) {
            clearCaptchaForUser(groupId, jid, 'remove');
          }
          if (groupConfig.farewellMessageEnabled) {
            const farewellMsg = groupConfig.farewellMessage || '😥 Adeus, @user! Sentiremos sua falta.';
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
      logger.debug('Mensagem de evento de grupo gerada.', { groupId, action: normalizedAction, message });
      let messageOptions = {};
      let mediaPath = null;

      const { updatedMessage, mentions: groupMentions } = await replacePlaceholders(message, sock, groupId);
      message = updatedMessage;
      const captchaMessageText = message.trim();

      const finalMentions = [...new Set([...allMentions, ...groupMentions])];
      logger.debug('Menções para a mensagem final processadas.', {
        groupId,
        finalMentionsCount: finalMentions.length,
      });

      if (normalizedAction === 'add' && groupConfig.welcomeMedia && groupConfig.welcomeMessageEnabled) {
        mediaPath = groupConfig.welcomeMedia;
      } else if (normalizedAction === 'remove' && groupConfig.farewellMedia) {
        mediaPath = groupConfig.farewellMedia;
      }

      if (mediaPath) {
        logger.info(`Tentando enviar mensagem com mídia para o grupo ${groupId}.`, {
          action: normalizedAction,
          mediaPath,
        });
        const absoluteMediaPath = path.resolve(mediaPath);
        logger.debug(`Caminho absoluto da mídia resolvido: ${absoluteMediaPath}`);

        if (fs.existsSync(absoluteMediaPath)) {
          logger.info(`Arquivo de mídia encontrado em ${absoluteMediaPath}. Preparando para enviar.`);
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
          logger.warn(`Arquivo de mídia não encontrado em ${absoluteMediaPath} para o grupo ${groupId}. Ação: ${normalizedAction}. Enviando apenas a mensagem de texto.`);
          messageOptions = { text: message.trim(), mentions: finalMentions };
        }
      } else {
        logger.debug('Nenhuma mídia configurada para este evento. Enviando apenas texto.', {
          groupId,
          action: normalizedAction,
        });
        messageOptions = { text: message.trim(), mentions: finalMentions };
      }
      const sentMessage = await sendAndStore(sock, groupId, messageOptions);
      if (normalizedAction === 'add' && captchaEnabled && captchaParticipants.length > 0 && sentMessage?.key) {
        for (const participantJid of captchaParticipants) {
          registerCaptchaChallenge({
            groupId,
            participantJid,
            messageKey: sentMessage.key,
            messageText: captchaMessageText,
            messageMentions: finalMentions,
          });
        }
      }
      logger.info(`Mensagem de atualização de grupo enviada com sucesso para o grupo ${groupId}.`, {
        action: normalizedAction,
        participants: normalizedParticipants,
      });
    } else {
      logger.debug('Nenhuma mensagem de evento de grupo para enviar.', { groupId, action: normalizedAction });
    }
  } catch (error) {
    logger.error(`Erro ao tratar atualização de grupo para o grupo ${groupId}, ação ${normalizedAction}:`, {
      errorMessage: error.message,
      stack: error.stack,
      error,
    });
  }
};

export const handleGroupJoinRequest = async (sock, update) => {
  const groupId = update?.id || update?.groupId || update?.jid;
  const action = typeof update?.action === 'string' ? update.action.toLowerCase() : '';

  logger.debug('Iniciando tratamento de solicitação de entrada no grupo.', {
    groupId,
    action,
    participant: update?.participant,
    method: update?.method,
  });

  if (!groupId) {
    logger.warn('Evento de solicitação de entrada sem groupId.', {
      action,
      updateKeys: update && typeof update === 'object' ? Object.keys(update) : null,
    });
    return;
  }

  if (!shouldAutoApproveAction(action)) {
    logger.debug('Evento de solicitação ignorado pelo filtro de ação.', { groupId, action });
    return;
  }

  try {
    const groupConfig = await groupConfigStore.getGroupConfig(groupId);
    if (!groupConfig.autoApproveRequestsEnabled) {
      logger.debug('Auto-aprovação de solicitações desativada para o grupo.', { groupId });
      return;
    }

    let participants = extractJoinRequestParticipants(update);

    if (participants.length === 0) {
      try {
        const listResponse = await getGroupRequestParticipantsList(sock, groupId);
        participants = extractJoinRequestParticipants(listResponse);
      } catch (error) {
        logger.warn('Falha ao obter lista de solicitações de entrada.', {
          groupId,
          errorMessage: error.message,
        });
      }
    }

    if (participants.length === 0) {
      logger.debug('Nenhuma solicitação de entrada pendente encontrada.', { groupId });
      return;
    }

    await updateGroupRequestParticipants(sock, groupId, participants, 'approve');
    logger.info('Solicitações de entrada aprovadas automaticamente.', {
      groupId,
      participantsCount: participants.length,
      participants,
    });
  } catch (error) {
    logger.error('Erro ao aprovar automaticamente solicitações de entrada.', {
      groupId,
      errorMessage: error.message,
      stack: error.stack,
    });
  }
};
