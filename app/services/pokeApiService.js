import axios from 'axios';
import logger from '../utils/logger/loggerModule.js';
import { recordPokeApiCacheHit } from '../observability/metrics.js';

const BASE_URL = 'https://pokeapi.co/api/v2';
const MIN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_MS = Math.max(MIN_CACHE_TTL_MS, Number(process.env.POKEAPI_CACHE_TTL_MS) || MIN_CACHE_TTL_MS);
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.POKEAPI_TIMEOUT_MS) || 10_000);

const sharedCache = globalThis.__omnizapPokeApiCache instanceof Map ? globalThis.__omnizapPokeApiCache : new Map();
const sharedInflight = globalThis.__omnizapPokeApiInflight instanceof Map ? globalThis.__omnizapPokeApiInflight : new Map();

globalThis.__omnizapPokeApiCache = sharedCache;
globalThis.__omnizapPokeApiInflight = sharedInflight;

const normalizeKeyPart = (value) => {
  if (value === null || value === undefined) {
    throw new Error('Identificador inválido para recurso da PokéAPI.');
  }

  const raw = String(value).trim();
  if (!raw) {
    throw new Error('Identificador vazio para recurso da PokéAPI.');
  }

  return raw.toLowerCase();
};

const cleanupExpiredEntry = (key, now) => {
  const entry = sharedCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    sharedCache.delete(key);
    return null;
  }
  return entry.data;
};

const requestResource = async ({ path, cacheKey }) => {
  const now = Date.now();
  const cached = cleanupExpiredEntry(cacheKey, now);
  if (cached) {
    recordPokeApiCacheHit();
    return cached;
  }

  if (sharedInflight.has(cacheKey)) {
    return sharedInflight.get(cacheKey);
  }

  const requestPromise = axios
    .get(`${BASE_URL}${path}`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
      },
    })
    .then((response) => {
      const data = response?.data;
      sharedCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return data;
    })
    .catch((error) => {
      logger.warn('Falha ao consultar PokéAPI.', {
        path,
        error: error.message,
      });
      throw error;
    })
    .finally(() => {
      sharedInflight.delete(cacheKey);
    });

  sharedInflight.set(cacheKey, requestPromise);
  return requestPromise;
};

export const getPokemonImage = (pokemonApiResponse, options = {}) => {
  const shinyPreferred = Boolean(options?.shiny);
  if (shinyPreferred) {
    const shinyFront = pokemonApiResponse?.sprites?.front_shiny;
    if (typeof shinyFront === 'string' && shinyFront.trim()) {
      return shinyFront.trim();
    }
  }

  const officialArtwork = pokemonApiResponse?.sprites?.other?.['official-artwork']?.front_default;
  if (typeof officialArtwork === 'string' && officialArtwork.trim()) {
    return officialArtwork.trim();
  }

  const frontDefault = pokemonApiResponse?.sprites?.front_default;
  if (typeof frontDefault === 'string' && frontDefault.trim()) {
    return frontDefault.trim();
  }

  return null;
};

export const getPokemon = async (idOrName) => {
  const normalized = normalizeKeyPart(idOrName);
  return requestResource({
    path: `/pokemon/${encodeURIComponent(normalized)}`,
    cacheKey: `pokemon:${normalized}`,
  });
};

export const getMove = async (idOrName) => {
  const normalized = normalizeKeyPart(idOrName);
  return requestResource({
    path: `/move/${encodeURIComponent(normalized)}`,
    cacheKey: `move:${normalized}`,
  });
};

export const getType = async (name) => {
  const normalized = normalizeKeyPart(name);
  return requestResource({
    path: `/type/${encodeURIComponent(normalized)}`,
    cacheKey: `type:${normalized}`,
  });
};

export const getSpecies = async (id) => {
  const normalized = normalizeKeyPart(id);
  return requestResource({
    path: `/pokemon-species/${encodeURIComponent(normalized)}`,
    cacheKey: `species:${normalized}`,
  });
};

export const getEvolutionChain = async (id) => {
  const normalized = normalizeKeyPart(id);
  return requestResource({
    path: `/evolution-chain/${encodeURIComponent(normalized)}`,
    cacheKey: `evolution-chain:${normalized}`,
  });
};

export default {
  getPokemon,
  getMove,
  getType,
  getSpecies,
  getEvolutionChain,
  getPokemonImage,
};
