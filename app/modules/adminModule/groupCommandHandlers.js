import { handleMenuAdmCommand } from '../menuModule/menus.js';
import { downloadMediaMessage, getJidServer } from '../../config/baileysConfig.js';
import { isUserAdmin, createGroup, acceptGroupInvite, getGroupInfo, getGroupRequestParticipantsList, updateGroupAddMode, updateGroupSettings, updateGroupParticipants, leaveGroup, getGroupInviteCode, revokeGroupInviteCode, getGroupInfoFromInvite, updateGroupRequestParticipants, updateGroupSubject, updateGroupDescription, toggleEphemeral } from '../../config/groupUtils.js';
import groupConfigStore from '../../store/groupConfigStore.js';
import premiumUserStore from '../../store/premiumUserStore.js';
import logger from '../../utils/logger/loggerModule.js';
import { KNOWN_NETWORKS } from '../../utils/antiLink/antiLinkModule.js';
import { getNewsStatusForGroup, startNewsBroadcastForGroup, stopNewsBroadcastForGroup } from '../../services/newsBroadcastService.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';
import { clearCaptchasForGroup } from '../../services/captchaService.js';

const ADMIN_COMMANDS = new Set(['menuadm', 'newgroup', 'add', 'ban', 'up', 'down', 'setsubject', 'setdesc', 'setgroup', 'leave', 'invite', 'revoke', 'join', 'infofrominvite', 'metadata', 'requests', 'updaterequests', 'autorequests', 'temp', 'addmode', 'welcome', 'farewell', 'captcha', 'antilink', 'premium', 'nsfw', 'autosticker', 'noticias', 'news', 'prefix']);
const OWNER_JID = process.env.USER_ADMIN;
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';
const GROUP_ONLY_COMMAND_MESSAGE = 'Este comando está disponível apenas em conversas de grupo. Execute-o em um grupo para continuar.';
const NO_PERMISSION_COMMAND_MESSAGE = 'Permissão insuficiente para executar este comando. Solicite suporte a um administrador do grupo.';
const OWNER_ONLY_COMMAND_MESSAGE = 'Você não possui permissão para executar este comando. Este recurso é exclusivo do administrador principal do bot.';

const getParticipantJids = (messageInfo, args) => {
  const mentionedJids = messageInfo.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentionedJids.length > 0) {
    return mentionedJids;
  }
  const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo?.participant;
  if (repliedTo && args.length === 0) {
    return [repliedTo];
  }
  return args.filter((arg) => getJidServer(arg) === 's.whatsapp.net');
};

export const isAdminCommand = (command) => ADMIN_COMMANDS.has(command);

