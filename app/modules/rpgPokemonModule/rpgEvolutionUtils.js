const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export const registerEvolutionPokedexEntry = async ({
  ownerJid,
  evolutionOutcome,
  connection = null,
  registerEntry,
}) => {
  if (typeof registerEntry !== 'function') {
    throw new Error('registerEntry é obrigatório para registrar evolução na Pokédex.');
  }

  const evolvedPokeId = toInt(evolutionOutcome?.updatePayload?.pokeId, 0);
  if (!ownerJid || evolvedPokeId <= 0) return false;

  await registerEntry(
    {
      ownerJid,
      pokeId: evolvedPokeId,
    },
    connection,
  );
  return true;
};
