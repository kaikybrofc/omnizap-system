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

const itemMeaning = (item = {}) => {
  const text = String(item?.description || item?.loreText || '')
    .trim()
    .replace(/\s+/g, ' ');
  return text || 'Item utilitário do RPG.';
};

const itemUseCommand = ({ item = {}, prefix = '/' }) => {
  const key = String(item?.key || '').trim() || '<item>';
  if (item?.isMachine) return `${prefix}rpg tm usar ${key} <1-4>`;
  if (item?.isBerry) return `${prefix}rpg berry usar ${key}`;
  if (item?.isPokeball) return `${prefix}rpg usar ${key} (em batalha)`;
  return `${prefix}rpg usar ${key}`;
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

const normalizeStatusKey = (value) => {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (key === 'paralyze' || key === 'paralysis' || key === 'par') return 'paralysis';
  if (key === 'burn' || key === 'brn') return 'burn';
  if (key === 'poison' || key === 'psn') return 'poison';
  if (key === 'toxic' || key === 'bad-poison') return 'toxic';
  if (key === 'sleep' || key === 'slp') return 'sleep';
  if (key === 'freeze' || key === 'frz') return 'freeze';
  if (key === 'confusion' || key === 'conf') return 'confusion';
  return null;
};

const statusLabel = (statusKey) => {
  if (statusKey === 'paralysis') return '⚡ PAR';
  if (statusKey === 'burn') return '🔥 BRN';
  if (statusKey === 'poison') return '☠ PSN';
  if (statusKey === 'toxic') return '☠ TOX';
  if (statusKey === 'sleep') return '💤 SLP';
  if (statusKey === 'freeze') return '❄️ FRZ';
  if (statusKey === 'confusion') return '🌀 CONF';
  return null;
};

const buildStatusLine = (pokemon = {}) => {
  const candidates = [
    pokemon?.nonVolatileStatus,
    ...(Array.isArray(pokemon?.statusEffects) ? pokemon.statusEffects : []),
    ...(toNumber(pokemon?.confusionTurns, 0) > 0 ? ['confusion'] : []),
  ];
  const labels = [];
  for (const candidate of candidates) {
    const normalized = normalizeStatusKey(candidate);
    if (!normalized) continue;
    const label = statusLabel(normalized);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
  }
  if (!labels.length) return null;
  return labels.join(' | ');
};

export const buildUsageText = (prefix = '/') =>
  [
    '🎮 *RPG Pokémon - Comandos Rápidos*',
    '',
    `• ${prefix}rpg help`,
    `• ${prefix}rpg start`,
    `• ${prefix}rpg perfil`,
    `• ${prefix}rpg explorar`,
    `• ${prefix}rpg atacar <1-4>`,
    `• ${prefix}rpg capturar`,
    `• ${prefix}rpg time`,
    `• ${prefix}rpg bolsa`,
    '',
    `💡 Guia completo e exemplos: ${prefix}rpg help`,
  ].join('\n');

export const buildRpgHelpText = (prefix = '/') => {
  const lines = ['📘 *RPG Pokémon - Help Completo*', '', `Prefixo atual: *${prefix}*`, '', '🚀 *Começo Rápido*', `1) ${prefix}rpg start`, `2) ${prefix}rpg perfil`, `3) ${prefix}rpg explorar`, `4) ${prefix}rpg atacar 1`, `5) ${prefix}rpg capturar`, '', '⚔️ *Batalha e Progressão*', `• ${prefix}rpg start`, 'Cria sua conta e entrega kit inicial.', `Exemplo: ${prefix}rpg start`, '', `• ${prefix}rpg perfil`, 'Mostra nível, XP, gold e Pokémon ativo.', `Exemplo: ${prefix}rpg perfil`, '', `• ${prefix}rpg explorar`, 'Inicia encontro selvagem.', `Exemplo: ${prefix}rpg explorar`, '', `• ${prefix}rpg atacar <1-4>`, 'Usa o golpe do slot escolhido.', `Exemplo: ${prefix}rpg atacar 2`, '', `• ${prefix}rpg capturar`, 'Tenta capturar usando Poké Bola comum.', `Exemplo: ${prefix}rpg capturar`, '', `• ${prefix}rpg fugir`, 'Encerra a batalha ativa.', `Exemplo: ${prefix}rpg fugir`, '', `• ${prefix}rpg ginasio`, 'Inicia batalha de ginásio.', `Exemplo: ${prefix}rpg ginasio`, '', '👥 *Time, Itens e Evolução*', `• ${prefix}rpg time`, 'Lista seu time completo e ID de cada Pokémon.', `Exemplo: ${prefix}rpg time`, '', `• ${prefix}rpg escolher <pokemon_id>`, 'Define qual Pokémon fica ativo.', `Exemplo: ${prefix}rpg escolher 12`, '', `• ${prefix}rpg bolsa`, 'Lista itens no inventário.', `Exemplo: ${prefix}rpg bolsa`, '', `• ${prefix}rpg loja`, 'Mostra itens disponíveis para compra.', `Exemplo: ${prefix}rpg loja`, '', `• ${prefix}rpg comprar <item> <qtd>`, 'Compra item da loja.', `Exemplo: ${prefix}rpg comprar pokeball 5`, '', `• ${prefix}rpg usar <item>`, 'Usa item de cura, evolução ou captura.', `Exemplo: ${prefix}rpg usar pocao`, '', `• ${prefix}rpg pokedex`, 'Mostra progresso da Pokédex.', `Exemplo: ${prefix}rpg pokedex`, '', `• ${prefix}rpg evolucao <pokemon|id>`, 'Mostra linha evolutiva do alvo.', `Exemplo: ${prefix}rpg evolucao pikachu`, '', `• ${prefix}rpg missoes`, 'Exibe missões diária/semanal.', `Exemplo: ${prefix}rpg missoes`, '', '🧭 *Viagem e Conteúdo Avançado*', `• ${prefix}rpg viajar [regiao]`, 'Sem região: mostra status. Com região: viaja.', `Exemplo: ${prefix}rpg viajar paldea`, '', `• ${prefix}rpg tm listar`, 'Lista TMs na bolsa.', `Exemplo: ${prefix}rpg tm listar`, '', `• ${prefix}rpg tm usar <tm> <1-4>`, 'Ensina golpe no slot informado.', `Exemplo: ${prefix}rpg tm usar tm-thunderbolt 1`, '', `• ${prefix}rpg berry listar`, 'Lista berries disponíveis.', `Exemplo: ${prefix}rpg berry listar`, '', `• ${prefix}rpg berry usar <item>`, 'Usa berry no Pokémon ativo.', `Exemplo: ${prefix}rpg berry usar oran-berry`, '', `• ${prefix}rpg raid <iniciar|entrar|atacar|status>`, 'Sistema de boss em grupo.', `Exemplo: ${prefix}rpg raid iniciar`, '', '🥊 *PvP e Interação Social*', `• ${prefix}rpg desafiar <jid/@numero>`, 'Cria desafio direto contra outro jogador.', `Exemplo: ${prefix}rpg desafiar @usuario`, '', `• ${prefix}rpg pvp status`, 'Mostra desafios pendentes/ativos.', `Exemplo: ${prefix}rpg pvp status`, '', `• ${prefix}rpg pvp fila <entrar|sair|status>`, 'Matchmaking automático no grupo.', `Exemplo: ${prefix}rpg pvp fila entrar`, '', `• ${prefix}rpg pvp ranking`, 'Ranking semanal de PvP.', `Exemplo: ${prefix}rpg pvp ranking`, '', `• ${prefix}rpg pvp revanche [@usuario]`, 'Cria revanche com último rival ou alvo informado.', `Exemplo: ${prefix}rpg pvp revanche`, '', `• ${prefix}rpg pvp aceitar <id>`, `• ${prefix}rpg pvp recusar <id>`, `• ${prefix}rpg pvp atacar <1-4>`, `• ${prefix}rpg pvp fugir`, '', `• ${prefix}rpg trade <status|propor|aceitar|recusar|cancelar>`, 'Sistema de trocas entre jogadores.', `Exemplo: ${prefix}rpg trade propor @usuario item:potion:2 pokemon:15`, '', `• ${prefix}rpg coop`, 'Status da missão cooperativa semanal.', `Exemplo: ${prefix}rpg coop`, '', `• ${prefix}rpg evento <status|claim>`, 'Evento semanal do grupo e resgate de recompensa.', `Exemplo: ${prefix}rpg evento claim`, '', `• ${prefix}rpg social [status @usuario]`, 'Painel social e vínculo entre jogadores.', `Exemplo: ${prefix}rpg social status @usuario`, '', `• ${prefix}rpg karma <status|top|+|->`, 'Sistema de reputação.', `Exemplo: ${prefix}rpg karma + @usuario`, '', `• ${prefix}rpg engajamento`, 'Métricas de atividade/retensão do grupo.', `Exemplo: ${prefix}rpg engajamento`, '', `💡 *Dicas*`, '1) Use IDs do comando time para escolher/trocar Pokémon ativo.', '2) Em batalha: primeiro ataque para baixar HP, depois capture.', `3) Para ajuda a qualquer momento: use ${prefix}rpg help ou ${prefix}rpg ajuda.`];

  return lines.join('\n');
};

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
    '🎁 Kit inicial: 4x Poke Bola + 3x Poção',
    '',
    `➡️ Próximos: ${prefix}rpg perfil | ${prefix}rpg explorar`,
    `💡 Dica: explore com frequência para subir nível e capturar novos Pokémon.`,
  ].join('\n');
};

