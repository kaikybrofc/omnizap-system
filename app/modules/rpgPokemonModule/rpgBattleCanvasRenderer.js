import axios from 'axios';
import { createCanvas, loadImage } from 'canvas';
import logger from '../../utils/logger/loggerModule.js';

const CANVAS_SIZE = 1024;
const PANEL_RADIUS = 24;
const IMAGE_CACHE_TTL_MS = Math.max(2 * 60 * 1000, Number(process.env.RPG_BATTLE_CANVAS_CACHE_TTL_MS) || 10 * 60 * 1000);
const IMAGE_CACHE_LIMIT = Math.max(20, Number(process.env.RPG_BATTLE_CANVAS_CACHE_LIMIT) || 120);
const IMAGE_TIMEOUT_MS = Math.max(2_000, Number(process.env.RPG_BATTLE_CANVAS_TIMEOUT_MS) || 7_000);

const imageCache = globalThis.__omnizapBattleCanvasImageCache instanceof Map
  ? globalThis.__omnizapBattleCanvasImageCache
  : new Map();
globalThis.__omnizapBattleCanvasImageCache = imageCache;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const toRatio = (currentHp, maxHp) => {
  const max = Math.max(1, toInt(maxHp, 1));
  const current = clamp(toInt(currentHp, 0), 0, max);
  return current / max;
};

const hpColorByRatio = (ratio) => {
  if (ratio <= 0.25) return '#ef4444';
  if (ratio <= 0.55) return '#f59e0b';
  return '#22c55e';
};

const TYPE_COLORS = new Map([
  ['normal', '#a8a77a'],
  ['fire', '#ee8130'],
  ['water', '#6390f0'],
  ['electric', '#f7d02c'],
  ['grass', '#7ac74c'],
  ['ice', '#96d9d6'],
  ['fighting', '#c22e28'],
  ['poison', '#a33ea1'],
  ['ground', '#e2bf65'],
  ['flying', '#a98ff3'],
  ['psychic', '#f95587'],
  ['bug', '#a6b91a'],
  ['rock', '#b6a136'],
  ['ghost', '#735797'],
  ['dragon', '#6f35fc'],
  ['dark', '#705746'],
  ['steel', '#b7b7ce'],
  ['fairy', '#d685ad'],
]);

const STATUS_MAP = new Map([
  ['burn', { icon: '🔥', label: 'BRN', color: '#f97316' }],
  ['brn', { icon: '🔥', label: 'BRN', color: '#f97316' }],
  ['poison', { icon: '☠', label: 'PSN', color: '#a855f7' }],
  ['psn', { icon: '☠', label: 'PSN', color: '#a855f7' }],
  ['toxic', { icon: '☠', label: 'TOX', color: '#7c3aed' }],
  ['bad-poison', { icon: '☠', label: 'TOX', color: '#7c3aed' }],
  ['paralyze', { icon: '⚡', label: 'PAR', color: '#facc15' }],
  ['paralysis', { icon: '⚡', label: 'PAR', color: '#facc15' }],
  ['par', { icon: '⚡', label: 'PAR', color: '#facc15' }],
]);

const BIOME_THEMES = [
  { match: ['forest', 'floresta', 'grass', 'jungle', 'leaf'], colors: ['#134e4a', '#166534', '#0f766e'] },
  { match: ['volcano', 'fire', 'magma', 'lava'], colors: ['#7f1d1d', '#b91c1c', '#f97316'] },
  { match: ['water', 'ocean', 'sea', 'lake', 'river'], colors: ['#082f49', '#0c4a6e', '#0369a1'] },
  { match: ['mountain', 'rock', 'cave'], colors: ['#292524', '#44403c', '#57534e'] },
  { match: ['desert', 'sand', 'ground'], colors: ['#78350f', '#92400e', '#b45309'] },
  { match: ['ice', 'snow', 'tundra'], colors: ['#0f172a', '#1d4ed8', '#22d3ee'] },
];

