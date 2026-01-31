import { isUserAdmin, updateGroupParticipants } from '../../config/groupUtils.js';
import { getJidUser } from '../../config/baileysConfig.js';
import groupConfigStore from '../../store/groupConfigStore.js';
import logger from '../logger/loggerModule.js';
import { sendAndStore } from '../../services/messagePersistenceService.js';

/**
 * Base de redes conhecidas e seus domínios oficiais para permitir por categoria.
 * @type {Record<string, string[]>}
 */
export const KNOWN_NETWORKS = {
  youtube: [
    'youtube.com',
    'youtu.be',
    'music.youtube.com',
    'm.youtube.com',
    'shorts.youtube.com',
    'youtube-nocookie.com',
  ],
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com', 'l.facebook.com'],
  tiktok: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  twitter: ['twitter.com', 'x.com', 't.co', 'mobile.twitter.com'],
  linkedin: ['linkedin.com', 'lnkd.in'],
  twitch: ['twitch.tv', 'clips.twitch.tv'],
  discord: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net'],
  whatsapp: ['chat.whatsapp.com', 'wa.me'],
  telegram: ['t.me', 'telegram.me', 'telesco.pe'],
  reddit: ['reddit.com', 'redd.it'],
  pinterest: ['pinterest.com', 'pin.it'],
  snapchat: ['snapchat.com', 'snap.com'],
  kwai: ['kwai.com', 'kw.ai'],
  likee: ['likee.video'],
  vimeo: ['vimeo.com', 'player.vimeo.com'],
  dailymotion: ['dailymotion.com', 'dai.ly'],
  rumble: ['rumble.com'],
  kick: ['kick.com'],
  soundcloud: ['soundcloud.com'],
  spotify: ['spotify.com', 'open.spotify.com'],
  deezer: ['deezer.com', 'deezer.page.link'],
  applemusic: ['music.apple.com'],
  shazam: ['shazam.com'],
  bandcamp: ['bandcamp.com'],
  amazonmusic: ['music.amazon.com'],
  imdb: ['imdb.com'],
  letterboxd: ['letterboxd.com'],
  goodreads: ['goodreads.com'],
  medium: ['medium.com'],
  substack: ['substack.com'],
  behance: ['behance.net'],
  dribbble: ['dribbble.com'],
  deviantart: ['deviantart.com'],
  artstation: ['artstation.com'],
  figma: ['figma.com', 'figma.io'],
  github: ['github.com', 'gist.github.com', 'github.io'],
  gitlab: ['gitlab.com'],
  bitbucket: ['bitbucket.org'],
  npm: ['npmjs.com'],
  pypi: ['pypi.org'],
  stackoverflow: ['stackoverflow.com', 'stackexchange.com'],
  quora: ['quora.com'],
  stackshare: ['stackshare.io'],
  producthunt: ['producthunt.com'],
  hackernews: ['news.ycombinator.com'],
  google: ['google.com', 'goo.gl', 'g.co', 'maps.google.com'],
  maps: ['google.com', 'maps.google.com', 'goo.gl', 'g.page'],
  playstore: ['play.google.com'],
  appstore: ['apps.apple.com'],
  steam: ['steamcommunity.com', 'store.steampowered.com', 'steamdb.info'],
  epicgames: ['epicgames.com'],
  discordbots: ['top.gg', 'discords.com', 'discordbotlist.com'],
  cloudflare: ['cloudflare.com', 'pages.dev', 'workers.dev'],
  heroku: ['heroku.com', 'herokuapp.com'],
  vercel: ['vercel.app', 'vercel.com'],
  netlify: ['netlify.app', 'netlify.com'],
  firebase: ['firebase.google.com', 'web.app'],
  hostinger: ['hostinger.com'],
  wix: ['wix.com', 'wixsite.com'],
  squarespace: ['squarespace.com'],
  wordpress: ['wordpress.com', 'wordpress.org'],
  blogger: ['blogger.com', 'blogspot.com'],
  tumblr: ['tumblr.com'],
  weibo: ['weibo.com'],
  vk: ['vk.com'],
  okru: ['ok.ru'],
  line: ['line.me'],
  wechat: ['wechat.com', 'weixin.qq.com', 'we.chat'],
  qq: ['qq.com'],
  signal: ['signal.org'],
  skype: ['skype.com'],
  slack: ['slack.com'],
  zoom: ['zoom.us', 'zoom.com'],
  meet: ['meet.google.com'],
  teams: ['microsoft.com', 'teams.microsoft.com'],
  canva: ['canva.com'],
  notion: ['notion.so', 'notion.site'],
  trello: ['trello.com'],
  asana: ['asana.com'],
  monday: ['monday.com'],
  clickup: ['clickup.com'],
  airtable: ['airtable.com'],
  coursera: ['coursera.org'],
  udemy: ['udemy.com'],
  udacity: ['udacity.com'],
  edx: ['edx.org'],
  khanacademy: ['khanacademy.org'],
  duolingo: ['duolingo.com'],
  roblox: ['roblox.com'],
  minecraft: ['minecraft.net', 'minecraft.net.br'],
  valorant: ['valorant.com'],
  riot: ['riotgames.com'],
  leagueoflegends: ['leagueoflegends.com'],
  dota2: ['dota2.com'],
  csgo: ['counter-strike.net'],
};

