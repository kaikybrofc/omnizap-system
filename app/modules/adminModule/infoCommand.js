const groupUtils = require('../../utils/groupUtils');
const logger = require('../../utils/logger/loggerModule');
const store = require('../../store/dataStore');

const handleInfoCommand = async (
  sock,
  messageInfo,
  args,
  isGroupMessage,
  remoteJid,
  expirationMessage,
) => {
  const inactiveIndex = args.indexOf('--inativos');

  if (inactiveIndex !== -1) {
    let targetGroupId;
    let messageLimit = NaN;

    if (inactiveIndex > 0 && args[inactiveIndex - 1].includes('@g.us')) {
      targetGroupId = args[inactiveIndex - 1];
    } else if (isGroupMessage) {
      targetGroupId = remoteJid;
    }

    if (args.length > inactiveIndex + 1) {
      messageLimit = parseInt(args[inactiveIndex + 1]);
    }

    if (!targetGroupId) {
      logger.warn('ID do grupo não fornecido para /info --inativos em chat privado.');
      await sock.sendMessage(
        remoteJid,
        {
          text: '⚠️ *Por favor, forneça o ID do grupo para usar `--inativos` em chat privado!\n\nExemplo: `/info 1234567890@g.us --inativos 10`',
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }
    if (isNaN(messageLimit)) {
      logger.warn('Limite de mensagens inválido para /info --inativos.');
      await sock.sendMessage(
        remoteJid,
        {
          text: '⚠️ *Uso incorreto do comando --inativos. Por favor, forneça um número válido como limite.*\n\nExemplo: `/info --inativos 10`',
        },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const groupInfo = groupUtils.getGroupInfo(targetGroupId);
    if (!groupInfo) {
      logger.info(`Grupo com ID ${targetGroupId} não encontrado.`);
      await sock.sendMessage(
        remoteJid,
        { text: `❌ *Grupo com ID ${targetGroupId} não encontrado.*` },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const allParticipants = groupUtils.getGroupParticipants(targetGroupId) || [];
    const messages = store.rawMessages[targetGroupId] || [];
    const mentions = [];

    if (messages.length === 0) {
      await sock.sendMessage(
        remoteJid,
        { text: '📊 *Nenhuma mensagem encontrada no histórico para este grupo.*' },
        { quoted: messageInfo, ephemeralExpiration: expirationMessage },
      );
      return;
    }

    const participantCounts = {};
    let firstMessageTimestamp = Infinity;

    messages.forEach((msg) => {
      const participant = msg.key.fromMe
        ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
        : msg.key.participant || msg.participant;
      if (participant) {
        participantCounts[participant] = (participantCounts[participant] || 0) + 1;
      }
      const timestamp = msg.messageTimestamp;
      if (timestamp < firstMessageTimestamp) {
        firstMessageTimestamp = timestamp;
      }
    });

    const inactiveUsers = allParticipants
      .map((p) => ({
        jid: p.id,
        count: participantCounts[p.id] || 0,
      }))
      .filter((user) => user.count < messageLimit)
      .sort((a, b) => a.count - b.count);

    let reply = `Análise de Inatividade para o grupo: *${groupInfo.subject}*\n\n`;
    reply += `*Total de mensagens registradas:* ${messages.length}\n`;
    reply += `*Análise de mensagens desde:* ${new Date(
      firstMessageTimestamp * 1000,
    ).toLocaleString()}\n\n`;

    if (inactiveUsers.length > 0) {
      reply += `😴 *Usuários Inativos (menos de ${messageLimit} mensagens):* 📉\n`;
      inactiveUsers.forEach(({ jid, count }) => {
        mentions.push(jid);
        const name = `@${jid.split('@')[0]}`;
        reply += `- ${name} (${count} mensagens)\n`;
      });
    } else {
      reply += `🎉 *Nenhum usuário inativo encontrado com menos de ${messageLimit} mensagens.*`;
    }

    await sock.sendMessage(
      remoteJid,
      { text: reply, mentions: mentions },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return; // End execution here
  }

  // --- FULL INFO LOGIC (if --inativos is not present) ---
  let targetGroupId = args[0] || (isGroupMessage ? remoteJid : null);

  if (!targetGroupId) {
    logger.warn('ID do grupo não fornecido para /info em chat privado.');
    await sock.sendMessage(
      remoteJid,
      {
        text: '⚠️ *Por favor, forneça o ID do grupo!\n\nExemplo: `/info 1234567890@g.us`',
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const groupInfo = groupUtils.getGroupInfo(targetGroupId);

  if (!groupInfo) {
    logger.info(`Grupo com ID ${targetGroupId} não encontrado.`);
    await sock.sendMessage(
      remoteJid,
      {
        text: `❌ *Grupo com ID ${targetGroupId} não encontrado.*`,
      },
      { quoted: messageInfo, ephemeralExpiration: expirationMessage },
    );
    return;
  }

  const mentions = [];
  let ownerText = 'N/A';
  const ownerJid = groupUtils.getGroupOwner(targetGroupId);
  if (ownerJid) {
    ownerText = `@${ownerJid.split('@')[0]}`;
    mentions.push(ownerJid);
  }

  let adminsText = 'Nenhum';
  const adminJids = groupUtils.getGroupAdmins(targetGroupId);
  if (adminJids && adminJids.length > 0) {
    adminsText = adminJids
      .map((jid) => {
        mentions.push(jid);
        return `@${jid.split('@')[0]}`;
      })
      .join(', ');
  }

  const allParticipants = groupUtils.getGroupParticipants(targetGroupId) || [];

  let reply =
    `📋 *Informações do Grupo:* ℹ️\n\n` +
    `🆔 *ID:* 🔢 ${groupInfo.id.split('@')[0]}\n` +
    `📝 *Assunto:* 💬 ${groupInfo.subject || 'N/A'}\n` +
    `👑 *Proprietário:* 🤴 ${ownerText}\n` +
    `📅 *Criado em:* 🗓️ ${
      groupUtils.getGroupCreationTime(targetGroupId)
        ? new Date(groupUtils.getGroupCreationTime(targetGroupId) * 1000).toLocaleString()
        : 'N/A'
    }\n` +
    `👥 *Tamanho:* 📏 ${groupUtils.getGroupSize(targetGroupId) || 'N/A'}\n` +
    `🔒 *Restrito:* 🚫 ${groupUtils.isGroupRestricted(targetGroupId) ? 'Sim' : 'Não'}\n` +
    `📢 *Somente anúncios:* 📣 ${groupUtils.isGroupAnnounceOnly(targetGroupId) ? 'Sim' : 'Não'}\n` +
    `🏘️ *Comunidade:* 🏡 ${groupUtils.isGroupCommunity(targetGroupId) ? 'Sim' : 'Não'}\n` +
    `🗣️ *Descrição:* ✍️ ${groupUtils.getGroupDescription(targetGroupId) || 'N/A'}\n` +
    `🛡️ *Administradores:* 👮‍♂️ ${adminsText}\n` +
    `👤 *Total de Participantes:* 🧑‍🤝‍🧑 ${allParticipants.length || 'Nenhum'}`;

  const messages = store.rawMessages[targetGroupId] || [];
  let messageRanking = '';
  let mediaRanking = '';
  let temporalActivity = '';

  if (messages.length > 0) {
    const participantCounts = {};
    const mediaCounts = {};
    let firstMessageTimestamp = Infinity;
    let lastMessageTimestamp = -Infinity;

    const now = Date.now() / 1000;
    const twelveHoursAgo = now - 12 * 3600;
    const sevenDaysAgo = now - 7 * 24 * 3600;

    const messagesLast12Hours = messages.filter((msg) => msg.messageTimestamp >= twelveHoursAgo);
    const messagesLast7Days = messages.filter((msg) => msg.messageTimestamp >= sevenDaysAgo);

    const calculateTemporalActivity = (msgs, title) => {
      const hourly = {};
      const daily = {};
      msgs.forEach((msg) => {
        const messageDate = new Date(msg.messageTimestamp * 1000);
        const hour = messageDate.getHours();
        const day = messageDate.getDay();

        hourly[hour] = (hourly[hour] || 0) + 1;
        daily[day] = (daily[day] || 0) + 1;
      });

      const sortedHourly = Object.entries(hourly).sort((a, b) => b[1] - a[1]);
      const sortedDaily = Object.entries(daily).sort((a, b) => b[1] - a[1]);

      let activityText = `\n*${title}*\n`;
      const dayNames = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado',
      ];

      if (sortedHourly.length > 0) {
        activityText += '_Horários de Pico (Top 3):_ ⬆️\n';
        sortedHourly.slice(0, 3).forEach(([hour, count]) => {
          activityText += `  - ${hour.padStart(2, '0')}h: ${count} mensagens\n`;
        });
      }
      if (sortedDaily.length > 0) {
        activityText += '_Dias de Pico (Top 3):_ 🗓️\n';
        sortedDaily.slice(0, 3).forEach(([day, count]) => {
          activityText += `  - ${dayNames[day]}: ${count} mensagens\n`;
        });
      }
      return activityText;
    };

    messages.forEach((msg) => {
      const participant = msg.key.fromMe
        ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
        : msg.key.participant || msg.participant;

      if (participant) {
        if (!participantCounts[participant]) {
          participantCounts[participant] = 0;
        }
        participantCounts[participant]++;

        if (!mediaCounts[participant]) {
          mediaCounts[participant] = { total: 0, image: 0, video: 0, audio: 0, sticker: 0 };
        }

        const messageType = Object.keys(msg.message || {})[0];
        if (messageType === 'imageMessage') {
          mediaCounts[participant].image++;
          mediaCounts[participant].total++;
        } else if (messageType === 'videoMessage') {
          mediaCounts[participant].video++;
          mediaCounts[participant].total++;
        } else if (messageType === 'audioMessage') {
          mediaCounts[participant].audio++;
          mediaCounts[participant].total++;
        } else if (messageType === 'stickerMessage') {
          mediaCounts[participant].sticker++;
          mediaCounts[participant].total++;
        }
      }

      const timestamp = msg.messageTimestamp;
      if (timestamp < firstMessageTimestamp) {
        firstMessageTimestamp = timestamp;
      }
      if (timestamp > lastMessageTimestamp) {
        lastMessageTimestamp = timestamp;
      }
    });

    const sortedParticipants = Object.entries(participantCounts).sort((a, b) => b[1] - a[1]);
    const sortedMedia = Object.entries(mediaCounts).sort((a, b) => b[1].total - a[1].total);

    messageRanking += '\n\n🏆 *Top 20 - Ranking de Mensagens por Participante* 📈\n';
    sortedParticipants.slice(0, 20).forEach(([jid, count], index) => {
      if (!mentions.includes(jid)) {
        mentions.push(jid);
      }
      const name = `@${jid.split('@')[0]}`;
      messageRanking += `${index + 1}. ${name}: ${count} mensagens\n`;
    });

    if (sortedMedia.length > 0) {
      mediaRanking += '\n\n📸 *Top 20 - Mídia Compartilhada por Participante* 🌟\n';
      sortedMedia.slice(0, 20).forEach(([jid, counts], index) => {
        if (!mentions.includes(jid)) {
          mentions.push(jid);
        }
        const name = `@${jid.split('@')[0]}`;
        const details = `(🖼️: ${counts.image}, 📹: ${counts.video}, 🎤: ${counts.audio}, 🎨: ${counts.sticker})`;
        mediaRanking += `${index + 1}. ${name}: ${counts.total} mídias ${details}\n`;
      });
    }

    const totalMessages = messages.length;
    messageRanking += `\n*Total de mensagens enviadas:* ✉️ ${totalMessages}\n`;

    const durationInSeconds = lastMessageTimestamp - firstMessageTimestamp;
    if (durationInSeconds > 0) {
      const durationInHours = durationInSeconds / 3600;
      const durationInDays = durationInHours / 24;

      if (durationInDays >= 1) {
        const avgPerDay = (totalMessages / durationInDays).toFixed(2);
        messageRanking += `*Média de mensagens por dia:* ☀️ ${avgPerDay}\n\n`;
      } else {
        const avgPerHour = (totalMessages / durationInHours).toFixed(2);
        messageRanking += `*Média de mensagens por hora:* ⏰ ${avgPerHour}\n\n`;
      }
    }

    temporalActivity += '\n\n⏳ *Atividade Temporal* 📈\n';
    temporalActivity += calculateTemporalActivity(messagesLast12Hours, 'Últimas 12 Horas 🕛');
    temporalActivity += calculateTemporalActivity(messagesLast7Days, 'Últimos 7 Dias 🗓️');
  } else {
    messageRanking = '\n\n📊 *Ranking de Mensagens:* Nenhuma mensagem encontrada no histórico. 😔';
  }

  reply += messageRanking + mediaRanking + temporalActivity;

  await sock.sendMessage(
    remoteJid,
    { text: reply, mentions: mentions },
    { quoted: messageInfo, ephemeralExpiration: expirationMessage },
  );
};

module.exports = {
  handleInfoCommand,
};
