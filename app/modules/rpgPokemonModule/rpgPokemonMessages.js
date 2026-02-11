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

const SLOT_ICONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

const itemEmoji = (itemKey) => {
  const key = String(itemKey || '').toLowerCase();
  if (key === 'pokeball') return '⚪';
  if (key === 'superpotion') return '🧴';
  if (key === 'potion') return '🧪';
  return '🎒';
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
  const slot = SLOT_ICONS[index] || `${index + 1}.`;
  if (power <= 0) {
    return `${slot} ${moveName} (${type})`;
  }
  return `${slot} ${moveName} (${type} • ${power})`;
};

export const buildUsageText = (prefix = '/') => ['🎮 *RPG Pokémon - Guia de Comandos*', '', '🚀 *Começo da Jornada*', `• ${prefix}rpg start`, `• ${prefix}rpg perfil`, `• ${prefix}rpg explorar`, '', '⚔️ *Batalha*', `• ${prefix}rpg atacar <1|2|3|4>`, `• ${prefix}rpg capturar`, `• ${prefix}rpg fugir`, '', '👥 *Time e Progressão*', `• ${prefix}rpg time`, `• ${prefix}rpg escolher <pokemon_id>`, `• ${prefix}rpg missoes`, `• ${prefix}rpg ginasio`, '', '🎒 *Itens e Economia*', `• ${prefix}rpg loja`, `• ${prefix}rpg comprar <item> <qtd>`, `• ${prefix}rpg usar <item>`, `• ${prefix}rpg bolsa`, `• ${prefix}rpg pokedex`, `• ${prefix}rpg evolucao <pokemon|id>`, `• ${prefix}rpg viajar [regiao]`, `• ${prefix}rpg tm <listar|usar>`, `• ${prefix}rpg berry <listar|usar>`, `• ${prefix}rpg raid <iniciar|entrar|atacar|status>`, `• ${prefix}rpg desafiar <jid/@numero>`, `• ${prefix}rpg pvp <status|fila|ranking|revanche|aceitar|recusar|atacar>`, `• ${prefix}rpg trade <status|propor|aceitar|recusar|cancelar>`, `• ${prefix}rpg coop`, `• ${prefix}rpg evento <status|claim>`, `• ${prefix}rpg social [status @usuario]`, `• ${prefix}rpg karma <status|top|+|->`, `• ${prefix}rpg engajamento`, '', `💡 *Dica:* faça ${prefix}rpg start → ${prefix}rpg perfil → ${prefix}rpg explorar`].join('\n');

export const buildCooldownText = ({ secondsLeft, prefix = '/' }) =>
  ['⏳ *Cooldown ativo*', `Espere *${secondsLeft}s* para agir novamente.`, '', `💡 Enquanto isso: ${prefix}rpg perfil`].join('\n');

export const buildNeedStartText = (prefix = '/') =>
  ['🧭 *Jornada não iniciada*', 'Você ainda não iniciou sua jornada Pokémon.', '', `👉 Use: ${prefix}rpg start`, `💡 Depois: ${prefix}rpg perfil`].join('\n');

export const buildStartText = ({ isNewPlayer, starterPokemon, prefix = '/' }) => {
  if (!isNewPlayer) {
    return ['✅ *Conta já existente*', 'Você já possui conta no RPG.', '', `📘 Próximo: ${prefix}rpg perfil`, `🧭 Recomendado: ${prefix}rpg explorar`].join('\n');
  }

  return [
    '🎉 *Jornada iniciada com sucesso!*',
    '',
    `🧩 Parceiro inicial: *${formatPokemonLabel({ name: starterPokemon.displayName || starterPokemon.name, isShiny: starterPokemon.isShiny })}*`,
    `🆔 ID no seu time: *${starterPokemon.id}*`,
    ...(starterPokemon?.flavorText ? ['', `📖 ${starterPokemon.flavorText}`] : []),
    '',
    '🎁 Kit inicial: 4x Poke Bola + 3x Potion',
    '',
    `➡️ Próximos: ${prefix}rpg perfil | ${prefix}rpg explorar`,
    `💡 Dica: explore com frequência para subir nível e capturar novos Pokémon.`,
  ].join('\n');
};

