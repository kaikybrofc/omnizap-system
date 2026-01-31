import { handleMenuAdmCommand } from '../menuModule/menus.js';
import { downloadMediaMessage, getJidServer } from '../../config/baileysConfig.js';
import {
  isUserAdmin,
  createGroup,
  acceptGroupInvite,
  getGroupInfo,
  getGroupRequestParticipantsList,
  updateGroupAddMode,
  updateGroupSettings,
  updateGroupParticipants,
  leaveGroup,
  getGroupInviteCode,
  revokeGroupInviteCode,
  getGroupInfoFromInvite,
  updateGroupRequestParticipants,
  updateGroupSubject,
  updateGroupDescription,
  toggleEphemeral,
} from '../../config/groupUtils.js';
import groupConfigStore from '../../store/groupConfigStore.js';
import premiumUserStore from '../../store/premiumUserStore.js';
import logger from '../../utils/logger/loggerModule.js';
import { KNOWN_NETWORKS } from '../../utils/antiLink/antiLinkModule.js';
import {
  getNewsStatusForGroup,
  startNewsBroadcastForGroup,
  stopNewsBroadcastForGroup,
} from '../../services/newsBroadcastService.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

const ADMIN_COMMANDS = new Set([
  'menuadm',
  'newgroup',
  'add',
  'ban',
  'up',
  'down',
  'setsubject',
  'setdesc',
  'setgroup',
  'leave',
  'invite',
  'revoke',
  'join',
  'infofrominvite',
  'metadata',
  'requests',
  'updaterequests',
  'temp',
  'addmode',
  'welcome',
  'farewell',
  'antilink',
  'premium',
  'nsfw',
  'noticias',
  'news',
  'prefix',
]);
const OWNER_JID = process.env.USER_ADMIN;
const DEFAULT_COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

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