export async function handleAdminCommand({ command, args, text, sock, messageInfo, remoteJid, senderJid, botJid, isGroupMessage, expirationMessage, commandPrefix = DEFAULT_COMMAND_PREFIX }) {
  if (!isAdminCommand(command)) {
    return false;
  }

  switch (command) {
    case 'menuadm': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      await handleMenuAdmCommand(sock, remoteJid, messageInfo, expirationMessage, commandPrefix);
      break;
    }

    case 'premium': {
      if (!OWNER_JID || senderJid !== OWNER_JID) {
        await sendAndStore(sock, remoteJid, { text: OWNER_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const action = args[0]?.toLowerCase();
      const actionArgs = args.slice(1);
      if (!action || !['add', 'remove', 'list'].includes(action)) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}premium <add|remove|list> @usuario1 @usuario2 ...`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'list') {
        const premiumUsers = await premiumUserStore.getPremiumUsers();
        const listText = premiumUsers.length > 0 ? premiumUsers.map((jid) => `• ${jid}`).join('\n') : 'Nenhum usuário premium cadastrado.';
        await sendAndStore(sock, remoteJid, { text: `⭐ *Lista de usuários premium*\n\n${listText}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const participants = getParticipantJids(messageInfo, actionArgs);
      if (participants.length === 0) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}premium <add|remove> @usuario1 @usuario2 ...\nTambém é possível responder à mensagem do usuário desejado.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'add') {
        const updated = await premiumUserStore.addPremiumUsers(participants);
        await sendAndStore(sock, remoteJid, { text: `✅ Usuários adicionados à lista premium com sucesso.\nTotal atual de usuários premium: ${updated.length}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } else {
        const updated = await premiumUserStore.removePremiumUsers(participants);
        await sendAndStore(sock, remoteJid, { text: `✅ Usuários removidos da lista premium com sucesso.\nTotal atual de usuários premium: ${updated.length}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'nsfw': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}nsfw <on|off|status>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'status') {
        const config = await groupConfigStore.getGroupConfig(remoteJid);
        const enabled = Boolean(config.nsfwEnabled);
        await sendAndStore(sock, remoteJid, { text: `🔞 Status do conteúdo NSFW neste grupo: *${enabled ? 'ativado' : 'desativado'}*.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const enabled = action === 'on';
      await groupConfigStore.updateGroupConfig(remoteJid, { nsfwEnabled: enabled });
      await sendAndStore(sock, remoteJid, { text: `🔞 Configuração NSFW atualizada: *${enabled ? 'ativado' : 'desativado'}* para este grupo.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      break;
    }

    case 'autosticker': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}autosticker <on|off|status>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'status') {
        const config = await groupConfigStore.getGroupConfig(remoteJid);
        const enabled = Boolean(config.autoStickerEnabled);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `🖼️ Status do AutoSticker neste grupo: *${enabled ? 'ativado' : 'desativado'}*.\n` + 'Quando ativo, imagens e vídeos enviados serão convertidos automaticamente em figurinha.',
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const enabled = action === 'on';
      await groupConfigStore.updateGroupConfig(remoteJid, { autoStickerEnabled: enabled });
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: enabled ? '✅ AutoSticker ativado neste grupo.\nEnvie uma imagem ou vídeo para conversão automática em figurinha.' : '🛑 AutoSticker desativado neste grupo.',
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      break;
    }

    case 'newgroup': {
      if (args.length < 2) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}newgroup <titulo> <participante1> <participante2> ...`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const title = args[0];
      const participants = args.slice(1);
      try {
        const group = await createGroup(sock, title, participants);
        await sendAndStore(sock, remoteJid, { text: `O grupo "${group.subject}" foi criado com sucesso.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível criar o grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'add': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}add @participante1 @participante2 ...\nTambém é possível informar os JIDs dos participantes.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'add');
        await sendAndStore(sock, remoteJid, { text: 'Participantes adicionados com sucesso.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível adicionar participantes. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'ban': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}ban @participante1 @participante2 ...\nTambém é possível responder à mensagem do participante desejado.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (participants.includes(botJid)) {
        await sendAndStore(sock, remoteJid, { text: 'Operação cancelada: o bot não pode remover a própria conta.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'remove');
        await sendAndStore(sock, remoteJid, { text: 'Participantes removidos com sucesso.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo;
        if (repliedTo && participants.includes(repliedTo.participant)) {
          await sendAndStore(sock, remoteJid, {
            delete: messageInfo.message?.extendedTextMessage?.contextInfo?.key,
          });
        }
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível remover participantes. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'up': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}up @participante1 @participante2 ...\nTambém é possível informar os JIDs dos participantes.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (participants.includes(botJid)) {
        await sendAndStore(sock, remoteJid, { text: 'Operação cancelada: o bot não pode promover a própria conta.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'promote');
        await sendAndStore(sock, remoteJid, { text: 'Participantes promovidos a administradores com sucesso.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível promover participantes. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'down': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}down @participante1 @participante2 ...\nTambém é possível informar os JIDs dos participantes.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (participants.includes(botJid)) {
        await sendAndStore(sock, remoteJid, { text: 'Operação cancelada: o bot não pode rebaixar a própria conta.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'demote');
        await sendAndStore(sock, remoteJid, { text: 'Administradores rebaixados para participantes com sucesso.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível rebaixar administradores. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'setsubject': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (args.length < 1) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}setsubject <novo_assunto>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const newSubject = args.join(' ');
      try {
        await updateGroupSubject(sock, remoteJid, newSubject);
        await sendAndStore(sock, remoteJid, { text: `O assunto do grupo foi atualizado para "${newSubject}" com sucesso.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível alterar o assunto do grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'setdesc': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (args.length < 1) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}setdesc <nova_descricao>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const newDescription = args.join(' ');
      try {
        await updateGroupDescription(sock, remoteJid, newDescription);
        await sendAndStore(sock, remoteJid, { text: 'Descrição do grupo atualizada com sucesso.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível alterar a descrição do grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'setgroup': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (args.length < 1 || !['announcement', 'not_announcement', 'locked', 'unlocked'].includes(args[0])) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}setgroup <announcement|not_announcement|locked|unlocked>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const setting = args[0];
      try {
        await updateGroupSettings(sock, remoteJid, setting);
        await sendAndStore(sock, remoteJid, { text: `Configuração do grupo atualizada com sucesso para: "${setting}".` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível alterar a configuração do grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'leave': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      try {
        await leaveGroup(sock, remoteJid);
        await sendAndStore(sock, remoteJid, { text: 'Saída do grupo concluída com sucesso.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível sair do grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'invite': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      try {
        const code = await getGroupInviteCode(sock, remoteJid);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Código de convite atual do grupo:
${code}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível obter o código de convite. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'revoke': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      try {
        const code = await revokeGroupInviteCode(sock, remoteJid);
        await sendAndStore(sock, remoteJid, { text: `Código de convite anterior revogado com sucesso.\nNovo código: ${code}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível revogar o código de convite. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'join': {
      if (args.length < 1) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}join <codigo_de_convite>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const code = args[0];
      try {
        const response = await acceptGroupInvite(sock, code);
        await sendAndStore(sock, remoteJid, { text: `Entrada no grupo concluída com sucesso.\nIdentificador retornado: ${response}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível entrar no grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'infofrominvite': {
      if (args.length < 1) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}infofrominvite <codigo_de_convite>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const code = args[0];
      try {
        const response = await getGroupInfoFromInvite(sock, code);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Informações obtidas pelo convite:
${JSON.stringify(response, null, 2)}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível obter informações do grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'metadata': {
      const groupId = args[0] || remoteJid;
      if (!(await isUserAdmin(groupId, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      try {
        const metadata = getGroupInfo(groupId);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Metadados do grupo:
${JSON.stringify(metadata, null, 2)}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível obter metadados do grupo. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'requests': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      try {
        const response = await getGroupRequestParticipantsList(sock, remoteJid);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Solicitações de entrada pendentes:
${JSON.stringify(response, null, 2)}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível listar solicitações de entrada. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'updaterequests': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (args.length < 1 || !['approve', 'reject'].includes(args[0])) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}updaterequests <approve|reject> @participante1 ...`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const action = args[0];
      const participants = getParticipantJids(messageInfo, args.slice(1));
      if (participants.length === 0) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}updaterequests <approve|reject> @participante1 ...\nMencione os usuários que devem ser aprovados ou rejeitados.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        const response = await updateGroupRequestParticipants(sock, remoteJid, participants, action);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Solicitações de entrada atualizadas com sucesso:
${JSON.stringify(response, null, 2)}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível atualizar solicitações de entrada. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'autorequests': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await sendAndStore(sock, remoteJid, { text: `Formato de uso:\n${commandPrefix}autorequests <on|off|status>` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (action === 'status') {
        const config = await groupConfigStore.getGroupConfig(remoteJid);
        const enabled = Boolean(config.autoApproveRequestsEnabled);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `🤖 Auto-aprovação de solicitações: *${enabled ? 'ativada' : 'desativada'}*.\n` + 'Quando ativo, o bot aprova automaticamente novas solicitações de entrada.',
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const enabled = action === 'on';
      await groupConfigStore.updateGroupConfig(remoteJid, {
        autoApproveRequestsEnabled: enabled,
      });
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: enabled ? '✅ Auto-aprovação de solicitações ativada para este grupo.' : '🛑 Auto-aprovação de solicitações desativada para este grupo.',
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      break;
    }

    case 'temp': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (args.length < 1) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}temp <duracao_em_segundos>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const duration = parseInt(args[0]);
      try {
        await toggleEphemeral(sock, remoteJid, duration);
        await sendAndStore(sock, remoteJid, { text: `Configuração de mensagens temporárias atualizada para ${duration} segundos.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível atualizar mensagens efêmeras. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'addmode': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (args.length < 1 || !['all_member_add', 'admin_add'].includes(args[0])) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}addmode <all_member_add|admin_add>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const mode = args[0];
      try {
        await updateGroupAddMode(sock, remoteJid, mode);
        await sendAndStore(sock, remoteJid, { text: `Modo de adição de membros atualizado com sucesso para: ${mode}.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível atualizar o modo de adição de membros. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'prefix': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const rawPrefix = args[0]?.trim();
      const normalizedKeyword = rawPrefix?.toLowerCase();
      const usageText = ['Formato de uso do comando:', `${commandPrefix}prefix <novo_prefixo>`, `${commandPrefix}prefix status`, `${commandPrefix}prefix reset`].join('\n');

      if (!rawPrefix) {
        await sendAndStore(sock, remoteJid, { text: usageText }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (['status', 'info'].includes(normalizedKeyword)) {
        const config = await groupConfigStore.getGroupConfig(remoteJid);
        const customPrefix = typeof config.commandPrefix === 'string' ? config.commandPrefix.trim() : '';
        const currentPrefix = customPrefix || DEFAULT_COMMAND_PREFIX;
        const isCustom = Boolean(customPrefix && customPrefix !== DEFAULT_COMMAND_PREFIX);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: [`🔧 Prefixo ativo neste grupo: *${currentPrefix}*`, `Prefixo padrão global: *${DEFAULT_COMMAND_PREFIX}*`, isCustom ? '✅ Este grupo utiliza um prefixo personalizado.' : 'ℹ️ Este grupo utiliza o prefixo padrão.'].join('\n'),
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (['reset', 'default', 'padrao', 'padrão'].includes(normalizedKeyword)) {
        await groupConfigStore.updateGroupConfig(remoteJid, { commandPrefix: null });
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `✅ Prefixo restaurado para o padrão global: *${DEFAULT_COMMAND_PREFIX}*`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (rawPrefix.length > 5) {
        await sendAndStore(sock, remoteJid, { text: '⚠️ Prefixo inválido: utilize no máximo 5 caracteres.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (/\s/.test(rawPrefix)) {
        await sendAndStore(sock, remoteJid, { text: '⚠️ Prefixo inválido: não utilize espaços.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const newPrefix = rawPrefix;
      if (newPrefix === DEFAULT_COMMAND_PREFIX) {
        await groupConfigStore.updateGroupConfig(remoteJid, { commandPrefix: null });
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `✅ Prefixo atualizado para o padrão global: *${DEFAULT_COMMAND_PREFIX}*`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      await groupConfigStore.updateGroupConfig(remoteJid, { commandPrefix: newPrefix });
      await sendAndStore(sock, remoteJid, { text: `✅ Prefixo deste grupo atualizado para: *${newPrefix}*` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      break;
    }

    case 'welcome': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const subCommandMatch = text.trimStart().match(/^(\S+)([\s\S]*)$/);
      const subCommand = subCommandMatch ? subCommandMatch[1].toLowerCase() : '';
      const messageOrPath = subCommandMatch ? subCommandMatch[2].trimStart() : '';

      if (!subCommand || !['on', 'off', 'set'].includes(subCommand)) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}welcome <on|off|set> [mensagem ou caminho da midia]`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      try {
        if (subCommand === 'on') {
          await groupConfigStore.updateGroupConfig(remoteJid, { welcomeMessageEnabled: true });
          await sendAndStore(sock, remoteJid, { text: 'Mensagens de boas-vindas ativadas com sucesso para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        } else if (subCommand === 'off') {
          await groupConfigStore.updateGroupConfig(remoteJid, { welcomeMessageEnabled: false });
          await sendAndStore(sock, remoteJid, { text: 'Mensagens de boas-vindas desativadas com sucesso para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        } else if (subCommand === 'set') {
          if (!messageOrPath && !(messageInfo.message.imageMessage || messageInfo.message.videoMessage)) {
            await sendAndStore(
              sock,
              remoteJid,
              {
                text: `Formato de uso:
${commandPrefix}welcome set <mensagem ou caminho da midia>\nTambém é possível enviar uma mídia junto ao comando.`,
              },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
            break;
          }

          const quotedMessage = messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          let mediaToDownload = null;
          let mediaType = null;

          if (messageInfo.message.imageMessage) {
            mediaToDownload = messageInfo.message.imageMessage;
            mediaType = 'image';
          } else if (messageInfo.message.videoMessage) {
            mediaToDownload = messageInfo.message.videoMessage;
            mediaType = 'video';
          } else if (quotedMessage) {
            if (quotedMessage.imageMessage) {
              mediaToDownload = quotedMessage.imageMessage;
              mediaType = 'image';
            } else if (quotedMessage.videoMessage) {
              mediaToDownload = quotedMessage.videoMessage;
              mediaType = 'video';
            }
          }

          if (mediaToDownload) {
            const downloadedMediaPath = await downloadMediaMessage(mediaToDownload, mediaType, './temp');
            if (downloadedMediaPath) {
              await groupConfigStore.updateGroupConfig(remoteJid, {
                welcomeMedia: downloadedMediaPath,
              });
              await sendAndStore(sock, remoteJid, { text: `Mídia de boas-vindas configurada com sucesso: ${downloadedMediaPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
            } else {
              await sendAndStore(sock, remoteJid, { text: 'Não foi possível processar a mídia informada. Tente novamente em instantes.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
            }
          } else if (messageOrPath.startsWith('/') || messageOrPath.startsWith('.') || messageOrPath.startsWith('~')) {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              welcomeMedia: messageOrPath,
            });
            await sendAndStore(sock, remoteJid, { text: `Mídia de boas-vindas configurada com sucesso: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          } else {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              welcomeMessage: messageOrPath,
            });
            await sendAndStore(sock, remoteJid, { text: `Mensagem de boas-vindas configurada com sucesso: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          }
        }
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível configurar mensagens de boas-vindas. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'farewell': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      const subCommandMatch = text.trimStart().match(/^(\S+)([\s\S]*)$/);
      const subCommand = subCommandMatch ? subCommandMatch[1].toLowerCase() : '';
      const messageOrPath = subCommandMatch ? subCommandMatch[2].trimStart() : '';

      if (!subCommand || !['on', 'off', 'set'].includes(subCommand)) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}farewell <on|off|set> [mensagem ou caminho da midia]`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        if (subCommand === 'on') {
          await groupConfigStore.updateGroupConfig(remoteJid, { farewellMessageEnabled: true });
          await sendAndStore(sock, remoteJid, { text: 'Mensagens de saída ativadas com sucesso para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        } else if (subCommand === 'off') {
          await groupConfigStore.updateGroupConfig(remoteJid, { farewellMessageEnabled: false });
          await sendAndStore(sock, remoteJid, { text: 'Mensagens de saída desativadas com sucesso para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        } else if (subCommand === 'set') {
          if (!messageOrPath && !(messageInfo.message.imageMessage || messageInfo.message.videoMessage)) {
            await sendAndStore(
              sock,
              remoteJid,
              {
                text: `Formato de uso:
${commandPrefix}farewell set <mensagem ou caminho da midia>\nTambém é possível enviar uma mídia junto ao comando.`,
              },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
            break;
          }

          const quotedMessage = messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          let mediaToDownload = null;
          let mediaType = null;

          if (messageInfo.message.imageMessage) {
            mediaToDownload = messageInfo.message.imageMessage;
            mediaType = 'image';
          } else if (messageInfo.message.videoMessage) {
            mediaToDownload = messageInfo.message.videoMessage;
            mediaType = 'video';
          } else if (quotedMessage) {
            if (quotedMessage.imageMessage) {
              mediaToDownload = quotedMessage.imageMessage;
              mediaType = 'image';
            } else if (quotedMessage.videoMessage) {
              mediaToDownload = quotedMessage.videoMessage;
              mediaType = 'video';
            }
          }

          if (mediaToDownload) {
            const downloadedMediaPath = await downloadMediaMessage(mediaToDownload, mediaType, './temp');
            if (downloadedMediaPath) {
              await groupConfigStore.updateGroupConfig(remoteJid, {
                farewellMedia: downloadedMediaPath,
              });
              await sendAndStore(sock, remoteJid, { text: `Mídia de saída configurada com sucesso: ${downloadedMediaPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
            } else {
              await sendAndStore(sock, remoteJid, { text: 'Não foi possível processar a mídia informada. Tente novamente em instantes.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
            }
          } else if (messageOrPath.startsWith('/') || messageOrPath.startsWith('.') || messageOrPath.startsWith('~')) {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              farewellMedia: messageOrPath,
            });
            await sendAndStore(sock, remoteJid, { text: `Mídia de saída configurada com sucesso: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          } else {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              farewellMessage: messageOrPath,
            });
            await sendAndStore(sock, remoteJid, { text: `Mensagem de saída configurada com sucesso: ${messageOrPath}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          }
        }
      } catch (error) {
        await sendAndStore(sock, remoteJid, { text: `Não foi possível configurar mensagens de saída. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'captcha': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await sendAndStore(sock, remoteJid, { text: `Formato de uso:\n${commandPrefix}captcha <on|off|status>` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      if (action === 'status') {
        const config = await groupConfigStore.getGroupConfig(remoteJid);
        const enabled = Boolean(config.captchaEnabled);
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `🤖 Captcha neste grupo: *${enabled ? 'ativado' : 'desativado'}*.\n` + 'Quando ativo, novos membros precisam reagir ou enviar uma mensagem em até 5 minutos.',
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const enabled = action === 'on';
      await groupConfigStore.updateGroupConfig(remoteJid, { captchaEnabled: enabled });
      if (!enabled) {
        clearCaptchasForGroup(remoteJid, 'disabled');
      }
      await sendAndStore(
        sock,
        remoteJid,
        {
          text: enabled ? '✅ Captcha ativado. Novos membros terão 5 minutos para reagir ou enviar mensagem.' : '🛑 Captcha desativado para este grupo.',
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      break;
    }

    case 'antilink': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const subCommand = args[0] ? args[0].toLowerCase() : '';
      const currentConfig = await groupConfigStore.getGroupConfig(remoteJid);
      const allowedNetworks = currentConfig.antilinkAllowedNetworks || [];
      const allowedDomains = currentConfig.antilinkAllowedDomains || [];
      const availableNetworks = Object.keys(KNOWN_NETWORKS).sort();

      const parseNetworks = (inputArgs) => {
        const raw = inputArgs.flatMap((value) => value.split(','));
        return raw.map((value) => value.trim().toLowerCase()).filter(Boolean);
      };

      const formatNetworkList = (networks) => (networks.length ? networks.join(', ') : 'nenhuma');

      if (!['on', 'off'].includes(subCommand)) {
        if (subCommand === 'list') {
          const status = currentConfig.antilinkEnabled ? 'ativado' : 'desativado';
          await sendAndStore(
            sock,
            remoteJid,
            {
              text: `📋 *Antilink - Configuração atual*\n` + `Status: *${status}*\n\n` + `✅ *Redes permitidas*\n${formatNetworkList(allowedNetworks)}\n\n` + `✅ *Domínios permitidos*\n${formatNetworkList(allowedDomains)}\n\n` + `🧭 *Redes disponíveis*\n${availableNetworks.join(', ')}`,
            },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
          break;
        }

        if (subCommand === 'allow' || subCommand === 'disallow') {
          const requestedNetworks = parseNetworks(args.slice(1));
          const validNetworks = requestedNetworks.filter((name) => KNOWN_NETWORKS[name]);
          const invalidNetworks = requestedNetworks.filter((name) => !KNOWN_NETWORKS[name]);

          if (validNetworks.length === 0) {
            await sendAndStore(
              sock,
              remoteJid,
              {
                text: `Formato de uso:
${commandPrefix}antilink ${subCommand} <rede>\nRedes disponíveis: ${availableNetworks.join(', ')}`,
              },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
            break;
          }

          let updatedNetworks = allowedNetworks;
          if (subCommand === 'allow') {
            updatedNetworks = Array.from(new Set([...allowedNetworks, ...validNetworks]));
          } else {
            updatedNetworks = allowedNetworks.filter((name) => !validNetworks.includes(name));
          }

          await groupConfigStore.updateGroupConfig(remoteJid, {
            antilinkAllowedNetworks: updatedNetworks,
          });

          const invalidNote = invalidNetworks.length ? `\nIgnorados: ${invalidNetworks.join(', ')}` : '';
          await sendAndStore(sock, remoteJid, { text: `Redes permitidas atualizadas: ${formatNetworkList(updatedNetworks)}${invalidNote}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          break;
        }

        if (subCommand === 'add' || subCommand === 'remove') {
          const requestedDomains = parseNetworks(args.slice(1));
          const normalizedDomains = requestedDomains.map((domain) =>
            domain
              .replace(/^https?:\/\//, '')
              .replace(/^www\./, '')
              .replace(/\/.*$/, ''),
          );

          if (normalizedDomains.length === 0) {
            await sendAndStore(
              sock,
              remoteJid,
              {
                text: `Formato de uso:
${commandPrefix}antilink ${subCommand} <dominio>`,
              },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
            break;
          }

          let updatedDomains = allowedDomains;
          if (subCommand === 'add') {
            updatedDomains = Array.from(new Set([...allowedDomains, ...normalizedDomains]));
          } else {
            updatedDomains = allowedDomains.filter((domain) => !normalizedDomains.includes(domain));
          }

          await groupConfigStore.updateGroupConfig(remoteJid, {
            antilinkAllowedDomains: updatedDomains,
          });
          await sendAndStore(sock, remoteJid, { text: `Domínios permitidos atualizados: ${formatNetworkList(updatedDomains)}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
          break;
        }

        const status = currentConfig.antilinkEnabled ? 'ativado' : 'desativado';
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `📌 *Guia de uso do Antilink*\n` + `Status atual: *${status}*\n\n` + `✅ *${commandPrefix}antilink on*\nAtiva o bloqueio de links no grupo.\n\n` + `⛔ *${commandPrefix}antilink off*\nDesativa o bloqueio de links no grupo.\n\n` + `📋 *${commandPrefix}antilink list*\nExibe as redes e os domínios permitidos.\n\n` + `➕ *${commandPrefix}antilink allow <rede>*\nPermite uma rede conhecida (ex.: youtube, instagram).\n\n` + `➖ *${commandPrefix}antilink disallow <rede>*\nRemove uma rede conhecida da lista permitida.\n\n` + `🌐 *${commandPrefix}antilink add <dominio>*\nPermite um domínio específico (ex.: exemplo.com).\n\n` + `🗑️ *${commandPrefix}antilink remove <dominio>*\nRemove um domínio específico da lista permitida.\n\n` + `ℹ️ Dica: use *${commandPrefix}antilink list* para consultar as redes disponíveis.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        const isEnabled = subCommand === 'on';
        await groupConfigStore.updateGroupConfig(remoteJid, { antilinkEnabled: isEnabled });
        await sendAndStore(sock, remoteJid, { text: `✅ Recurso Antilink ${isEnabled ? 'ativado' : 'desativado'} com sucesso neste grupo.` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } catch (error) {
        logger.error('Erro ao configurar o antilink:', {
          error: error.message,
          groupId: remoteJid,
        });
        await sendAndStore(sock, remoteJid, { text: `Não foi possível configurar o antilink. Detalhes: ${error.message}` }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    case 'noticias':
    case 'news': {
      if (!isGroupMessage) {
        await sendAndStore(sock, remoteJid, { text: GROUP_ONLY_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, remoteJid, { text: NO_PERMISSION_COMMAND_MESSAGE }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
        break;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `Formato de uso:
${commandPrefix}noticias <on|off|status>`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'status') {
        const status = await getNewsStatusForGroup(remoteJid);
        const enabledText = status.enabled ? 'ATIVADO' : 'DESATIVADO';
        const lastSent = status.lastSentAt ? `\nÚltimo envio: ${status.lastSentAt}` : '';
        await sendAndStore(
          sock,
          remoteJid,
          {
            text: `📰 Status de notícias neste grupo: *${enabledText.toLowerCase()}*.\nTotal de envios: ${status.sentCount}.${lastSent}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const enableNews = action === 'on';
      await groupConfigStore.updateGroupConfig(remoteJid, { newsEnabled: enableNews });
      if (enableNews) {
        startNewsBroadcastForGroup(remoteJid);
        await sendAndStore(sock, remoteJid, { text: '📰 Envio automático de notícias ativado. As atualizações serão enviadas com intervalo aproximado de 1 a 2 minutos.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      } else {
        stopNewsBroadcastForGroup(remoteJid);
        await sendAndStore(sock, remoteJid, { text: '🛑 Envio automático de notícias desativado para este grupo.' }, { quoted: messageInfo, ephemeralExpiration: expirationMessage });
      }
      break;
    }

    default:
      break;
  }

  return true;
}