export const buildProfileText = ({ player, activePokemon, prefix = '/' }) => {
  const lines = ['📘 *Seu Perfil RPG*', '', `🏅 Nível: *${toNumber(player?.level, 1)}*`, `✨ XP: *${toNumber(player?.xp, 0)}*`, `💬 XP social (pool): *${toNumber(player?.xp_pool_social, 0)}*`, `🪙 Gold: *${toNumber(player?.gold, 0)}*`];

  if (activePokemon) {
    lines.push('');
    lines.push('🧩 *Pokémon ativo*');
    lines.push(`• ${formatPokemonLabel({ name: activePokemon.displayName || activePokemon.name, isShiny: activePokemon.isShiny })} (ID: ${activePokemon.id})`);
    lines.push(`• ❤️ HP: ${hpBar(activePokemon.currentHp, activePokemon.maxHp)}`);
    if (activePokemon.natureName) {
      lines.push(`• 🧬 Nature: *${formatName(activePokemon.natureName)}*`);
    }
    if (activePokemon.genus) {
      lines.push(`• 📚 Espécie: ${activePokemon.genus}`);
    }
    if (activePokemon.abilityName) {
      lines.push(`• ✨ Habilidade: *${formatName(activePokemon.abilityName)}*`);
    }
    if (activePokemon.abilityEffectText) {
      lines.push(`• 🧠 Efeito: ${activePokemon.abilityEffectText}`);
    }
    if (activePokemon.flavorText) {
      lines.push('');
      lines.push(`📖 ${activePokemon.flavorText}`);
    }
  } else {
    lines.push('');
    lines.push('⚠️ Você ainda não tem Pokémon ativo selecionado.');
  }

  lines.push('');
  lines.push(`➡️ Próximos: ${prefix}rpg explorar | ${prefix}rpg time`);
  lines.push(`💡 Dica: use ${prefix}rpg bolsa para checar seus itens.`);
  return lines.join('\n');
};

export const buildTeamText = ({ team, prefix = '/' }) => {
  if (!team.length) {
    return ['🫥 *Seu time está vazio*', '', `👉 Capture um Pokémon em batalha: ${prefix}rpg explorar`, `➡️ Depois: ${prefix}rpg capturar`].join('\n');
  }

  const rows = team.map((pokemon) => {
    const marker = pokemon.isActive ? '⭐' : '•';
    const trait = pokemon.natureName || pokemon.abilityName ? ` | ${pokemon.natureName ? `🧬 ${formatName(pokemon.natureName)}` : ''}${pokemon.natureName && pokemon.abilityName ? ' • ' : ''}${pokemon.abilityName ? `✨ ${formatName(pokemon.abilityName)}` : ''}` : '';
    return `${marker} ID ${pokemon.id} | ${formatPokemonLabel({ name: pokemon.displayName || pokemon.name, isShiny: pokemon.isShiny })} Lv.${pokemon.level} | ❤️ ${pokemon.currentHp}/${pokemon.maxHp}${trait}`;
  });

  return ['👥 *Seu Time Pokémon*', '⭐ = ativo', '', ...rows, '', `🔁 Trocar ativo: ${prefix}rpg escolher <pokemon_id>`, `💡 Dica: mantenha o ativo com HP alto antes de explorar.`].join('\n');
};

export const buildNeedActivePokemonText = (prefix = '/') =>
  ['⚠️ *Sem Pokémon ativo para batalhar*', '', `👉 Use: ${prefix}rpg time`, `➡️ Depois: ${prefix}rpg escolher <pokemon_id>`].join('\n');

export const buildPokemonFaintedText = (prefix = '/') =>
  ['💥 *Seu Pokémon ativo está sem HP*', '', `🔁 Escolha outro: ${prefix}rpg escolher <pokemon_id>`, `💡 Dica: use potion/superpotion com ${prefix}rpg usar <item>`].join('\n');

