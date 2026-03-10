import fs from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';
import { z } from 'zod';

import logger from '@kaikybrofc/logger-module';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_CONTEXT_MAX_CHARS = 5_200;
const DEFAULT_AGENT_MAX_CHARS = 2_400;
const DEFAULT_SOURCE_FILE_MAX_CHARS = 1_700;
const DEFAULT_MAX_SOURCE_FILES = 3;
const DEFAULT_MAX_LIST_ITEMS = 24;

const STOPWORDS = new Set(['a', 'as', 'o', 'os', 'ao', 'aos', 'de', 'da', 'do', 'dos', 'das', 'e', 'ou', 'para', 'por', 'com', 'sem', 'que', 'como', 'qual', 'quais', 'quando', 'onde', 'bot', 'omnizap', 'ajuda', 'help', 'comando', 'usar', 'quero', 'fazer', 'isso', 'esta', 'esse', 'essa', 'funciona', 'funcionar']);

const parseEnvInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const parseEnvFloat = (value, fallback, min, max) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const COMMAND_CONFIG_ENRICHMENT_MODEL = String(process.env.COMMAND_CONFIG_ENRICHMENT_WORKER_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
const COMMAND_CONFIG_ENRICHMENT_TIMEOUT_MS = parseEnvInt(process.env.COMMAND_CONFIG_ENRICHMENT_WORKER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 90_000);
const COMMAND_CONFIG_ENRICHMENT_CONTEXT_MAX_CHARS = parseEnvInt(process.env.COMMAND_CONFIG_ENRICHMENT_CONTEXT_MAX_CHARS, DEFAULT_CONTEXT_MAX_CHARS, 1_500, 16_000);
const COMMAND_CONFIG_ENRICHMENT_AGENT_MAX_CHARS = parseEnvInt(process.env.COMMAND_CONFIG_ENRICHMENT_AGENT_MAX_CHARS, DEFAULT_AGENT_MAX_CHARS, 600, 8_000);
const COMMAND_CONFIG_ENRICHMENT_SOURCE_FILE_MAX_CHARS = parseEnvInt(process.env.COMMAND_CONFIG_ENRICHMENT_SOURCE_FILE_MAX_CHARS, DEFAULT_SOURCE_FILE_MAX_CHARS, 400, 5_000);
const COMMAND_CONFIG_ENRICHMENT_MAX_SOURCE_FILES = parseEnvInt(process.env.COMMAND_CONFIG_ENRICHMENT_MAX_SOURCE_FILES, DEFAULT_MAX_SOURCE_FILES, 1, 8);
const COMMAND_CONFIG_ENRICHMENT_BASE_CONFIDENCE = parseEnvFloat(process.env.COMMAND_CONFIG_ENRICHMENT_BASE_CONFIDENCE, 0.55, 0.1, 1);

const AI_ENRICHMENT_OUTPUT_SCHEMA = z
  .object({
    capability_keywords: z.array(z.string()).optional().default([]),
    faq_patterns: z.array(z.string()).optional().default([]),
    user_phrasings: z.array(z.string()).optional().default([]),
    metodos_de_uso_sugeridos: z.array(z.string()).optional().default([]),
    descricao_sugerida: z.string().optional().default(''),
    confidence: z.union([z.number(), z.string()]).optional().default(0.55),
  })
  .strict();

let cachedClient = null;

const moduleConfigCache = new Map();
const fileTextCache = new Map();

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s/_.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeDisplayText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const truncate = (value, maxLength) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 24))}\n...[truncado]`;
};

const extractTextFromAssistantMessage = (message = {}) => {
  if (typeof message?.content === 'string') return message.content.trim();
  if (!Array.isArray(message?.content)) return '';

  const parts = [];
  for (const chunk of message.content) {
    if (!chunk || typeof chunk !== 'object') continue;
    if (typeof chunk.text === 'string') {
      parts.push(chunk.text.trim());
      continue;
    }
    if (chunk.type === 'text' && typeof chunk?.text?.value === 'string') {
      parts.push(chunk.text.value.trim());
    }
  }

  return parts.filter(Boolean).join('\n').trim();
};

const parseJsonSafe = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

const uniqueList = (values = [], { maxItems = DEFAULT_MAX_LIST_ITEMS, maxLength = 200, normalizeMode = 'display' } = {}) => {
  const source = Array.isArray(values) ? values : [];
  const output = [];
  const seen = new Set();

  for (const item of source) {
    const display = normalizeDisplayText(item);
    if (!display) continue;

    const normalized = normalizeMode === 'keyword' ? normalizeText(display).slice(0, maxLength) : display.slice(0, maxLength);
    if (!normalized) continue;

    const key = normalizeText(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }

  return output;
};

const sanitizeSuggestionPayload = (payload = {}) => ({
  capability_keywords: uniqueList(payload.capability_keywords, {
    maxItems: 24,
    maxLength: 80,
    normalizeMode: 'keyword',
  }),
  faq_patterns: uniqueList(payload.faq_patterns, {
    maxItems: 24,
    maxLength: 220,
  }),
  user_phrasings: uniqueList(payload.user_phrasings, {
    maxItems: 28,
    maxLength: 220,
  }),
  metodos_de_uso_sugeridos: uniqueList(payload.metodos_de_uso_sugeridos, {
    maxItems: 14,
    maxLength: 220,
  }),
  descricao_sugerida: truncate(payload.descricao_sugerida, 420) || null,
});

const isSuggestionMeaningful = (payload) => {
  const suggestion = sanitizeSuggestionPayload(payload);
  if (suggestion.descricao_sugerida) return true;
  if (suggestion.capability_keywords.length > 0) return true;
  if (suggestion.faq_patterns.length > 0) return true;
  if (suggestion.user_phrasings.length > 0) return true;
  if (suggestion.metodos_de_uso_sugeridos.length > 0) return true;
  return false;
};

const tokenize = (value) =>
  normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

const getOpenAIClient = () => {
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: COMMAND_CONFIG_ENRICHMENT_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return cachedClient;
};

const isFilePathInside = (baseDir, candidatePath) => {
  const normalizedBase = path.resolve(baseDir);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate.startsWith(`${normalizedBase}${path.sep}`) || normalizedCandidate === normalizedBase;
};

const readJsonFileCached = async (filePath) => {
  const normalizedPath = path.resolve(filePath);
  const cacheKey = `json:${normalizedPath}`;

  try {
    const fileHandle = await fs.open(normalizedPath, 'r');
    try {
      const stat = await fileHandle.stat();
      const cached = moduleConfigCache.get(cacheKey);
      if (cached && cached.mtimeMs === Number(stat.mtimeMs || 0)) {
        return cached.value;
      }

      const content = await fileHandle.readFile({ encoding: 'utf8' });
      const parsed = JSON.parse(content);
      moduleConfigCache.set(cacheKey, {
        mtimeMs: Number(stat.mtimeMs || 0),
        value: parsed,
      });
      return parsed;
    } finally {
      await fileHandle.close();
    }
  } catch {
    return null;
  }
};

const readTextFileCached = async (filePath, maxChars) => {
  const normalizedPath = path.resolve(filePath);
  const cacheKey = `txt:${normalizedPath}:${maxChars}`;

  try {
    const fileHandle = await fs.open(normalizedPath, 'r');
    try {
      const stat = await fileHandle.stat();
      const cached = fileTextCache.get(cacheKey);
      if (cached && cached.mtimeMs === Number(stat.mtimeMs || 0)) {
        return cached.value;
      }

      const content = await fileHandle.readFile({ encoding: 'utf8' });
      const truncated = truncate(content, maxChars);
      fileTextCache.set(cacheKey, {
        mtimeMs: Number(stat.mtimeMs || 0),
        value: truncated,
      });
      return truncated;
    } finally {
      await fileHandle.close();
    }
  } catch {
    return '';
  }
};

const resolveModuleSourceFiles = async (toolRecord) => {
  const configPath = path.resolve(String(toolRecord?.configPath || ''));
  if (!configPath) return [];

  const moduleDirPath = path.dirname(configPath);
  const moduleConfig = await readJsonFileCached(configPath);
  const sourceFiles = Array.isArray(moduleConfig?.source_files) ? moduleConfig.source_files : [];

  const resolved = [];
  for (const relativePath of sourceFiles) {
    const candidate = path.resolve(moduleDirPath, String(relativePath || '').trim());
    if (!isFilePathInside(moduleDirPath, candidate)) continue;
    resolved.push(candidate);
  }

  if (resolved.length > 0) {
    return resolved.slice(0, COMMAND_CONFIG_ENRICHMENT_MAX_SOURCE_FILES);
  }

  try {
    const moduleDirEntries = await fs.readdir(moduleDirPath, { withFileTypes: true });
    for (const entry of moduleDirEntries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.js')) continue;
      if (!/command|handler/i.test(entry.name)) continue;
      resolved.push(path.join(moduleDirPath, entry.name));
      if (resolved.length >= COMMAND_CONFIG_ENRICHMENT_MAX_SOURCE_FILES) break;
    }
  } catch {
    return [];
  }

  return resolved.slice(0, COMMAND_CONFIG_ENRICHMENT_MAX_SOURCE_FILES);
};

const buildSystemPrompt = () => ['Voce enriquece metadata de descoberta para comandos JA existentes de um bot WhatsApp.', 'Voce NAO cria comandos novos.', 'Voce NAO altera permissao, local_de_uso, pre_condicoes, limite_de_uso nem nome do comando.', 'Responda SOMENTE JSON valido com as chaves exatas:', '{"capability_keywords":[],"faq_patterns":[],"user_phrasings":[],"metodos_de_uso_sugeridos":[],"descricao_sugerida":"","confidence":0.0}', 'capability_keywords: termos curtos (sem repetir o nome do comando em todas as entradas).', 'faq_patterns: perguntas que usuarios realmente fariam.', 'user_phrasings: frases naturais de usuario.', 'metodos_de_uso_sugeridos: exemplos de uso opcionais.', 'descricao_sugerida: opcional, curta e objetiva.', 'confidence: numero de 0.0 a 1.0.'].join(' ');

const buildCommandContextPayload = async ({ learningEvent, toolRecord }) => {
  const commandEntry = toolRecord?.commandEntry || {};
  const configPath = path.resolve(String(toolRecord?.configPath || ''));
  const moduleDirPath = configPath ? path.dirname(configPath) : '';
  const agentPath = moduleDirPath ? path.join(moduleDirPath, 'AGENT.md') : '';

  const sourceFiles = await resolveModuleSourceFiles(toolRecord);
  const sourceSnippets = [];
  for (const sourceFilePath of sourceFiles) {
    const content = await readTextFileCached(sourceFilePath, COMMAND_CONFIG_ENRICHMENT_SOURCE_FILE_MAX_CHARS);
    if (!content) continue;
    sourceSnippets.push({
      file: path.relative(process.cwd(), sourceFilePath),
      content,
    });
  }

  const agentContent = agentPath ? await readTextFileCached(agentPath, COMMAND_CONFIG_ENRICHMENT_AGENT_MAX_CHARS) : '';

  const commandSummary = {
    module: toolRecord?.moduleKey || null,
    command: toolRecord?.commandName || null,
    aliases: Array.isArray(toolRecord?.aliases) ? toolRecord.aliases : [],
    descricao: commandEntry?.descricao || '',
    metodos_de_uso: Array.isArray(commandEntry?.metodos_de_uso) ? commandEntry.metodos_de_uso : [],
    argumentos: Array.isArray(commandEntry?.argumentos)
      ? commandEntry.argumentos.map((arg) => ({
          nome: arg?.nome || null,
          tipo: arg?.tipo || null,
          obrigatorio: Boolean(arg?.obrigatorio),
          validacao: arg?.validacao || null,
        }))
      : [],
    local_de_uso: Array.isArray(commandEntry?.local_de_uso) ? commandEntry.local_de_uso : [],
    permissao_necessaria: commandEntry?.permissao_necessaria || null,
    pre_condicoes: commandEntry?.pre_condicoes && typeof commandEntry.pre_condicoes === 'object' ? commandEntry.pre_condicoes : {},
    capability_keywords: Array.isArray(commandEntry?.capability_keywords) ? commandEntry.capability_keywords : [],
    faq_patterns: Array.isArray(commandEntry?.faq_patterns) ? commandEntry.faq_patterns : [],
    user_phrasings: Array.isArray(commandEntry?.user_phrasings) ? commandEntry.user_phrasings : [],
  };

  const payload = {
    command_summary: commandSummary,
    latest_user_event: {
      question: learningEvent?.user_question || '',
      normalized_question: learningEvent?.normalized_question || '',
      success: Boolean(learningEvent?.success),
      confidence: clamp01(learningEvent?.confidence),
      tool_executed: learningEvent?.tool_executed || '',
    },
    agent_excerpt: agentContent || null,
    source_files_excerpt: sourceSnippets,
  };

  const serialized = JSON.stringify(payload, null, 2);
  return truncate(serialized, COMMAND_CONFIG_ENRICHMENT_CONTEXT_MAX_CHARS);
};

const parseAndSanitizeOutput = (rawJson) => {
  const parsed = parseJsonSafe(rawJson);
  if (!parsed || typeof parsed !== 'object') return null;

  const validated = AI_ENRICHMENT_OUTPUT_SCHEMA.safeParse(parsed);
  if (!validated.success) return null;

  const confidenceValue = Number(validated.data.confidence);
  const safeConfidence = clamp01(confidenceValue);
  const suggestion = sanitizeSuggestionPayload(validated.data);
  return {
    suggestion,
    modelConfidence: safeConfidence || COMMAND_CONFIG_ENRICHMENT_BASE_CONFIDENCE,
  };
};

const buildHeuristicSuggestion = ({ learningEvent, toolRecord }) => {
  const question = String(learningEvent?.normalized_question || learningEvent?.user_question || '').trim();
  const tokens = tokenize(question);

  const commandName = normalizeText(toolRecord?.commandName || '');
  const aliases = Array.isArray(toolRecord?.aliases) ? toolRecord.aliases.map((alias) => normalizeText(alias)).filter(Boolean) : [];
  const blocked = new Set([commandName, ...aliases].filter(Boolean));
  const keywordCandidates = tokens.filter((token) => !blocked.has(token)).slice(0, 8);

  const suggestion = sanitizeSuggestionPayload({
    capability_keywords: keywordCandidates,
    faq_patterns: commandName ? [`como usar ${commandName}`, `o que faz ${commandName}`] : [],
    user_phrasings: question ? [normalizeDisplayText(question)] : [],
    metodos_de_uso_sugeridos: Array.isArray(toolRecord?.commandEntry?.metodos_de_uso) ? toolRecord.commandEntry.metodos_de_uso.slice(0, 3) : [],
    descricao_sugerida: toolRecord?.commandEntry?.descricao || '',
  });

  if (!isSuggestionMeaningful(suggestion)) return null;

  const eventConfidence = clamp01(learningEvent?.confidence);
  const successBonus = learningEvent?.success ? 0.18 : 0.04;
  const confidence = clamp01(0.38 + eventConfidence * 0.25 + successBonus);

  return {
    suggestion,
    confidence,
    source: 'heuristic',
    modelName: null,
  };
};

const isLlmReady = () => Boolean(process.env.OPENAI_API_KEY);

export const generateCommandConfigEnrichmentSuggestion = async ({ learningEvent, toolRecord } = {}) => {
  if (!learningEvent || !toolRecord) return null;

  const fallbackSuggestion = buildHeuristicSuggestion({ learningEvent, toolRecord });
  if (!isLlmReady()) {
    return fallbackSuggestion;
  }

  const contextPayload = await buildCommandContextPayload({ learningEvent, toolRecord });
  const client = getOpenAIClient();

  let completion = null;
  try {
    completion = await client.chat.completions.create({
      model: COMMAND_CONFIG_ENRICHMENT_MODEL,
      temperature: 0.15,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(),
        },
        {
          role: 'user',
          content: contextPayload,
        },
      ],
    });
  } catch (error) {
    logger.warn('Falha ao gerar enriquecimento de commandConfig com LLM.', {
      action: 'command_config_enrichment_llm_failed',
      module: toolRecord?.moduleKey || null,
      command: toolRecord?.commandName || null,
      event_id: learningEvent?.id || null,
      error: error?.message,
    });
    return fallbackSuggestion;
  }

  const message = completion?.choices?.[0]?.message || {};
  const rawJson = extractTextFromAssistantMessage(message);
  const parsed = parseAndSanitizeOutput(rawJson);

  if (!parsed || !isSuggestionMeaningful(parsed.suggestion)) {
    return fallbackSuggestion;
  }

  const eventConfidence = clamp01(learningEvent?.confidence);
  const successSignal = learningEvent?.success ? 0.12 : 0.03;
  const finalConfidence = clamp01(parsed.modelConfidence * 0.72 + eventConfidence * 0.18 + successSignal);

  return {
    suggestion: parsed.suggestion,
    confidence: finalConfidence,
    source: 'llm',
    modelName: COMMAND_CONFIG_ENRICHMENT_MODEL,
  };
};

export const getCommandConfigEnrichmentServiceConfig = () => ({
  model: COMMAND_CONFIG_ENRICHMENT_MODEL,
  timeoutMs: COMMAND_CONFIG_ENRICHMENT_TIMEOUT_MS,
  contextMaxChars: COMMAND_CONFIG_ENRICHMENT_CONTEXT_MAX_CHARS,
  agentMaxChars: COMMAND_CONFIG_ENRICHMENT_AGENT_MAX_CHARS,
  sourceFileMaxChars: COMMAND_CONFIG_ENRICHMENT_SOURCE_FILE_MAX_CHARS,
  maxSourceFiles: COMMAND_CONFIG_ENRICHMENT_MAX_SOURCE_FILES,
  baseConfidence: COMMAND_CONFIG_ENRICHMENT_BASE_CONFIDENCE,
  hasApiKey: isLlmReady(),
});
