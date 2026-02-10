const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatName = (name) => {
  const raw = String(name || '').trim();
  if (!raw) return 'Pokemon';
  return raw
    .split('-')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
    .join(' ');
};

const formatPokemonLabel = ({ name, isShiny = false }) => {
  const label = formatName(name);
  return isShiny ? `✨ ${label}` : label;
};

const hpBar = (current, max, size = 10) => {
  const safeMax = Math.max(1, toNumber(max, 1));
  const safeCurrent = Math.max(0, Math.min(safeMax, toNumber(current, 0)));
  const ratio = safeCurrent / safeMax;
  const filled = Math.max(0, Math.min(size, Math.round(ratio * size)));
  const empty = Math.max(0, size - filled);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${safeCurrent}/${safeMax}`;
};

const moveLine = (move, index) => {
  const power = toNumber(move?.power, 0);
  const moveName = formatName(move?.displayName || move?.name || `Move ${index + 1}`);
  const type = String(move?.type || 'normal').toUpperCase();
  if (power <= 0) {
    return `${index + 1}. ${moveName} (${type})`;
  }
  return `${index + 1}. ${moveName} (${type} • ${power})`;
};

export const buildUsageText = (prefix = '/') =>
  [
    '*RPG Pokemon*',
    `${prefix}rpg start`,
    `${prefix}rpg perfil`,
    `${prefix}rpg explorar`,
    `${prefix}rpg atacar <1|2|3|4>`,
    `${prefix}rpg capturar`,
    `${prefix}rpg fugir`,
    `${prefix}rpg time`,
    `${prefix}rpg escolher <pokemon_id>`,
    `${prefix}rpg loja`,
    `${prefix}rpg comprar <item> <qtd>`,
    `${prefix}rpg usar <item>`,
    `${prefix}rpg bolsa`,
    `${prefix}rpg missoes`,
    `${prefix}rpg ginasio`,
  ].join('\n');

export const buildCooldownText = ({ secondsLeft, prefix = '/' }) =>
  `⏳ Aguarde ${secondsLeft}s para a próxima ação.\nPróximo: ${prefix}rpg perfil`;

export const buildNeedStartText = (prefix = '/') => `Você ainda não iniciou sua jornada.\nUse: ${prefix}rpg start`;

export const buildStartText = ({ isNewPlayer, starterPokemon, prefix = '/' }) => {
  if (!isNewPlayer) {
    return `Você já tem conta no RPG.\nPróximo: ${prefix}rpg perfil`;
  }

  return [
    '🎒 Jornada iniciada!',
    `Parceiro inicial: *${formatPokemonLabel({ name: starterPokemon.displayName || starterPokemon.name, isShiny: starterPokemon.isShiny })}* (ID do time: ${starterPokemon.id})`,
    `Próximos: ${prefix}rpg perfil | ${prefix}rpg explorar`,
  ].join('\n');
};

export const buildProfileText = ({ player, activePokemon, prefix = '/' }) => {
  const lines = [
    '👤 *Seu Perfil RPG*',
    `Nível: *${toNumber(player?.level, 1)}*`,
    `XP: *${toNumber(player?.xp, 0)}*`,
    `Gold: *${toNumber(player?.gold, 0)}*`,
  ];

  if (activePokemon) {
    lines.push(
      `Ativo: *${formatPokemonLabel({ name: activePokemon.displayName || activePokemon.name, isShiny: activePokemon.isShiny })}* (ID: ${activePokemon.id})`,
      `HP: ${hpBar(activePokemon.currentHp, activePokemon.maxHp)}`,
    );
  } else {
    lines.push('Ativo: nenhum Pokemon selecionado.');
  }

  lines.push(`Próximos: ${prefix}rpg explorar | ${prefix}rpg time`);
  return lines.join('\n');
};

export const buildTeamText = ({ team, prefix = '/' }) => {
  if (!team.length) {
    return `Seu time está vazio.\nUse: ${prefix}rpg explorar e ${prefix}rpg capturar`;
  }

  const rows = team.map((pokemon) => {
    const marker = pokemon.isActive ? '⭐' : '•';
    return `${marker} ID ${pokemon.id} | ${formatPokemonLabel({ name: pokemon.displayName || pokemon.name, isShiny: pokemon.isShiny })} Lv.${pokemon.level} | HP ${pokemon.currentHp}/${pokemon.maxHp}`;
  });

  return ['🎯 *Seu Time*', ...rows, `Trocar ativo: ${prefix}rpg escolher <pokemon_id>`].join('\n');
};

export const buildNeedActivePokemonText = (prefix = '/') =>
  `Você não tem Pokemon ativo para batalhar.\nUse: ${prefix}rpg time e ${prefix}rpg escolher <pokemon_id>`;

export const buildPokemonFaintedText = (prefix = '/') =>
  `Seu Pokemon ativo está sem HP.\nEscolha outro: ${prefix}rpg escolher <pokemon_id>`;

export const buildBattleStartText = ({ battleSnapshot, prefix = '/' }) => {
  const my = battleSnapshot.my;
  const enemy = battleSnapshot.enemy;
  const lines = [];

  if (battleSnapshot.mode === 'gym') {
    lines.push('🏟️ *Desafio de Ginasio*');
  }

  if (enemy.isShiny) {
    lines.push('✨ UM POKEMON SHINY APARECEU! ✨');
  }

  if (battleSnapshot.biome?.label) {
    lines.push(`🌍 Bioma: ${battleSnapshot.biome.label}`);
  }

  lines.push(
    `🌿 Selvagem: *${formatPokemonLabel({ name: enemy.displayName || enemy.name, isShiny: enemy.isShiny })}* Lv.${enemy.level}`,
    `HP inimigo: ${hpBar(enemy.currentHp, enemy.maxHp)}`,
    `Seu: *${formatPokemonLabel({ name: my.displayName || my.name, isShiny: my.isShiny })}* Lv.${my.level}`,
    `Seu HP: ${hpBar(my.currentHp, my.maxHp)}`,
    'Movimentos:',
    ...my.moves.map(moveLine),
    `Próximos: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`,
  );

  return lines.join('\n');
};

export const buildBattleTurnText = ({ logs = [], battleSnapshot, prefix = '/', rewards = null, evolution = null }) => {
  const my = battleSnapshot.my;
  const enemy = battleSnapshot.enemy;

  const lines = [...logs];
  lines.push(`Seu HP: ${hpBar(my.currentHp, my.maxHp)}`);
  lines.push(`HP inimigo: ${hpBar(enemy.currentHp, enemy.maxHp)}`);

  if (enemy.currentHp <= 0 && rewards) {
    lines.push(`🏆 Vitória! +${rewards.playerXp} XP jogador | +${rewards.pokemonXp} XP Pokemon | +${rewards.gold} gold`);
    if (evolution?.fromName && evolution?.toName) {
      lines.push(`🎉 Seu ${formatName(evolution.fromName)} evoluiu para ${formatName(evolution.toName)}!`);
    }
    lines.push(`Próximo: ${prefix}rpg explorar`);
    return lines.join('\n');
  }

  if (my.currentHp <= 0) {
    lines.push('💥 Seu Pokemon desmaiou.');
    lines.push(`Próximo: ${prefix}rpg escolher <pokemon_id>`);
    return lines.join('\n');
  }

  lines.push(`Próximos: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`);
  return lines.join('\n');
};

export const buildCaptureSuccessText = ({ capturedPokemon, prefix = '/' }) =>
  `🎉 Captura concluída: *${formatPokemonLabel({ name: capturedPokemon.displayName || capturedPokemon.name, isShiny: capturedPokemon.isShiny })}* (ID ${capturedPokemon.id}).\nPróximos: ${prefix}rpg time | ${prefix}rpg explorar`;

export const buildCaptureBlockedGymText = (prefix = '/') =>
  `Em batalha de ginasio não é possível capturar.\nUse: ${prefix}rpg atacar <1-4> ou ${prefix}rpg fugir`;

export const buildCaptureFailText = ({ logs = [], battleSnapshot, prefix = '/' }) => {
  const my = battleSnapshot.my;
  const enemy = battleSnapshot.enemy;

  const lines = [
    ...logs,
    `Seu HP: ${hpBar(my.currentHp, my.maxHp)}`,
    `HP inimigo: ${hpBar(enemy.currentHp, enemy.maxHp)}`,
  ];

  if (my.currentHp <= 0) {
    lines.push(`Próximo: ${prefix}rpg escolher <pokemon_id>`);
    return lines.join('\n');
  }

  lines.push(`Próximos: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`);
  return lines.join('\n');
};

export const buildFleeText = (prefix = '/') => `🏃 Você fugiu da batalha.\nPróximo: ${prefix}rpg explorar`;

export const buildNoBattleText = (prefix = '/') => `Nenhuma batalha ativa.\nUse: ${prefix}rpg explorar`;

export const buildShopText = ({ items, prefix = '/' }) => {
  const itemLines = items.map((item) => `• ${item.key} — ${item.price} gold (${item.description})`);
  return ['🛒 *Loja RPG*', ...itemLines, `Comprar: ${prefix}rpg comprar <item> <qtd>`, `Usar: ${prefix}rpg usar <item>`].join('\n');
};

export const buildBuySuccessText = ({ item, quantity, totalPrice, goldLeft, prefix = '/' }) =>
  `✅ Compra concluída: ${quantity}x *${item.label}* por ${totalPrice} gold.\nGold restante: ${goldLeft}.\nPróximo: ${prefix}rpg loja`;

export const buildBuyErrorText = ({ reason = 'erro', prefix = '/' }) => {
  if (reason === 'invalid_item') return `Item inválido.\nUse: ${prefix}rpg loja`;
  if (reason === 'invalid_quantity') return `Quantidade inválida.\nUse: ${prefix}rpg comprar <item> <qtd>`;
  if (reason === 'not_enough_gold') return `Gold insuficiente para essa compra.\nUse: ${prefix}rpg loja`;
  return `Não foi possível processar a compra agora.\nTente: ${prefix}rpg loja`;
};

export const buildBattleAlreadyActiveText = (prefix = '/') =>
  `Você já está em batalha.\nUse: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`;

export const buildUseItemUsageText = (prefix = '/') =>
  `Use: ${prefix}rpg usar <potion|superpotion|pokeball>`;

export const buildUseItemErrorText = ({ reason = 'invalid_item', prefix = '/' }) => {
  if (reason === 'invalid_item') return `Item inválido para uso.\n${buildUseItemUsageText(prefix)}`;
  if (reason === 'no_item') return `Você não tem esse item no inventário.\nCompre em: ${prefix}rpg loja`;
  if (reason === 'full_hp') return `Seu Pokemon já está com HP cheio.\nPróximo: ${prefix}rpg explorar`;
  if (reason === 'no_active_pokemon') return `Sem Pokemon ativo.\nUse: ${prefix}rpg escolher <pokemon_id>`;
  if (reason === 'no_battle_for_pokeball') return `Poke Bola só pode ser usada em batalha.\nUse: ${prefix}rpg explorar`;
  return `Não foi possível usar item agora.\nPróximo: ${prefix}rpg perfil`;
};

export const buildUsePotionSuccessText = ({
  itemLabel,
  healedAmount,
  pokemonName,
  currentHp,
  maxHp,
  quantityLeft,
  prefix = '/',
}) =>
  `🧪 ${itemLabel} usada em *${formatName(pokemonName)}* (+${healedAmount} HP).\nHP: ${currentHp}/${maxHp} | ${itemLabel} restantes: ${quantityLeft}\nPróximos: ${prefix}rpg atacar <1-4> | ${prefix}rpg explorar`;

export const buildBagText = ({ items = [], gold = 0, prefix = '/' }) => {
  if (!items.length) {
    return `🎒 *Sua Bolsa*\nGold: *${gold}*\nSem itens no momento.\nCompre em: ${prefix}rpg loja`;
  }

  const lines = items.map((item) => `• ${item.label}: ${item.quantity}`);
  return ['🎒 *Sua Bolsa*', `Gold: *${gold}*`, ...lines, `Usar: ${prefix}rpg usar <item>`].join('\n');
};

const missionLine = (label, current, target) => `• ${label}: ${Math.max(0, current)}/${target}`;

export const buildMissionsText = ({ daily, weekly, prefix = '/' }) => {
  const lines = ['🎯 *Missões*'];

  lines.push(
    '',
    '*Diária*',
    missionLine('Explorar', daily.explorar, daily.target.explorar),
    missionLine('Vitórias', daily.vitorias, daily.target.vitorias),
    missionLine('Capturas', daily.capturas, daily.target.capturas),
    daily.claimed ? '✅ Recompensa diária já coletada' : daily.completed ? '🎁 Recompensa diária pronta' : '⏳ Diária em progresso',
  );

  lines.push(
    '',
    '*Semanal*',
    missionLine('Explorar', weekly.explorar, weekly.target.explorar),
    missionLine('Vitórias', weekly.vitorias, weekly.target.vitorias),
    missionLine('Capturas', weekly.capturas, weekly.target.capturas),
    weekly.claimed ? '✅ Recompensa semanal já coletada' : weekly.completed ? '🎁 Recompensa semanal pronta' : '⏳ Semanal em progresso',
  );

  lines.push('', `Próximos: ${prefix}rpg explorar | ${prefix}rpg ginasio`);
  return lines.join('\n');
};

export const buildMissionRewardText = (rewardLines = []) => {
  if (!rewardLines.length) return '';
  return rewardLines.join('\n');
};

export const buildChooseSuccessText = ({ pokemon, prefix = '/' }) =>
  `✅ Pokemon ativo: *${formatPokemonLabel({ name: pokemon.displayName || pokemon.name, isShiny: pokemon.isShiny })}* (ID ${pokemon.id}).\nPróximo: ${prefix}rpg explorar`;

export const buildChooseErrorText = (prefix = '/') =>
  `Pokemon não encontrado no seu time.\nUse: ${prefix}rpg time`;

export const buildGenericErrorText = (prefix = '/') =>
  `❌ Erro ao processar comando RPG.\nTente: ${prefix}rpg perfil`;