export const buildBattleStartText = ({ battleSnapshot, prefix = '/' }) => {
  const my = battleSnapshot.my;
  const enemy = battleSnapshot.enemy;
  const lines = [];

  if (battleSnapshot.mode === 'gym') {
    lines.push('🏟️ *Desafio de Ginásio!*');
  }

  if (enemy.isShiny) {
    lines.push('✨ *UM POKÉMON SHINY APARECEU!* ✨');
  }

  if (battleSnapshot.biome?.label) {
    lines.push(`🌍 Bioma: ${battleSnapshot.biome.label}`);
  }
  if (battleSnapshot.travel?.regionKey) {
    lines.push(`🧭 Região: ${formatName(battleSnapshot.travel.regionKey)}`);
  }
  if (enemy.habitat) {
    lines.push(`🏞️ Habitat: ${formatName(enemy.habitat)}`);
  }
  if (enemy.genus) {
    lines.push(`📚 Espécie: ${enemy.genus}`);
  }
  if (enemy.isLegendary || enemy.isMythical) {
    lines.push(enemy.isMythical ? '🌟 Status: Mítico' : '👑 Status: Lendário');
  }
  if (enemy.flavorText) {
    lines.push(`📖 ${enemy.flavorText}`);
  }

  lines.push('');
  lines.push('⚔️ *Confronto*');
  lines.push(`🐾 Inimigo: *${formatPokemonLabel({ name: enemy.displayName || enemy.name, isShiny: enemy.isShiny })}* Lv.${enemy.level}`);
  lines.push(`❤️ HP inimigo: ${hpBar(enemy.currentHp, enemy.maxHp)}`);
  lines.push(`🧩 Seu Pokémon: *${formatPokemonLabel({ name: my.displayName || my.name, isShiny: my.isShiny })}* Lv.${my.level}`);
  lines.push(`❤️ Seu HP: ${hpBar(my.currentHp, my.maxHp)}`);
  lines.push('');
  lines.push('📚 *Movimentos disponíveis*');
  lines.push(...my.moves.map(moveLine));
  lines.push('');
  lines.push(`➡️ Ações: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`);
  lines.push(`💡 Dica: diminua o HP inimigo para aumentar a chance de captura.`);

  return lines.join('\n');
};