export async function handleAdminCommand({
  command,
  args,
  text,
  sock,
  messageInfo,
  remoteJid,
  senderJid,
  botJid,
  isGroupMessage,
  expirationMessage,
  commandPrefix = DEFAULT_COMMAND_PREFIX,
}) {
  if (!isAdminCommand(command)) {
    return false;
  }

  switch (command) {
    case 'menuadm': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      await handleMenuAdmCommand(sock, remoteJid, messageInfo, expirationMessage, commandPrefix);
      break;
    }

    case 'premium': {
      if (!OWNER_JID || senderJid !== OWNER_JID) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const action = args[0]?.toLowerCase();
      const actionArgs = args.slice(1);
      if (!action || !['add', 'remove', 'list'].includes(action)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}premium <add|remove|list> @user1 @user2...` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'list') {
        const premiumUsers = await premiumUserStore.getPremiumUsers();
        const listText =
          premiumUsers.length > 0
            ? premiumUsers.map((jid) => `• ${jid}`).join('\n')
            : 'Nenhum usuário premium cadastrado.';
        await sendAndStore(sock, 
          remoteJid,
          { text: `⭐ *Lista Premium*\n\n${listText}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const participants = getParticipantJids(messageInfo, actionArgs);
      if (participants.length === 0) {
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `Uso: ${commandPrefix}premium <add|remove> @user1 @user2... ou responda a uma mensagem.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'add') {
        const updated = await premiumUserStore.addPremiumUsers(participants);
        await sendAndStore(sock, 
          remoteJid,
          { text: `✅ Usuários adicionados à lista premium.\nTotal: ${updated.length}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } else {
        const updated = await premiumUserStore.removePremiumUsers(participants);
        await sendAndStore(sock, 
          remoteJid,
          { text: `✅ Usuários removidos da lista premium.\nTotal: ${updated.length}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'nsfw': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}nsfw <on|off|status>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'status') {
        const config = await groupConfigStore.getGroupConfig(remoteJid);
        const enabled = Boolean(config.nsfwEnabled);
        await sendAndStore(sock, 
          remoteJid,
          { text: `🔞 NSFW está ${enabled ? 'ATIVADO' : 'DESATIVADO'} neste grupo.` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const enabled = action === 'on';
      await groupConfigStore.updateGroupConfig(remoteJid, { nsfwEnabled: enabled });
      await sendAndStore(sock, 
        remoteJid,
        { text: `🔞 NSFW ${enabled ? 'ATIVADO' : 'DESATIVADO'} para este grupo.` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      break;
    }

    case 'newgroup': {
      if (args.length < 2) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}newgroup <título> <participante1> <participante2>...` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const title = args[0];
      const participants = args.slice(1);
      try {
        const group = await createGroup(sock, title, participants);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Grupo \"${group.subject}\" criado com sucesso!` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao criar o grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'add': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `Uso: ${commandPrefix}add @participante1 @participante2... ou forneça os JIDs.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'add');
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Participantes adicionados com sucesso!' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao adicionar participantes: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'ban': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `Uso: ${commandPrefix}ban @participante1 @participante2... ou responda a uma mensagem.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (participants.includes(botJid)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'O bot não pode remover a si mesmo.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'remove');
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Participantes removidos com sucesso!' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        const repliedTo = messageInfo.message?.extendedTextMessage?.contextInfo;
        if (repliedTo && participants.includes(repliedTo.participant)) {
          await sendAndStore(sock, remoteJid, {
            delete: messageInfo.message?.extendedTextMessage?.contextInfo?.key,
          });
        }
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao remover participantes: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'up': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `Uso: ${commandPrefix}up @participante1 @participante2... ou forneça os JIDs.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (participants.includes(botJid)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'O bot não pode promover a si mesmo.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'promote');
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Participantes promovidos a administradores com sucesso!' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao promover participantes: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'down': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const participants = getParticipantJids(messageInfo, args);
      if (participants.length === 0) {
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `Uso: ${commandPrefix}down @participante1 @participante2... ou forneça os JIDs.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (participants.includes(botJid)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'O bot não pode rebaixar a si mesmo.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        await updateGroupParticipants(sock, remoteJid, participants, 'demote');
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Administradores demovidos a participantes com sucesso!' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao demoter administradores: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'setsubject': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (args.length < 1) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}setsubject <novo_assunto>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const newSubject = args.join(' ');
      try {
        await updateGroupSubject(sock, remoteJid, newSubject);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Assunto do grupo alterado para \"${newSubject}\" com sucesso!` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao alterar o assunto do grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'setdesc': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (args.length < 1) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}setdesc <nova_descrição>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const newDescription = args.join(' ');
      try {
        await updateGroupDescription(sock, remoteJid, newDescription);
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Descrição do grupo alterada com sucesso!' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao alterar a descrição do grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'setgroup': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (
        args.length < 1 ||
        !['announcement', 'not_announcement', 'locked', 'unlocked'].includes(args[0])
      ) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}setgroup <announcement|not_announcement|locked|unlocked>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const setting = args[0];
      try {
        await updateGroupSettings(sock, remoteJid, setting);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Configuração do grupo alterada para \"${setting}\" com sucesso!` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao alterar a configuração do grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'leave': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        await leaveGroup(sock, remoteJid);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Saí do grupo ${remoteJid} com sucesso.` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao sair do grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'invite': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        const code = await getGroupInviteCode(sock, remoteJid);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Código de convite para o grupo: ${code}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao obter o código de convite: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'revoke': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        const code = await revokeGroupInviteCode(sock, remoteJid);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Código de convite revogado. Novo código: ${code}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao revogar o código de convite: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'join': {
      if (args.length < 1) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}join <código_de_convite>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const code = args[0];
      try {
        const response = await acceptGroupInvite(sock, code);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Entrou no grupo: ${response}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao entrar no grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'infofrominvite': {
      if (args.length < 1) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}infofrominvite <código_de_convite>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const code = args[0];
      try {
        const response = await getGroupInfoFromInvite(sock, code);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Informações do grupo: ${JSON.stringify(response, null, 2)}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao obter informações do grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'metadata': {
      const groupId = args[0] || remoteJid;
      if (!(await isUserAdmin(groupId, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        const metadata = getGroupInfo(groupId);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Metadados do grupo: ${JSON.stringify(metadata, null, 2)}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao obter metadados do grupo: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'requests': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        const response = await getGroupRequestParticipantsList(sock, remoteJid);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Solicitações de entrada: ${JSON.stringify(response, null, 2)}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao listar solicitações de entrada: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'updaterequests': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (args.length < 1 || !['approve', 'reject'].includes(args[0])) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}updaterequests <approve|reject> @participante1...` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const action = args[0];
      const participants = getParticipantJids(messageInfo, args.slice(1));
      if (participants.length === 0) {
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `Uso: ${commandPrefix}updaterequests <approve|reject> @participante1... (mencione os usuários)`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      try {
        const response = await updateGroupRequestParticipants(
          sock,
          remoteJid,
          participants,
          action,
        );
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `Solicitações de entrada atualizadas: ${JSON.stringify(response, null, 2)}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao atualizar solicitações de entrada: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'temp': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (args.length < 1) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}temp <duração_em_segundos>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const duration = parseInt(args[0]);
      try {
        await toggleEphemeral(sock, remoteJid, duration);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Mensagens efêmeras atualizadas para ${duration} segundos.` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao atualizar mensagens efêmeras: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'addmode': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (args.length < 1 || !['all_member_add', 'admin_add'].includes(args[0])) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}addmode <all_member_add|admin_add>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const mode = args[0];
      try {
        await updateGroupAddMode(sock, remoteJid, mode);
        await sendAndStore(sock, 
          remoteJid,
          { text: `Modo de adição de membros atualizado para ${mode}.` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao atualizar o modo de adição de membros: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'prefix': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const rawPrefix = args[0]?.trim();
      const normalizedKeyword = rawPrefix?.toLowerCase();
      const usageText = [
        'Uso:',
        `${commandPrefix}prefix <novo_prefixo>`,
        `${commandPrefix}prefix status`,
        `${commandPrefix}prefix reset`,
      ].join('\n');

      if (!rawPrefix) {
        await sendAndStore(sock, 
          remoteJid,
          { text: usageText },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (['status', 'info'].includes(normalizedKeyword)) {
        const config = await groupConfigStore.getGroupConfig(remoteJid);
        const customPrefix =
          typeof config.commandPrefix === 'string' ? config.commandPrefix.trim() : '';
        const currentPrefix = customPrefix || DEFAULT_COMMAND_PREFIX;
        const isCustom = Boolean(customPrefix && customPrefix !== DEFAULT_COMMAND_PREFIX);
        await sendAndStore(sock, 
          remoteJid,
          {
            text: [
              `🔧 Prefixo atual: *${currentPrefix}*`,
              `Padrão do bot: *${DEFAULT_COMMAND_PREFIX}*`,
              isCustom ? '✅ Prefixo personalizado ativo.' : 'ℹ️ Usando prefixo padrão.',
            ].join('\n'),
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (['reset', 'default', 'padrao', 'padrão'].includes(normalizedKeyword)) {
        await groupConfigStore.updateGroupConfig(remoteJid, { commandPrefix: null });
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `✅ Prefixo restaurado para o padrão: *${DEFAULT_COMMAND_PREFIX}*`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (rawPrefix.length > 5) {
        await sendAndStore(sock, 
          remoteJid,
          { text: '⚠️ Prefixo muito longo. Use no máximo 5 caracteres.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (/\s/.test(rawPrefix)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: '⚠️ O prefixo não pode conter espaços.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const newPrefix = rawPrefix;
      if (newPrefix === DEFAULT_COMMAND_PREFIX) {
        await groupConfigStore.updateGroupConfig(remoteJid, { commandPrefix: null });
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `✅ Prefixo atualizado para o padrão: *${DEFAULT_COMMAND_PREFIX}*`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      await groupConfigStore.updateGroupConfig(remoteJid, { commandPrefix: newPrefix });
      await sendAndStore(sock, 
        remoteJid,
        { text: `✅ Prefixo do bot atualizado para: *${newPrefix}*` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      break;
    }

    case 'welcome': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const subCommandMatch = text.trimStart().match(/^(\S+)([\s\S]*)$/);
      const subCommand = subCommandMatch ? subCommandMatch[1].toLowerCase() : '';
      const messageOrPath = subCommandMatch ? subCommandMatch[2].trimStart() : '';

      if (!subCommand || !['on', 'off', 'set'].includes(subCommand)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}welcome <on|off|set> [mensagem ou caminho da mídia]` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        if (subCommand === 'on') {
          await groupConfigStore.updateGroupConfig(remoteJid, { welcomeMessageEnabled: true });
          await sendAndStore(sock, 
            remoteJid,
            { text: 'Mensagens de boas-vindas ativadas para este grupo.' },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
        } else if (subCommand === 'off') {
          await groupConfigStore.updateGroupConfig(remoteJid, { welcomeMessageEnabled: false });
          await sendAndStore(sock, 
            remoteJid,
            { text: 'Mensagens de boas-vindas desativadas para este grupo.' },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
        } else if (subCommand === 'set') {
          if (
            !messageOrPath &&
            !(messageInfo.message.imageMessage || messageInfo.message.videoMessage)
          ) {
            await sendAndStore(sock, 
              remoteJid,
              {
                text: `Uso: ${commandPrefix}welcome set <mensagem ou caminho da mídia> ou envie uma mídia com o comando.`,
              },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
            break;
          }

          const quotedMessage =
            messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage;
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
            const downloadedMediaPath = await downloadMediaMessage(
              mediaToDownload,
              mediaType,
              './temp',
            );
            if (downloadedMediaPath) {
              await groupConfigStore.updateGroupConfig(remoteJid, {
                welcomeMedia: downloadedMediaPath,
              });
              await sendAndStore(sock, 
                remoteJid,
                { text: `Mídia de boas-vindas definida para: ${downloadedMediaPath}` },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
            } else {
              await sendAndStore(sock, 
                remoteJid,
                { text: 'Erro ao baixar a mídia. Por favor, tente novamente.' },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
            }
          } else if (
            messageOrPath.startsWith('/') ||
            messageOrPath.startsWith('.') ||
            messageOrPath.startsWith('~')
          ) {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              welcomeMedia: messageOrPath,
            });
            await sendAndStore(sock, 
              remoteJid,
              { text: `Mídia de boas-vindas definida para: ${messageOrPath}` },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
          } else {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              welcomeMessage: messageOrPath,
            });
            await sendAndStore(sock, 
              remoteJid,
              { text: `Mensagem de boas-vindas definida para: ${messageOrPath}` },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
          }
        }
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao configurar mensagens de boas-vindas: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'farewell': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      const subCommandMatch = text.trimStart().match(/^(\S+)([\s\S]*)$/);
      const subCommand = subCommandMatch ? subCommandMatch[1].toLowerCase() : '';
      const messageOrPath = subCommandMatch ? subCommandMatch[2].trimStart() : '';

      if (!subCommand || !['on', 'off', 'set'].includes(subCommand)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}farewell <on|off|set> [mensagem ou caminho da mídia]` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        if (subCommand === 'on') {
          await groupConfigStore.updateGroupConfig(remoteJid, { farewellMessageEnabled: true });
          await sendAndStore(sock, 
            remoteJid,
            { text: 'Mensagens de saída ativadas para este grupo.' },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
        } else if (subCommand === 'off') {
          await groupConfigStore.updateGroupConfig(remoteJid, { farewellMessageEnabled: false });
          await sendAndStore(sock, 
            remoteJid,
            { text: 'Mensagens de saída desativadas para este grupo.' },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
        } else if (subCommand === 'set') {
          if (
            !messageOrPath &&
            !(messageInfo.message.imageMessage || messageInfo.message.videoMessage)
          ) {
            await sendAndStore(sock, 
              remoteJid,
              {
                text: `Uso: ${commandPrefix}farewell set <mensagem ou caminho da mídia> ou envie uma mídia com o comando.`,
              },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
            break;
          }

          const quotedMessage =
            messageInfo.message?.extendedTextMessage?.contextInfo?.quotedMessage;
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
            const downloadedMediaPath = await downloadMediaMessage(
              mediaToDownload,
              mediaType,
              './temp',
            );
            if (downloadedMediaPath) {
              await groupConfigStore.updateGroupConfig(remoteJid, {
                farewellMedia: downloadedMediaPath,
              });
              await sendAndStore(sock, 
                remoteJid,
                { text: `Mídia de saída definida para: ${downloadedMediaPath}` },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
            } else {
              await sendAndStore(sock, 
                remoteJid,
                { text: 'Erro ao baixar a mídia. Por favor, tente novamente.' },
                { quoted: messageInfo, ephemeralExpiration: expirationMessage },
              );
            }
          } else if (
            messageOrPath.startsWith('/') ||
            messageOrPath.startsWith('.') ||
            messageOrPath.startsWith('~')
          ) {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              farewellMedia: messageOrPath,
            });
            await sendAndStore(sock, 
              remoteJid,
              { text: `Mídia de saída definida para: ${messageOrPath}` },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
          } else {
            await groupConfigStore.updateGroupConfig(remoteJid, {
              farewellMessage: messageOrPath,
            });
            await sendAndStore(sock, 
              remoteJid,
              { text: `Mensagem de saída definida para: ${messageOrPath}` },
              { quoted: messageInfo, ephemeralExpiration: expirationMessage },
            );
          }
        }
      } catch (error) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao configurar mensagens de saída: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'antilink': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
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
          await sendAndStore(sock, 
            remoteJid,
            {
              text:
                `📋 *Antilink - Lista*\n` +
                `Status: *${status}*\n\n` +
                `✅ *Redes permitidas*\n${formatNetworkList(allowedNetworks)}\n\n` +
                `✅ *Domínios permitidos*\n${formatNetworkList(allowedDomains)}\n\n` +
                `🧭 *Redes disponíveis*\n${availableNetworks.join(', ')}`,
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
            await sendAndStore(sock, 
              remoteJid,
              {
                text: `Uso: ${commandPrefix}antilink ${subCommand} <rede>\nDisponíveis: ${availableNetworks.join(', ')}`,
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

          const invalidNote = invalidNetworks.length
            ? `\nIgnorados: ${invalidNetworks.join(', ')}`
            : '';
          await sendAndStore(sock, 
            remoteJid,
            { text: `Permitidos agora: ${formatNetworkList(updatedNetworks)}${invalidNote}` },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
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
            await sendAndStore(sock, 
              remoteJid,
              { text: `Uso: ${commandPrefix}antilink ${subCommand} <dominio>` },
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
          await sendAndStore(sock, 
            remoteJid,
            { text: `Permitidos (domínios) agora: ${formatNetworkList(updatedDomains)}` },
            { quoted: messageInfo, ephemeralExpiration: expirationMessage },
          );
          break;
        }

        const status = currentConfig.antilinkEnabled ? 'ativado' : 'desativado';
        await sendAndStore(sock, 
          remoteJid,
          {
            text:
              `📌 *Como usar o Antilink*\n` +
              `Status atual: *${status}*\n\n` +
              `✅ *${commandPrefix}antilink on*\nAtiva o bloqueio de links no grupo.\n\n` +
              `⛔ *${commandPrefix}antilink off*\nDesativa o bloqueio de links no grupo.\n\n` +
              `📋 *${commandPrefix}antilink list*\nMostra as redes e dominios permitidos.\n\n` +
              `➕ *${commandPrefix}antilink allow <rede>*\nPermite uma rede conhecida (ex: youtube, instagram).\n\n` +
              `➖ *${commandPrefix}antilink disallow <rede>*\nRemove uma rede conhecida da lista permitida.\n\n` +
              `🌐 *${commandPrefix}antilink add <dominio>*\nPermite um dominio especifico (ex: exemplo.com).\n\n` +
              `🗑️ *${commandPrefix}antilink remove <dominio>*\nRemove um dominio especifico da lista.\n\n` +
              `ℹ️ Dica: use *${commandPrefix}antilink list* para ver as redes disponiveis.`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      try {
        const isEnabled = subCommand === 'on';
        await groupConfigStore.updateGroupConfig(remoteJid, { antilinkEnabled: isEnabled });
        await sendAndStore(sock, 
          remoteJid,
          { text: `✅ Antilink foi ${isEnabled ? 'ativado' : 'desativado'} para este grupo.` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } catch (error) {
        logger.error('Erro ao configurar o antilink:', {
          error: error.message,
          groupId: remoteJid,
        });
        await sendAndStore(sock, 
          remoteJid,
          { text: `Erro ao configurar o antilink: ${error.message}` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    case 'noticias':
    case 'news': {
      if (!isGroupMessage) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Este comando só pode ser usado em grupos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }
      if (!(await isUserAdmin(remoteJid, senderJid))) {
        await sendAndStore(sock, 
          remoteJid,
          { text: 'Você não tem permissão para usar este comando.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const action = args[0]?.toLowerCase();
      if (!action || !['on', 'off', 'status'].includes(action)) {
        await sendAndStore(sock, 
          remoteJid,
          { text: `Uso: ${commandPrefix}noticias <on|off|status>` },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      if (action === 'status') {
        const status = await getNewsStatusForGroup(remoteJid);
        const enabledText = status.enabled ? 'ATIVADO' : 'DESATIVADO';
        const lastSent = status.lastSentAt ? `\nÚltimo envio: ${status.lastSentAt}` : '';
        await sendAndStore(sock, 
          remoteJid,
          {
            text: `📰 Notícias ${enabledText} para este grupo.\nEnviadas: ${status.sentCount}.${lastSent}`,
          },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
        break;
      }

      const enableNews = action === 'on';
      await groupConfigStore.updateGroupConfig(remoteJid, { newsEnabled: enableNews });
      if (enableNews) {
        startNewsBroadcastForGroup(remoteJid);
        await sendAndStore(sock, 
          remoteJid,
          { text: '📰 Notícias ativadas. Vou enviar as novidades com intervalo de 1 a 2 minutos.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      } else {
        stopNewsBroadcastForGroup(remoteJid);
        await sendAndStore(sock, 
          remoteJid,
          { text: '🛑 Notícias desativadas para este grupo.' },
          { quoted: messageInfo, ephemeralExpiration: expirationMessage },
        );
      }
      break;
    }

    default:
      break;
  }

  return true;
}