const toDisplayText = (value, fallback = 'N/D') => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
};

const formatPercent = (value) => {
  if (!Number.isFinite(Number(value))) return 'N/D';
  return `${Math.max(0, Number(value))}%`;
};

const formatRatio = (value) => {
  if (String(value) === 'inf') return '∞';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/D';
  return numeric.toFixed(2);
};

export const buildProfileText = ({ player, activePokemon, profile = {}, prefix = '/' }) => {
  const summary = profile?.summary || {};
  const combat = profile?.combat || {};
  const collection = profile?.collection || {};
  const progression = profile?.progression || {};
  const economy = profile?.economy || {};
  const social = profile?.social || {};
  const achievements = Array.isArray(profile?.achievements) ? profile.achievements : [];
  const goals = Array.isArray(profile?.goals) ? profile.goals : [];

  const lines = [
    '📘 *Seu Perfil RPG*',
    '',
    '📌 *Resumo rápido*',
    `🏅 Nível: *${toNumber(summary?.level, toNumber(player?.level, 1))}*`,
    `✨ XP: *${toNumber(player?.xp, 0)}*`,
    `💬 XP social (pool): *${toNumber(player?.xp_pool_social, 0)}*`,
    `🪙 Gold: *${toNumber(player?.gold, 0)}*`,
    `🏆 Rank PvP semanal: *${toDisplayText(summary?.pvpWeeklyRank, 'Sem rank')}*`,
    `🔥 Streak atual: *${toDisplayText(summary?.streak?.label, 'Sem histórico')}*`,
  ];

  if (summary?.isMaxLevel) {
    lines.push('📈 Progresso de nível: *nível máximo alcançado*');
  } else {
    lines.push(
      `📈 Progresso de nível: *${toNumber(summary?.xpProgressPct, 0)}%* (${toNumber(summary?.xpIntoLevel, 0)}/${toNumber(summary?.xpNeededForNextLevel, 0)} XP no nível)`,
    );
    lines.push(`⏭️ Próximo nível: *Lv.${toNumber(summary?.nextLevel, toNumber(player?.level, 1) + 1)}* (faltam *${toNumber(summary?.xpToNextLevel, 0)} XP*)`);
  }

  if (summary?.weekRefDate) {
    lines.push(`📅 Semana PvP: ${summary.weekRefDate}`);
  }

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
  lines.push('⚔️ *Time e combate*');
  lines.push(`• PvP semana: ${toNumber(combat?.weeklyWins, 0)}W/${toNumber(combat?.weeklyLosses, 0)}L (${toNumber(combat?.weeklyMatches, 0)} partidas)`);
  lines.push(`• PvP total: ${toNumber(combat?.lifetimeWins, 0)}W/${toNumber(combat?.lifetimeLosses, 0)}L (${toNumber(combat?.lifetimeMatches, 0)} partidas)`);
  lines.push(`• Win rate: ${formatPercent(combat?.winRatePct)} | K/D: ${formatRatio(combat?.kdRatio)}`);
  lines.push(`• Dano médio: ${toDisplayText(combat?.averageDamage)}`);
  lines.push(`• Melhor vitória: ${toDisplayText(combat?.bestVictory, 'Sem vitórias recentes')}`);
  lines.push(`• Pokémon mais usado: ${toDisplayText(combat?.mostUsedPokemon, 'Sem histórico suficiente')}`);

  lines.push('');
  lines.push('📚 *Captura e coleção*');
  lines.push(`• Capturas totais: ${toNumber(collection?.capturesTotal, 0)}`);
  lines.push(`• Taxa de captura: ${collection?.captureRatePct === null || collection?.captureRatePct === undefined ? 'N/D (histórico não rastreado)' : formatPercent(collection?.captureRatePct)}`);
  lines.push(`• Pokédex: ${toNumber(collection?.pokedexUnique, 0)}/${toNumber(collection?.pokedexTotal, 0)} (${formatPercent(collection?.pokedexCompletionPct)})`);
  lines.push(`• Raros/Shiny: ${collection?.rareCount === null || collection?.rareCount === undefined ? 'Raros N/D' : `Raros ${toNumber(collection?.rareCount, 0)}`} | Shiny ${toNumber(collection?.shinyCount, 0)}`);
  lines.push(
    `• Última captura: ${
      collection?.latestCapture
        ? `${toDisplayText(collection.latestCapture.name)} (#${toNumber(collection.latestCapture.pokeId, 0)}) em ${toDisplayText(collection.latestCapture.capturedAt, 'data indisponível')}`
        : 'Sem registros recentes'
    }`,
  );

  lines.push('');
  lines.push('📈 *Progressão*');
  lines.push(
    `• Missão diária: ${toNumber(progression?.dailyMission?.explorar, 0)}/${toNumber(progression?.dailyMission?.target?.explorar, 0)} explorar, ${toNumber(progression?.dailyMission?.vitorias, 0)}/${toNumber(progression?.dailyMission?.target?.vitorias, 0)} vitórias, ${toNumber(progression?.dailyMission?.capturas, 0)}/${toNumber(progression?.dailyMission?.target?.capturas, 0)} capturas (${formatPercent(progression?.dailyMissionPct)})`,
  );
  lines.push(
    `• Missão semanal: ${toNumber(progression?.weeklyMission?.explorar, 0)}/${toNumber(progression?.weeklyMission?.target?.explorar, 0)} explorar, ${toNumber(progression?.weeklyMission?.vitorias, 0)}/${toNumber(progression?.weeklyMission?.target?.vitorias, 0)} vitórias, ${toNumber(progression?.weeklyMission?.capturas, 0)}/${toNumber(progression?.weeklyMission?.target?.capturas, 0)} capturas (${formatPercent(progression?.weeklyMissionPct)})`,
  );
  if (progression?.event) {
    lines.push(
      `• Evento ativo: ${toDisplayText(progression.event.label)} ${toNumber(progression.event.progress, 0)}/${toNumber(progression.event.target, 0)} (${formatPercent(progression.event.progressPct)}) [${toDisplayText(progression.event.status, 'ativo')}]`,
    );
  } else {
    lines.push('• Evento ativo: indisponível fora de grupo');
  }
  const pendingRewards = Array.isArray(progression?.pendingRewards) ? progression.pendingRewards : [];
  lines.push(`• Recompensas pendentes: ${pendingRewards.length ? pendingRewards.join(', ') : 'Nenhuma'}`);

  lines.push('');
  lines.push('💰 *Economia*');
  lines.push(`• Saldo atual: ${toNumber(economy?.gold, 0)} gold`);
  lines.push(`• Gasto total: ${economy?.totalSpent === null || economy?.totalSpent === undefined ? 'N/D (histórico não rastreado)' : `${toNumber(economy?.totalSpent, 0)} gold`}`);
  const topItems = Array.isArray(economy?.inventoryTop) ? economy.inventoryTop : [];
  if (topItems.length) {
    lines.push(`• Itens principais: ${topItems.map((item) => `${toDisplayText(item.label)} x${toNumber(item.quantity, 0)}`).join(' | ')}`);
  } else {
    lines.push('• Itens principais: bolsa vazia');
  }
  lines.push(`• Valor estimado da bolsa: ${toNumber(economy?.inventoryEstimatedValue, 0)} gold`);

  lines.push('');
  lines.push('🤝 *Social e Karma*');
  lines.push(`• Karma: ${toNumber(social?.karmaScore, 0)} (${social?.karmaBonusActive ? 'bônus ativo' : `faltam ${Math.max(0, toNumber(social?.karmaThreshold, 0) - toNumber(social?.karmaScore, 0))} para bônus`})`);
  lines.push(`• Votos: 👍 ${toNumber(social?.positiveVotes, 0)} | 👎 ${toNumber(social?.negativeVotes, 0)}`);
  lines.push(`• Interações sociais úteis: ${toNumber(social?.interactionsTotal, 0)} em ${toNumber(social?.linksTotal, 0)} vínculo(s)`);
  lines.push(`• Melhor amizade/rivalidade: ${toNumber(social?.topFriendship, 0)} / ${toNumber(social?.topRivalry, 0)}`);
  lines.push(`• Contribuição coop (captura/raid): ${toNumber(social?.coopCaptureContribution, 0)}/${toNumber(social?.coopRaidContribution, 0)}`);
  lines.push(`• Contribuição em evento semanal: ${toNumber(social?.eventContribution, 0)}`);

  lines.push('');
  lines.push('🏅 *Conquistas*');
  achievements.forEach((badge) => {
    lines.push(`• ${badge}`);
  });

  lines.push('');
  lines.push('🎯 *Metas sugeridas*');
  goals.forEach((goal, index) => {
    lines.push(`${index + 1}. ${goal}`);
  });

  lines.push('');
  lines.push(`➡️ Próximos: ${prefix}rpg explorar | ${prefix}rpg time`);
  lines.push(`💡 Dica: use ${prefix}rpg bolsa, ${prefix}rpg missoes e ${prefix}rpg pvp ranking para avançar nas metas.`);
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
  ['💥 *Seu Pokémon ativo está sem HP*', '', `🔁 Escolha outro: ${prefix}rpg escolher <pokemon_id>`, `💡 Dica: use pocao/superpocao com ${prefix}rpg usar <item>`].join('\n');

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
  const enemyStatus = buildStatusLine(enemy);
  if (enemyStatus) lines.push(`🧪 Status inimigo: ${enemyStatus}`);
  lines.push(`🧩 Seu Pokémon: *${formatPokemonLabel({ name: my.displayName || my.name, isShiny: my.isShiny })}* Lv.${my.level}`);
  lines.push(`❤️ Seu HP: ${hpBar(my.currentHp, my.maxHp)}`);
  const myStatus = buildStatusLine(my);
  if (myStatus) lines.push(`🧪 Seu status: ${myStatus}`);
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
  const myStatus = buildStatusLine(my);
  const enemyStatus = buildStatusLine(enemy);
  if (myStatus) lines.push(`🧪 Seu status: ${myStatus}`);
  if (enemyStatus) lines.push(`🧪 Status inimigo: ${enemyStatus}`);

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
    lines.push(`💡 Dica: recupere HP com ${prefix}rpg usar pocao`);
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
  const myStatus = buildStatusLine(my);
  const enemyStatus = buildStatusLine(enemy);
  if (myStatus) lines.push(`🧪 Seu status: ${myStatus}`);
  if (enemyStatus) lines.push(`🧪 Status inimigo: ${enemyStatus}`);

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
  const itemLines = items.map((item) => `• ${itemEmoji(item.key)} *${item.label || item.key}* [${item.key}] — ${item.price} gold | Para que serve: ${itemMeaning(item)} | Como usar: ${itemUseCommand({ item, prefix })}`);
  return [
    '🛒 *Loja RPG*',
    '',
    'Itens disponíveis:',
    ...itemLines,
    '',
    `🧾 Comprar: ${prefix}rpg comprar <item> <qtd>`,
    `🎒 Usar por nome: ${prefix}rpg usar <item>`,
    `🔢 Usar por número da bolsa: ${prefix}rpg usar <slot>`,
    '💡 Dica: mantenha pokeball e pocao na bolsa antes de explorar.',
  ].join('\n');
};

export const buildBuySuccessText = ({ item, quantity, totalPrice, goldLeft, prefix = '/' }) =>
  ['✅ *Compra concluída!*', '', `🛍️ ${quantity}x *${item.label}* por ${totalPrice} gold`, `🪙 Gold restante: *${goldLeft}*`, '', `➡️ Próximos: ${prefix}rpg bolsa | ${prefix}rpg loja`].join('\n');

export const buildBuyErrorText = ({ reason = 'erro', rescue = null, prefix = '/' }) => {
  if (reason === 'invalid_item') return `❌ Item inválido.\n\n👉 Confira a loja: ${prefix}rpg loja`;
  if (reason === 'invalid_quantity') return `❌ Quantidade inválida.\n\n👉 Use: ${prefix}rpg comprar <item> <qtd>`;
  if (reason === 'battle_active') return `⚔️ Compra bloqueada durante batalha ativa.\n\n👉 Finalize a batalha com: ${prefix}rpg atacar <1-4> | ${prefix}rpg fugir`;
  if (reason === 'not_enough_gold') {
    if (rescue) {
      return ['🪙 Gold insuficiente para essa compra.', '', `🆘 Ajuda emergencial recebida: +${toNumber(rescue?.grantedGold, 0)} gold e +${toNumber(rescue?.grantedPotions, 0)} Poção`, `🪙 Gold atual: *${toNumber(rescue?.nextGold, 0)}*`, '', `👉 Próximos: ${prefix}rpg usar pocao | ${prefix}rpg explorar`].join('\n');
    }
    return `🪙 Gold insuficiente para essa compra.\n\n💡 Dica: vença batalhas e missões para ganhar mais gold.\n👉 Use: ${prefix}rpg loja`;
  }
  return `❌ Não foi possível processar a compra agora.\n\n👉 Tente novamente: ${prefix}rpg loja`;
};

export const buildBattleAlreadyActiveText = (prefix = '/') =>
  ['⚔️ Você já está em batalha ativa.', '', `➡️ Ações: ${prefix}rpg atacar <1-4> | ${prefix}rpg capturar | ${prefix}rpg usar pokeball | ${prefix}rpg fugir`].join('\n');

export const buildUseItemUsageText = (prefix = '/') =>
  [
    '🎒 *Uso de item*',
    '',
    `• Por nome: ${prefix}rpg usar <item>`,
    `• Por slot da bolsa: ${prefix}rpg usar <numero>`,
    `• Poké Bola (em batalha): ${prefix}rpg usar pokeball`,
    `• TM: ${prefix}rpg tm usar <tm> <1-4>`,
    `• Berry: ${prefix}rpg berry usar <item>`,
    '',
    `💡 Veja itens e slots em: ${prefix}rpg bolsa`,
  ].join('\n');

export const buildUseItemErrorText = ({ reason = 'invalid_item', prefix = '/' }) => {
  if (reason === 'invalid_item') return `❌ Item inválido para uso.\n${buildUseItemUsageText(prefix)}`;
  if (reason === 'no_item') return `🎒 Você não tem esse item na bolsa.\n📦 Confira sua bolsa: ${prefix}rpg bolsa\n🛒 Comprar: ${prefix}rpg loja`;
  if (reason === 'full_hp') return `❤️ Seu Pokémon já está com HP cheio.\n➡️ Próximo: ${prefix}rpg explorar`;
  if (reason === 'no_active_pokemon') return `⚠️ Você não possui Pokémon ativo.\n👉 Use: ${prefix}rpg escolher <pokemon_id>`;
  if (reason === 'no_battle_for_pokeball') return `⚪ Poké Bola só pode ser usada em batalha.\n👉 Inicie uma batalha: ${prefix}rpg explorar\n💡 Durante a luta: ${prefix}rpg usar pokeball ou ${prefix}rpg capturar`;
  return `❌ Não foi possível usar item agora.\n➡️ Próximo: ${prefix}rpg perfil`;
};

export const buildUsePotionSuccessText = ({ itemLabel, healedAmount, pokemonName, currentHp, maxHp, quantityLeft, itemLore = null, prefix = '/' }) =>
  ['🧪 *Item usado com sucesso!*', '', `• Item: *${itemLabel}*`, `• Alvo: *${formatName(pokemonName)}* (+${healedAmount} HP)`, `• ❤️ HP atual: ${currentHp}/${maxHp}`, `• 🎒 ${itemLabel} restantes: ${quantityLeft}`, ...(itemLore ? ['', `📖 ${itemLore}`] : []), '', `➡️ Próximos: ${prefix}rpg atacar <1-4> | ${prefix}rpg explorar`].join('\n');

export const buildEconomyRescueText = ({ goldGranted = 0, potionGranted = 0, goldTotal = 0, prefix = '/' }) =>
  ['🆘 *Ajuda de emergência liberada!*', '', `🪙 +${toNumber(goldGranted, 0)} gold | 🧪 +${toNumber(potionGranted, 0)} Poção`, `💰 Gold atual: *${toNumber(goldTotal, 0)}*`, '', `➡️ Próximos: ${prefix}rpg usar pocao | ${prefix}rpg explorar`].join('\n');

export const buildBagText = ({ items = [], gold = 0, prefix = '/' }) => {
  if (!items.length) {
    return ['🎒 *Sua Bolsa*', '', `🪙 Gold: *${gold}*`, '📭 Sem itens no momento.', '', `🛒 Compre em: ${prefix}rpg loja`].join('\n');
  }

  const lines = items.map((item) => `${item.slot || '•'}${item.slot ? ')' : ''} ${itemEmoji(item.key)} ${item.label} [${item.key}] x${item.quantity} | Para que serve: ${itemMeaning(item)} | Usar: ${prefix}rpg usar ${item.slot || item.key}`);
  return [
    '🎒 *Sua Bolsa*',
    '',
    `🪙 Gold: *${gold}*`,
    '',
    ...lines,
    '',
    `🧾 Usar por nome: ${prefix}rpg usar <item>`,
    `🔢 Usar por número: ${prefix}rpg usar <slot>`,
    `💡 Dica: confira preços e significado dos itens em ${prefix}rpg loja`,
  ].join('\n');
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