const trimText = (value, max = 120) => {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(24, max - 1)).trimEnd()}…`;
};

const fitText = (ctx, text, maxWidth, baseSize, weight = 700, family = 'Sans') => {
  let size = baseSize;
  while (size > 14) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return;
    size -= 1;
  }
};

const drawRoundRect = (ctx, x, y, width, height, radius, fillStyle) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
};

const cleanupCache = () => {
  const now = Date.now();
  for (const [key, entry] of imageCache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      imageCache.delete(key);
    }
  }

  if (imageCache.size <= IMAGE_CACHE_LIMIT) return;
  const overflow = imageCache.size - IMAGE_CACHE_LIMIT;
  const keys = [...imageCache.keys()].slice(0, overflow);
  keys.forEach((key) => imageCache.delete(key));
};

const resolveImage = async (imageUrl) => {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  cleanupCache();
  const cached = imageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.image;

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: IMAGE_TIMEOUT_MS,
      headers: { Accept: 'image/*' },
    });
    const image = await loadImage(Buffer.from(response.data));
    imageCache.set(url, { image, expiresAt: Date.now() + IMAGE_CACHE_TTL_MS });
    return image;
  } catch (error) {
    imageCache.set(url, { image: null, expiresAt: Date.now() + 90_000 });
    logger.debug('Falha ao carregar sprite para frame de batalha.', {
      imageUrl: url,
      error: error.message,
    });
    return null;
  }
};

const resolveBiomeTheme = (biomeLabel) => {
  const normalized = String(biomeLabel || '').trim().toLowerCase();
  if (!normalized) return ['#0f172a', '#1f2937', '#334155'];
  for (const theme of BIOME_THEMES) {
    if (theme.match.some((entry) => normalized.includes(entry))) return theme.colors;
  }
  return ['#1d4ed8', '#1e3a8a', '#334155'];
};

const normalizeTypeList = (types) => {
  if (!Array.isArray(types)) return [];
  return types
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);
};

const normalizeStatuses = (pokemon = {}) => {
  const candidates = [
    pokemon?.status,
    pokemon?.nonVolatileStatus,
    pokemon?.condition,
    pokemon?.statusCondition,
    ...(Array.isArray(pokemon?.statusEffects) ? pokemon.statusEffects : []),
    ...(Array.isArray(pokemon?.conditions) ? pokemon.conditions : []),
    ...(Array.isArray(pokemon?.statuses) ? pokemon.statuses : []),
  ];
  const found = [];
  for (const candidate of candidates) {
    const key = String(candidate || '').trim().toLowerCase();
    if (!key) continue;
    const normalized = STATUS_MAP.get(key);
    if (!normalized) continue;
    if (!found.some((entry) => entry.label === normalized.label)) {
      found.push(normalized);
    }
  }
  return found.slice(0, 3);
};

const drawBackground = (ctx, biomeLabel) => {
  const [c1, c2, c3] = resolveBiomeTheme(biomeLabel);
  const gradient = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  gradient.addColorStop(0, c1);
  gradient.addColorStop(0.52, c2);
  gradient.addColorStop(1, c3);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i <= 14; i += 1) {
    const y = 160 + i * 42;
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(CANVAS_SIZE - 40, y + (i % 2 === 0 ? 10 : -10));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const vignette = ctx.createRadialGradient(
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
    CANVAS_SIZE * 0.2,
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
    CANVAS_SIZE * 0.65,
  );
  vignette.addColorStop(0, 'rgba(255,255,255,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
};

const drawArena = (ctx) => {
  ctx.globalAlpha = 0.22;
  drawRoundRect(ctx, 80, 610, 360, 120, 90, '#cbd5e1');
  drawRoundRect(ctx, CANVAS_SIZE - 440, 270, 360, 120, 90, '#cbd5e1');
  ctx.globalAlpha = 1;
};

const drawShinyAura = (ctx, x, y, width, height) => {
  const gradient = ctx.createRadialGradient(x, y, 28, x, y, Math.max(width, height) * 0.65);
  gradient.addColorStop(0, 'rgba(252,211,77,0.66)');
  gradient.addColorStop(0.4, 'rgba(59,130,246,0.26)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(x, y, width * 0.72, height * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
};

const drawPokemon = async (ctx, pokemon = {}, opts = {}) => {
  const {
    centerX = 0,
    centerY = 0,
    maxWidth = 260,
    maxHeight = 260,
    facing = 'right',
    isPrimary = false,
  } = opts;
  const image = await resolveImage(pokemon?.imageUrl || pokemon?.sprite);
  const scaleBonus = isPrimary ? 1.08 : 0.96;
  const targetMaxW = maxWidth * scaleBonus;
  const targetMaxH = maxHeight * scaleBonus;
  const isShiny = Boolean(pokemon?.isShiny);

  if (image) {
    const ratio = Math.min(targetMaxW / image.width, targetMaxH / image.height);
    const width = Math.max(40, Math.round(image.width * ratio));
    const height = Math.max(40, Math.round(image.height * ratio));
    const drawX = centerX - width / 2;
    const drawY = centerY - height / 2;

    if (isShiny) drawShinyAura(ctx, centerX, centerY, width, height);

    ctx.save();
    if (facing === 'left') {
      ctx.translate(centerX, centerY);
      ctx.scale(-1, 1);
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    } else {
      ctx.drawImage(image, drawX, drawY, width, height);
    }
    ctx.restore();
    return;
  }

  const fallbackW = Math.round(targetMaxW * 0.75);
  const fallbackH = Math.round(targetMaxH * 0.75);
  if (isShiny) drawShinyAura(ctx, centerX, centerY, fallbackW, fallbackH);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  drawRoundRect(ctx, centerX - fallbackW / 2, centerY - fallbackH / 2, fallbackW, fallbackH, 28, 'rgba(255,255,255,0.14)');
  ctx.fillStyle = '#ffffff';
  fitText(ctx, trimText(pokemon?.displayName || pokemon?.name || 'Pokemon', 18), fallbackW - 28, 30, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(trimText(pokemon?.displayName || pokemon?.name || 'Pokemon', 18), centerX, centerY);
};

const drawTypeBadges = (ctx, types = [], x, y) => {
  let cursor = x;
  types.forEach((type) => {
    const label = String(type || '').slice(0, 3).toUpperCase();
    const width = 58;
    drawRoundRect(ctx, cursor, y, width, 24, 12, TYPE_COLORS.get(type) || '#475569');
    ctx.fillStyle = '#0b1220';
    ctx.font = '700 14px Sans';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cursor + width / 2, y + 12);
    cursor += width + 8;
  });
};

const drawStatusBadges = (ctx, statuses = [], x, y) => {
  let cursor = x;
  statuses.forEach((entry) => {
    const width = 70;
    drawRoundRect(ctx, cursor, y, width, 24, 12, entry.color);
    ctx.fillStyle = '#111827';
    ctx.font = '700 14px Sans';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${entry.icon} ${entry.label}`, cursor + width / 2, y + 12);
    cursor += width + 8;
  });
};

