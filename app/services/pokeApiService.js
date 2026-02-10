import axios from 'axios';
import logger from '../utils/logger/loggerModule.js';
import { recordPokeApiCacheHit } from '../observability/metrics.js';

const BASE_URL = 'https://pokeapi.co/api/v2';
const MIN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_MS = Math.max(MIN_CACHE_TTL_MS, Number(process.env.POKEAPI_CACHE_TTL_MS) || MIN_CACHE_TTL_MS);
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.POKEAPI_TIMEOUT_MS) || 10_000);
const DEFAULT_LORE_LANGUAGES = String(process.env.POKEAPI_LORE_LANGS || 'pt-br,pt,en')
  .split(',')
  .map((entry) => String(entry || '').trim().toLowerCase())
  .filter(Boolean);

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

export const normalizeApiText = (value) => {
  return String(value || '')
    .replace(/[\n\r\f\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const resolveEntryLang = (entry) => String(entry?.language?.name || '').trim().toLowerCase();

const pickEntryByLangPriority = (entries = [], languages = DEFAULT_LORE_LANGUAGES) => {
  const list = Array.isArray(entries) ? entries : [];
  const langPriority = (Array.isArray(languages) ? languages : DEFAULT_LORE_LANGUAGES)
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return null;
  if (!langPriority.length) return list[0] || null;

  for (const lang of langPriority) {
    const found = list.find((entry) => resolveEntryLang(entry) === lang);
    if (found) return found;
  }

  const english = list.find((entry) => resolveEntryLang(entry) === 'en');
  if (english) return english;
  return list[0] || null;
};

export const getLocalizedName = (names = [], fallback = null, languages = DEFAULT_LORE_LANGUAGES) => {
  const entry = pickEntryByLangPriority(names, languages);
  const value = normalizeApiText(entry?.name || '');
  return value || normalizeApiText(fallback || '') || null;
};

export const getLocalizedGenus = (genera = [], fallback = null, languages = DEFAULT_LORE_LANGUAGES) => {
  const entry = pickEntryByLangPriority(genera, languages);
  const value = normalizeApiText(entry?.genus || '');
  return value || normalizeApiText(fallback || '') || null;
};

export const getFlavorText = (flavorTextEntries = [], options = {}) => {
  const entries = Array.isArray(flavorTextEntries) ? flavorTextEntries : [];
  if (!entries.length) return null;

  const languages = Array.isArray(options?.languages) ? options.languages : DEFAULT_LORE_LANGUAGES;
  const preferredVersion = String(options?.version || '').trim().toLowerCase();
  const filtered = preferredVersion
    ? entries.filter((entry) => String(entry?.version?.name || '').trim().toLowerCase() === preferredVersion)
    : entries;

  const entry = pickEntryByLangPriority(filtered.length ? filtered : entries, languages);
  const value = normalizeApiText(entry?.flavor_text || entry?.text || '');
  return value || null;
};

export const getEffectText = (effectEntries = [], options = {}) => {
  const entries = Array.isArray(effectEntries) ? effectEntries : [];
  if (!entries.length) return null;
  const languages = Array.isArray(options?.languages) ? options.languages : DEFAULT_LORE_LANGUAGES;
  const entry = pickEntryByLangPriority(entries, languages);
  const shortFirst = options?.preferLong ? false : true;
  const primary = shortFirst ? entry?.short_effect : entry?.effect;
  const fallback = shortFirst ? entry?.effect : entry?.short_effect;
  const value = normalizeApiText(primary || fallback || '');
  return value || null;
};

export const getDefaultLoreLanguages = () => [...DEFAULT_LORE_LANGUAGES];

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

const getNamedResource = async (resource, idOrName) => {
  const normalized = normalizeKeyPart(idOrName);
  return requestResource({
    path: `/${resource}/${encodeURIComponent(normalized)}`,
    cacheKey: `${resource}:${normalized}`,
  });
};

export const getResourceList = async ({ resource, limit = 20, offset = 0 }) => {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const cacheKey = `list:${resource}:${safeLimit}:${safeOffset}`;
  const query = `?limit=${encodeURIComponent(String(safeLimit))}&offset=${encodeURIComponent(String(safeOffset))}`;
  return requestResource({
    path: `/${resource}${query}`,
    cacheKey,
  });
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
  return getNamedResource('pokemon', idOrName);
};

export const getMove = async (idOrName) => {
  return getNamedResource('move', idOrName);
};

export const getType = async (name) => {
  return getNamedResource('type', name);
};

export const getSpecies = async (id) => {
  const normalized = normalizeKeyPart(id);
  return requestResource({
    path: `/pokemon-species/${encodeURIComponent(normalized)}`,
    cacheKey: `species:${normalized}`,
  });
};

export const getEvolutionChain = async (id) => {
  return getNamedResource('evolution-chain', id);
};

export const getItem = async (idOrName) => getNamedResource('item', idOrName);

export const getItemCategory = async (idOrName) => getNamedResource('item-category', idOrName);

export const getItemPocket = async (idOrName) => getNamedResource('item-pocket', idOrName);

export const getMachine = async (idOrName) => getNamedResource('machine', idOrName);

export const getBerry = async (idOrName) => getNamedResource('berry', idOrName);

export const getBerryFlavor = async (idOrName) => getNamedResource('berry-flavor', idOrName);

export const getRegion = async (idOrName) => getNamedResource('region', idOrName);

export const getLocation = async (idOrName) => getNamedResource('location', idOrName);

export const getLocationArea = async (idOrName) => getNamedResource('location-area', idOrName);

export const getPokedex = async (idOrName) => getNamedResource('pokedex', idOrName);

export const getGeneration = async (idOrName) => getNamedResource('generation', idOrName);

export const getNature = async (idOrName) => getNamedResource('nature', idOrName);

export const getAbility = async (idOrName) => getNamedResource('ability', idOrName);

export const getCharacteristic = async (idOrName) => getNamedResource('characteristic', idOrName);

export default {
  getPokemon,
  getMove,
  getType,
  getSpecies,
  getEvolutionChain,
  getItem,
  getItemCategory,
  getItemPocket,
  getMachine,
  getBerry,
  getBerryFlavor,
  getRegion,
  getLocation,
  getLocationArea,
  getPokedex,
  getGeneration,
  getNature,
  getAbility,
  getCharacteristic,
  getLocalizedName,
  getLocalizedGenus,
  getFlavorText,
  getEffectText,
  getDefaultLoreLanguages,
  normalizeApiText,
  getResourceList,
  getPokemonImage,
};