export const buildBattleTurnText = ({ logs = [], battleSnapshot, prefix = '/', rewards = null, evolution = null }) => {
  const my = battleSnapshot.my;
  const enemy = battleSnapshot.enemy;

  const lines = [...logs, '', `❤️ Seu HP: ${hpBar(my.currentHp, my.maxHp)}`, `❤️ HP inimigo: ${hpBar(enemy.currentHp, enemy.maxHp)}`];

  if (enemy.currentHp <= 0 && rewards) {
    lines.push('');
    lines.push(`🏆 *Vitória!* +${rewards.playerXp} XP jogador | +${rewards.pokemonXp} XP Pokémon | +${rewards.gold} gold`);
    if (evolution?.fromName && evolution?.toName) {
      lines.push(`🎉 Seu ${formatName(evolution.fromName)} evoluiu para ${formatName(evolution.toName)}!`);
    }
    lines.push('');
    lines.push(`➡️ Próximo: ${prefix}rpg explorar`);
    lines.push(`💡 Dica: confira missões em ${prefix}rpg missoes`);
    return lines.join('\n');
  }

  if (my.currentHp <= 0) {
    lines.push('');
    lines.push('💥 Seu Pokémon desmaiou.');
    lines.push('❌ Batalha perdida e encerrada.');
    lines.push(`➡️ Próximo: ${prefix}rpg escolher <pokemon_id>`);
    lines.push(`💡 Dica: recupere HP com ${prefix}rpg usar potion`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`➡️ Ações: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`);
  return lines.join('\n');
};

export const buildCaptureSuccessText = ({ capturedPokemon, prefix = '/' }) =>
  [
    '🎉 *Captura concluída!*',
    '',
    `✅ Você capturou *${formatPokemonLabel({ name: capturedPokemon.displayName || capturedPokemon.name, isShiny: capturedPokemon.isShiny })}* (ID ${capturedPokemon.id}).`,
    ...(capturedPokemon?.flavorText ? ['', `📖 ${capturedPokemon.flavorText}`] : []),
    '',
    `➡️ Próximos: ${prefix}rpg time | ${prefix}rpg explorar`,
    `💡 Dica: defina como ativo com ${prefix}rpg escolher ${capturedPokemon.id}`,
  ].join('\n');

export const buildCaptureBlockedGymText = (prefix = '/') =>
  ['🚫 Em batalha de ginásio não é possível capturar.', '', `➡️ Use: ${prefix}rpg atacar <1-4> ou ${prefix}rpg fugir`].join('\n');

export const buildCaptureFailText = ({ logs = [], battleSnapshot, prefix = '/' }) => {
  const my = battleSnapshot.my;
  const enemy = battleSnapshot.enemy;

  const lines = [...logs, '', `❤️ Seu HP: ${hpBar(my.currentHp, my.maxHp)}`, `❤️ HP inimigo: ${hpBar(enemy.currentHp, enemy.maxHp)}`];

  if (my.currentHp <= 0) {
    lines.push('');
    lines.push('❌ Batalha perdida e encerrada.');
    lines.push(`➡️ Próximo: ${prefix}rpg escolher <pokemon_id>`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`➡️ Ações: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`);
  lines.push('💡 Dica: tente capturar com HP inimigo bem baixo.');
  return lines.join('\n');
};

export const buildFleeText = (prefix = '/') => ['🏃 Você fugiu da batalha com segurança.', '', `➡️ Próximo: ${prefix}rpg explorar`].join('\n');

export const buildNoBattleText = (prefix = '/') => ['⚠️ Nenhuma batalha ativa no momento.', '', `👉 Use: ${prefix}rpg explorar`].join('\n');

export const buildShopText = ({ items, prefix = '/' }) => {
  const itemLines = items.map((item) => `• ${itemEmoji(item.key)} *${item.label || item.key}* [${item.key}] — ${item.price} gold (${item.description})`);
  return ['🛒 *Loja RPG*', '', 'Itens disponíveis:', ...itemLines, '', `🧾 Comprar: ${prefix}rpg comprar <item> <qtd>`, `🎒 Usar item: ${prefix}rpg usar <item>`, '💡 Dica: mantenha pokeball e potion na bolsa antes de explorar.'].join('\n');
};

export const buildBuySuccessText = ({ item, quantity, totalPrice, goldLeft, prefix = '/' }) =>
  ['✅ *Compra concluída!*', '', `🛍️ ${quantity}x *${item.label}* por ${totalPrice} gold`, `🪙 Gold restante: *${goldLeft}*`, '', `➡️ Próximos: ${prefix}rpg bolsa | ${prefix}rpg loja`].join('\n');

export const buildBuyErrorText = ({ reason = 'erro', rescue = null, prefix = '/' }) => {
  if (reason === 'invalid_item') return `❌ Item inválido.\n\n👉 Confira a loja: ${prefix}rpg loja`;
  if (reason === 'invalid_quantity') return `❌ Quantidade inválida.\n\n👉 Use: ${prefix}rpg comprar <item> <qtd>`;
  if (reason === 'not_enough_gold') {
    if (rescue) {
      return ['🪙 Gold insuficiente para essa compra.', '', `🆘 Ajuda emergencial recebida: +${toNumber(rescue?.grantedGold, 0)} gold e +${toNumber(rescue?.grantedPotions, 0)} Potion`, `🪙 Gold atual: *${toNumber(rescue?.nextGold, 0)}*`, '', `👉 Próximos: ${prefix}rpg usar potion | ${prefix}rpg explorar`].join('\n');
    }
    return `🪙 Gold insuficiente para essa compra.\n\n💡 Dica: vença batalhas e missões para ganhar mais gold.\n👉 Use: ${prefix}rpg loja`;
  }
  return `❌ Não foi possível processar a compra agora.\n\n👉 Tente novamente: ${prefix}rpg loja`;
};

export const buildBattleAlreadyActiveText = (prefix = '/') =>
  ['⚔️ Você já está em batalha ativa.', '', `➡️ Ações: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`].join('\n');

export const buildUseItemUsageText = (prefix = '/') =>
  ['🎒 *Uso de item*', '', `${prefix}rpg usar <item>`, '', `💡 Dica: veja nomes válidos em ${prefix}rpg bolsa ou ${prefix}rpg loja`].join('\n');

export const buildUseItemErrorText = ({ reason = 'invalid_item', prefix = '/' }) => {
  if (reason === 'invalid_item') return `❌ Item inválido para uso.\n${buildUseItemUsageText(prefix)}`;
  if (reason === 'no_item') return `🎒 Você não tem esse item na bolsa.\n🛒 Compre em: ${prefix}rpg loja`;
  if (reason === 'full_hp') return `❤️ Seu Pokémon já está com HP cheio.\n➡️ Próximo: ${prefix}rpg explorar`;
  if (reason === 'no_active_pokemon') return `⚠️ Você não possui Pokémon ativo.\n👉 Use: ${prefix}rpg escolher <pokemon_id>`;
  if (reason === 'no_battle_for_pokeball') return `⚪ Poké Bola só pode ser usada em batalha.\n👉 Inicie uma batalha: ${prefix}rpg explorar`;
  return `❌ Não foi possível usar item agora.\n➡️ Próximo: ${prefix}rpg perfil`;
};

export const buildUsePotionSuccessText = ({ itemLabel, healedAmount, pokemonName, currentHp, maxHp, quantityLeft, itemLore = null, prefix = '/' }) =>
  ['🧪 *Item usado com sucesso!*', '', `• Item: *${itemLabel}*`, `• Alvo: *${formatName(pokemonName)}* (+${healedAmount} HP)`, `• ❤️ HP atual: ${currentHp}/${maxHp}`, `• 🎒 ${itemLabel} restantes: ${quantityLeft}`, ...(itemLore ? ['', `📖 ${itemLore}`] : []), '', `➡️ Próximos: ${prefix}rpg atacar <1-4> | ${prefix}rpg explorar`].join('\n');

export const buildEconomyRescueText = ({ goldGranted = 0, potionGranted = 0, goldTotal = 0, prefix = '/' }) =>
  ['🆘 *Ajuda de emergência liberada!*', '', `🪙 +${toNumber(goldGranted, 0)} gold | 🧪 +${toNumber(potionGranted, 0)} Potion`, `💰 Gold atual: *${toNumber(goldTotal, 0)}*`, '', `➡️ Próximos: ${prefix}rpg usar potion | ${prefix}rpg explorar`].join('\n');

export const buildBagText = ({ items = [], gold = 0, prefix = '/' }) => {
  if (!items.length) {
    return ['🎒 *Sua Bolsa*', '', `🪙 Gold: *${gold}*`, '📭 Sem itens no momento.', '', `🛒 Compre em: ${prefix}rpg loja`].join('\n');
  }

  const lines = items.map((item) => `• ${itemEmoji(item.key)} ${item.label}: ${item.quantity}${item?.loreText ? ` — ${item.loreText}` : ''}`);
  return ['🎒 *Sua Bolsa*', '', `🪙 Gold: *${gold}*`, '', ...lines, '', `🧾 Usar: ${prefix}rpg usar <item>`, `💡 Dica: confira preços em ${prefix}rpg loja`].join('\n');
};

const missionLine = (label, current, target) => `• ${label}: ${Math.max(0, current)}/${target}`;

export const buildMissionsText = ({ daily, weekly, prefix = '/' }) => {
  const lines = ['🎯 *Missões RPG*'];

  lines.push('', '☀️ *Diária*', missionLine('Explorar', daily.explorar, daily.target.explorar), missionLine('Vitórias', daily.vitorias, daily.target.vitorias), missionLine('Capturas', daily.capturas, daily.target.capturas), daily.claimed ? '✅ Recompensa diária já coletada' : daily.completed ? '🎁 Recompensa diária pronta' : '⏳ Diária em progresso');

  lines.push('', '📅 *Semanal*', missionLine('Explorar', weekly.explorar, weekly.target.explorar), missionLine('Vitórias', weekly.vitorias, weekly.target.vitorias), missionLine('Capturas', weekly.capturas, weekly.target.capturas), weekly.claimed ? '✅ Recompensa semanal já coletada' : weekly.completed ? '🎁 Recompensa semanal pronta' : '⏳ Semanal em progresso');

  lines.push('');
  lines.push(`➡️ Próximos: ${prefix}rpg explorar | ${prefix}rpg ginasio`);
  lines.push(`💡 Dica: vença batalhas de ginásio para avançar mais rápido.`);
  return lines.join('\n');
};

export const buildMissionRewardText = (rewardLines = []) => {
  if (!rewardLines.length) return '';
  return rewardLines.join('\n');
};

export const buildChooseSuccessText = ({ pokemon, prefix = '/' }) =>
  ['✅ Pokémon ativo definido!', '', `🧩 *${formatPokemonLabel({ name: pokemon.displayName || pokemon.name, isShiny: pokemon.isShiny })}* (ID ${pokemon.id})`, '', `➡️ Próximo: ${prefix}rpg explorar`].join('\n');

export const buildChooseErrorText = (prefix = '/') => `❌ Pokémon não encontrado no seu time.\n\n👉 Use: ${prefix}rpg time`;

export const buildGenericErrorText = (prefix = '/') => `❌ Erro ao processar comando RPG.\n\n👉 Tente novamente: ${prefix}rpg perfil`;

export const buildPokedexText = ({ uniqueTotal = 0, total = 0, completion = 0, recent = [], prefix = '/' }) => {
  const lines = ['📗 *Sua Pokédex*', '', `✅ Capturados únicos: *${uniqueTotal}*`, `📊 Conclusão: *${completion}%* (${uniqueTotal}/${total || '?'})`];

  if (recent.length) {
    lines.push('', '🆕 Capturas recentes:');
    recent.forEach((entry) => {
      lines.push(`• #${entry.pokeId} ${formatPokemonLabel({ name: entry.displayName || entry.name, isShiny: false })}`);
      if (entry.note) {
        lines.push(`  ↳ ${entry.note}`);
      }
    });
  }

  lines.push('', `➡️ Próximos: ${prefix}rpg explorar | ${prefix}rpg capturar`);
  return lines.join('\n');
};

export const buildEvolutionTreeText = ({ pokemonName, flavorText = null, stages = [], prefix = '/' }) => {
  const safeName = formatName(pokemonName || 'Pokemon');
  const lines = ['🧬 *Árvore Evolutiva*', '', `🔎 Base: *${safeName}*`];

  if (flavorText) {
    lines.push(`📖 ${flavorText}`);
  }

  if (!Array.isArray(stages) || !stages.length) {
    lines.push('✅ Este Pokémon não possui próximos estágios de evolução.');
    lines.push(`➡️ Próximos: ${prefix}rpg explorar | ${prefix}rpg time`);
    return lines.join('\n');
  }

  lines.push('', '🌱 Próximos estágios e requisitos:');
  stages.forEach((stage) => {
    const depth = Math.max(0, toNumber(stage?.depth, 0));
    const arrow = `${'↳ '.repeat(depth + 1)}`.trimEnd();
    lines.push(`${arrow} ${formatName(stage?.name || 'Pokemon')} — ${stage?.requirement || 'Requisito não especificado'}`);
  });
  lines.push('', `💡 Dica: use ${prefix}rpg usar <item> quando o requisito for por pedra/item.`);
  return lines.join('\n');
};

export const buildTravelStatusText = ({ travel = null, regions = [], prefix = '/' }) => {
  const lines = ['🧭 *Viagem RPG*'];

  if (travel?.regionKey) {
    const regionLabel = travel.regionLabel || formatName(travel.regionKey);
    const locationLabel = travel.locationLabel || formatName(travel.locationKey || 'desconhecido');
    const areaLabel = travel.areaLabel || formatName(travel.locationAreaKey || 'geral');
    lines.push(`🌍 Região: *${regionLabel}*`, `📍 Local: *${locationLabel}*`, `🗺️ Área: *${areaLabel}*`);
    if (travel?.regionLore) {
      lines.push(`📖 Região: ${travel.regionLore}`);
    }
    if (travel?.locationLore) {
      lines.push(`📖 Local: ${travel.locationLore}`);
    }
    if (travel?.areaLore) {
      lines.push(`📖 Área: ${travel.areaLore}`);
    }
  } else {
    lines.push('🌍 Você ainda não definiu uma região.');
  }

  if (regions.length) {
    lines.push('', 'Regiões disponíveis:');
    regions.forEach((name) => lines.push(`• ${formatName(name)}`));
  }

  lines.push('', `✈️ Viajar: ${prefix}rpg viajar <regiao>`);
  return lines.join('\n');
};

export const buildTravelSetText = ({ travel, prefix = '/' }) =>
  ['✈️ *Viagem atualizada!*', '', `🌍 Região: *${travel?.regionLabel || formatName(travel.regionKey)}*`, `📍 Local: *${travel?.locationLabel || formatName(travel.locationKey || 'desconhecido')}*`, `🗺️ Área: *${travel?.areaLabel || formatName(travel.locationAreaKey || 'geral')}*`, ...(travel?.regionLore ? [`📖 Região: ${travel.regionLore}`] : []), ...(travel?.locationLore ? [`📖 Local: ${travel.locationLore}`] : []), ...(travel?.areaLore ? [`📖 Área: ${travel.areaLore}`] : []), '', `➡️ Próximo: ${prefix}rpg explorar`].join('\n');

export const buildTmListText = ({ items = [], prefix = '/' }) => {
  if (!items.length) {
    return `📀 Você não tem TMs na bolsa.\n🛒 Compre em: ${prefix}rpg loja`;
  }

  const lines = ['📀 *Seus TMs*'];
  items.forEach((item) => lines.push(`• ${item.label} (${item.quantity})`));
  lines.push('', `🧠 Ensinar golpe: ${prefix}rpg tm usar <tm> <1-4>`);
  return lines.join('\n');
};

export const buildTmUseText = ({ itemLabel, moveName, moveLore = null, slot, pokemonName, prefix = '/' }) =>
  ['📀 *TM usado com sucesso!*', '', `🧩 ${formatName(pokemonName)} aprendeu *${formatName(moveName)}* no slot ${slot}`, ...(moveLore ? [`📖 ${moveLore}`] : []), '', `🎒 TM consumido: ${itemLabel}`, '', `➡️ Próximos: ${prefix}rpg atacar <1-4> | ${prefix}rpg explorar`].join('\n');

export const buildBerryListText = ({ items = [], prefix = '/' }) => {
  if (!items.length) {
    return `🍓 Você não tem berries na bolsa.\n🛒 Compre em: ${prefix}rpg loja`;
  }

  const lines = ['🍓 *Suas Berries*'];
  items.forEach((item) => lines.push(`• ${item.label} (${item.quantity})`));
  lines.push('', `🥣 Usar berry: ${prefix}rpg berry usar <item>`);
  return lines.join('\n');
};

export const buildRaidStartText = ({ bossName, level, currentHp, maxHp, expiresInMin, bossLore = null, prefix = '/' }) =>
  ['🐉 *RAID INICIADA!*', '', `Chefe: *${formatName(bossName)}* Lv.${level}`, `❤️ HP Boss: ${hpBar(currentHp, maxHp)}`, ...(bossLore ? ['', `📖 ${bossLore}`] : []), '', `⏱️ Tempo: ${expiresInMin} min`, `➡️ Entrar: ${prefix}rpg raid entrar`, `⚔️ Atacar: ${prefix}rpg raid atacar <1-4>`].join('\n');

export const buildRaidStatusText = ({ raid, participants = [], prefix = '/' }) => {
  if (!raid) {
    return `🛡️ Nenhuma raid ativa neste grupo.\n👉 Iniciar: ${prefix}rpg raid iniciar`;
  }

  const lines = ['🛡️ *Status da Raid*', `Chefe: *${formatName(raid.bossName)}* Lv.${raid.level}`, `❤️ HP Boss: ${hpBar(raid.currentHp, raid.maxHp)}`, ...(raid?.bossLore ? [`📖 ${raid.bossLore}`] : []), `👥 Participantes: ${participants.length}`];

  if (participants.length) {
    lines.push('', '🏆 Ranking de dano:');
    participants.slice(0, 5).forEach((entry, idx) => {
      lines.push(`${idx + 1}. ${entry.ownerJid} — ${entry.totalDamage} dmg`);
    });
  }

  lines.push('', `➡️ Ações: ${prefix}rpg raid entrar | ${prefix}rpg raid atacar <1-4>`);
  return lines.join('\n');
};

export const buildRaidAttackText = ({ logs = [], currentHp, maxHp, defeated = false, ranking = [], prefix = '/' }) => {
  const lines = [...logs, `❤️ HP Boss: ${hpBar(currentHp, maxHp)}`];

  if (defeated) {
    lines.push('🎉 Boss derrotado! Recompensas distribuídas.');
    if (ranking.length) {
      lines.push('', '🏆 Ranking final:');
      ranking.slice(0, 5).forEach((entry, idx) => {
        lines.push(`${idx + 1}. ${entry.ownerJid} — ${entry.totalDamage} dmg`);
      });
    }
    lines.push('', `➡️ Próximo: ${prefix}rpg explorar`);
    return lines.join('\n');
  }

  lines.push(`➡️ Continue: ${prefix}rpg raid atacar <1-4>`);
  return lines.join('\n');
};

export const buildPvpChallengeText = ({ challengeId, challengerJid, opponentJid, challengerPokemonLabel = null, opponentPokemonLabel = null, prefix = '/' }) =>
  ['⚔️ *Desafio PvP criado!*', '', `ID: *${challengeId}*`, `Desafiante: ${challengerJid}`, `Oponente: ${opponentJid}`, ...(challengerPokemonLabel && opponentPokemonLabel ? ['', `🧩 Confronto: *${challengerPokemonLabel}* vs *${opponentPokemonLabel}*`] : []), '', `✅ Aceitar: ${prefix}rpg pvp aceitar ${challengeId}`, `❌ Recusar: ${prefix}rpg pvp recusar ${challengeId}`].join('\n');

export const buildPvpStatusText = ({ pending = [], active = null, prefix = '/' }) => {
  const lines = ['🥊 *Status PvP*'];

  if (active) {
    lines.push('', `Partida ativa: #${active.id}`, ...(active.myPokemonLabel && active.enemyPokemonLabel ? [`🧩 Confronto: *${active.myPokemonLabel}* vs *${active.enemyPokemonLabel}*`] : []), `Turno de: ${active.turnLabel || active.turnJid}`, `Seu Pokémon HP: ${active.myHp}/${active.myMaxHp}`, `Inimigo HP: ${active.enemyHp}/${active.enemyMaxHp}`, `➡️ Ação: ${prefix}rpg pvp atacar <1-4>`);
  } else {
    lines.push('', 'Nenhuma partida ativa no momento.');
  }

  if (pending.length) {
    lines.push('', '📨 Desafios pendentes para você:');
    pending.slice(0, 5).forEach((entry) => {
      lines.push(`• #${entry.id} de ${entry.challengerLabel || entry.challengerJid} (${entry.challengerPokemonLabel || 'Pokémon oculto'})`);
    });
  }

  lines.push('', `💡 Criar desafio: ${prefix}rpg desafiar <jid/@numero>`);
  lines.push(`💡 Fila automática: ${prefix}rpg pvp fila entrar`);
  lines.push(`💡 Ranking semanal: ${prefix}rpg pvp ranking`);
  return lines.join('\n');
};

export const buildPvpTurnText = ({ logs = [], myPokemonLabel = null, enemyPokemonLabel = null, myHp, myMaxHp, enemyHp, enemyMaxHp, winnerJid = null, prefix = '/' }) => {
  const lines = [...(myPokemonLabel && enemyPokemonLabel ? [`🧩 Confronto: *${myPokemonLabel}* vs *${enemyPokemonLabel}*`, ''] : []), ...logs, '', `❤️ Seu HP: ${hpBar(myHp, myMaxHp)}`, `❤️ Inimigo HP: ${hpBar(enemyHp, enemyMaxHp)}`];
  if (winnerJid) {
    lines.push('');
    lines.push(`🏁 Vitória de ${winnerJid.label || winnerJid}`);
    lines.push(`➡️ Próximo: ${prefix}rpg explorar`);
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`➡️ Próximo turno: ${prefix}rpg pvp atacar <1-4>`);
  return lines.join('\n');
};