const drawStatusPanel = (ctx, pokemon = {}, opts = {}) => {
  const {
    x = 0,
    y = 0,
    width = 360,
    height = 150,
    align = 'left',
  } = opts;

  drawRoundRect(ctx, x, y, width, height, PANEL_RADIUS, 'rgba(15,23,42,0.62)');
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  drawRoundRect(ctx, x, y, width, height, PANEL_RADIUS);
  ctx.stroke();

  const name = trimText(pokemon?.displayName || pokemon?.name || 'Pokemon', 24);
  const level = Math.max(1, toInt(pokemon?.level, 1));
  const hpCurrent = Math.max(0, toInt(pokemon?.currentHp, 0));
  const hpMax = Math.max(1, toInt(pokemon?.maxHp, 1));
  const hpRatio = toRatio(hpCurrent, hpMax);
  const hpColor = hpColorByRatio(hpRatio);
  const types = normalizeTypeList(pokemon?.types);
  const statuses = normalizeStatuses(pokemon);
  const padding = 16;
  const textX = align === 'left' ? x + padding : x + width - padding;

  ctx.fillStyle = '#e2e8f0';
  fitText(ctx, name, width - 120, 28, 800);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, textX, y + 34);

  ctx.fillStyle = '#93c5fd';
  ctx.font = '700 18px Sans';
  ctx.fillText(`Lv.${level}`, textX, y + 58);

  const barX = x + padding;
  const barY = y + 72;
  const barW = width - padding * 2;
  const barH = 18;
  drawRoundRect(ctx, barX, barY, barW, barH, 9, 'rgba(148,163,184,0.35)');
  drawRoundRect(ctx, barX, barY, Math.max(18, Math.round(barW * hpRatio)), barH, 9, hpColor);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 15px Sans';
  ctx.textAlign = 'center';
  ctx.fillText(`${hpCurrent}/${hpMax}`, barX + barW / 2, barY + 14);

  const badgeX = x + padding;
  drawTypeBadges(ctx, types, badgeX, y + 98);
  if (statuses.length) {
    drawStatusBadges(ctx, statuses, badgeX, y + 126);
  }
};