/**
 * Extrai domínios (sem protocolo/www) de um texto livre.
 * @param {string} text
 * @returns {string[]}
 */
const extractDomains = (text) => {
  if (!text) return [];
  const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/[^\s]*)?/gi;
  const domains = new Set();
  let match;

  while ((match = domainRegex.exec(text)) !== null) {
    const domain = match[1].toLowerCase().replace(/\.$/, '');
    domains.add(domain);
  }

  return Array.from(domains);
};

/**
 * Aceita o domínio exato ou subdomínios de um permitido.
 * @param {string} domain
 * @param {string[]} allowedDomains
 * @returns {boolean}
 */
const isDomainAllowed = (domain, allowedDomains) =>
  allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));

/**
 * Monta a lista final de domínios permitidos (redes conhecidas + personalizados).
 * @param {string[]} allowedNetworks
 * @param {string[]} allowedCustomDomains
 * @returns {string[]}
 */
const getAllowedDomains = (allowedNetworks = [], allowedCustomDomains = []) => {
  const domains = [];
  for (const network of allowedNetworks) {
    if (KNOWN_NETWORKS[network]) {
      domains.push(...KNOWN_NETWORKS[network]);
    }
  }
  return [...domains, ...allowedCustomDomains];
};

/**
 * Retorna true quando existir um link que não esteja na lista permitida.
 * @param {string} text
 * @param {string[]} allowedDomains
 * @returns {boolean}
 */
export const isLinkDetected = (text, allowedDomains = []) => {
  const domains = extractDomains(text);
  if (domains.length === 0) return false;
  if (allowedDomains.length === 0) return true;
  return domains.some((domain) => !isDomainAllowed(domain, allowedDomains));
};

/**
 * Aplica a regra de antilink do grupo. Retorna true quando removeu e deve pular o restante.
 * @param {Object} params
 * @param {import('@whiskeysockets/baileys').WASocket} params.sock
 * @param {Object} params.messageInfo
 * @param {string} params.extractedText
 * @param {string} params.remoteJid
 * @param {string} params.senderJid
 * @param {string} params.botJid
 * @returns {Promise<boolean>}
 */
export const handleAntiLink = async ({
  sock,
  messageInfo,
  extractedText,
  remoteJid,
  senderJid,
  botJid,
}) => {
  if (!senderJid) return false;
  if (senderJid === botJid) return false;
  const groupConfig = await groupConfigStore.getGroupConfig(remoteJid);
  if (!groupConfig || !groupConfig.antilinkEnabled) return false;

  const allowedDomains = getAllowedDomains(
    groupConfig.antilinkAllowedNetworks || [],
    groupConfig.antilinkAllowedDomains || [],
  );
  if (!isLinkDetected(extractedText, allowedDomains)) return false;

  const isAdmin = await isUserAdmin(remoteJid, senderJid);
  const senderIsBot = senderJid === botJid;

  if (!isAdmin && !senderIsBot) {
    try {
      await updateGroupParticipants(sock, remoteJid, [senderJid], 'remove');
      const senderUser = getJidUser(senderJid);
      await sendAndStore(sock, remoteJid, {
        text: `🚫 @${senderUser || 'usuario'} foi removido por enviar um link.`,
        mentions: senderUser ? [senderJid] : [],
      });
      await sendAndStore(sock, remoteJid, { delete: messageInfo.key });

      logger.info(`Usuário ${senderJid} removido do grupo ${remoteJid} por enviar link.`, {
        action: 'antilink_remove',
        groupId: remoteJid,
        userId: senderJid,
      });

      return true;
    } catch (error) {
      logger.error(`Falha ao remover usuário com antilink: ${error.message}`, {
        action: 'antilink_error',
        groupId: remoteJid,
        userId: senderJid,
        error: error.stack,
      });
    }
  } else if (isAdmin && !senderIsBot) {
    try {
      const senderUser = getJidUser(senderJid);
      await sendAndStore(sock, remoteJid, {
        text: `ⓘ @${senderUser || 'admin'} (admin) enviou um link.`,
        mentions: senderUser ? [senderJid] : [],
      });
      logger.info(`Admin ${senderJid} enviou um link no grupo ${remoteJid} (aviso enviado).`, {
        action: 'antilink_admin_link_detected',
        groupId: remoteJid,
        userId: senderJid,
      });
    } catch (error) {
      logger.error(`Falha ao enviar aviso de link de admin: ${error.message}`, {
        action: 'antilink_admin_warning_error',
        groupId: remoteJid,
        userId: senderJid,
        error: error.stack,
      });
    }
  }

  return false;
};