const drawOverlay = (ctx, { turn = 1, modeLabel = 'Batalha', actionText = '', effectTag = null }) => {
  const panelX = 88;
  const panelY = 770;
  const panelW = CANVAS_SIZE - 176;
  const panelH = 188;
  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 26, 'rgba(2,6,23,0.68)');
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 26);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 30px Sans';
  ctx.textAlign = 'left';
  ctx.fillText(`${modeLabel}  •  Turno ${Math.max(1, toInt(turn, 1))}`, panelX + 22, panelY + 42);

  ctx.fillStyle = '#bfdbfe';
  ctx.font = '600 24px Sans';
  const action = trimText(actionText || 'Aguardando ação do jogador.', 96);
  ctx.fillText(action, panelX + 22, panelY + 92);

  if (!effectTag) return;
  const palette =
    effectTag === 'super'
      ? { label: 'SUPER EFETIVO', color: '#ef4444' }
      : effectTag === 'weak'
        ? { label: 'POUCO EFETIVO', color: '#f59e0b' }
        : effectTag === 'none'
          ? { label: 'SEM EFEITO', color: '#64748b' }
          : null;
  if (!palette) return;
  const badgeW = 220;
  drawRoundRect(ctx, CANVAS_SIZE / 2 - badgeW / 2, 38, badgeW, 44, 22, palette.color);
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 18px Sans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(palette.label, CANVAS_SIZE / 2, 60);
};

const drawTurnImpact = (ctx, { effectTag = null, turn = 1 }) => {
  const intensity = effectTag === 'super' ? 0.28 : effectTag === 'weak' ? 0.16 : 0.1;
  const pulse = (Math.max(1, toInt(turn, 1)) % 2 === 0 ? 1 : 0.8) * intensity;
  ctx.globalAlpha = pulse;
  const flash = ctx.createRadialGradient(CANVAS_SIZE / 2, CANVAS_SIZE / 2, 40, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 360);
  flash.addColorStop(0, effectTag === 'super' ? '#fca5a5' : '#f8fafc');
  flash.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = flash;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.globalAlpha = 1;
};

export const inferEffectTagFromLogs = (logs = []) => {
  const text = (Array.isArray(logs) ? logs : []).join(' ').toLowerCase();
  if (text.includes('super efetivo')) return 'super';
  if (text.includes('pouco efetivo')) return 'weak';
  if (text.includes('não teve efeito') || text.includes('nao teve efeito')) return 'none';
  return null;
};

export const renderBattleFrameCanvas = async ({
  leftPokemon = {},
  rightPokemon = {},
  turn = 1,
  biomeLabel = '',
  modeLabel = 'Batalha Pokemon',
  actionText = '',
  effectTag = null,
}) => {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawBackground(ctx, biomeLabel);
  drawArena(ctx);

  await Promise.all([
    drawPokemon(ctx, leftPokemon, {
      centerX: 300,
      centerY: 556,
      maxWidth: 328,
      maxHeight: 328,
      facing: 'right',
      isPrimary: true,
    }),
    drawPokemon(ctx, rightPokemon, {
      centerX: 726,
      centerY: 346,
      maxWidth: 288,
      maxHeight: 288,
      facing: 'left',
      isPrimary: false,
    }),
  ]);

  drawStatusPanel(ctx, leftPokemon, {
    x: 44,
    y: 458,
    width: 420,
    height: 168,
    align: 'left',
  });
  drawStatusPanel(ctx, rightPokemon, {
    x: CANVAS_SIZE - 464,
    y: 110,
    width: 420,
    height: 168,
    align: 'right',
  });

  drawTurnImpact(ctx, { effectTag, turn });
  drawOverlay(ctx, { turn, modeLabel, actionText, effectTag });

  return canvas.toBuffer('image/png', { compressionLevel: 4 });
};

