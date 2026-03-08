import OpenAI from 'openai';
import logger from '../../utils/logger/loggerModule.js';
import { getToolRegistryStats } from './moduleToolRegistryService.js';
import { executeTool } from './moduleToolExecutorService.js';
import {
  getToolCandidateSelectorConfig,
  selectCandidateTools,
  warmupToolCandidateSelector,
} from './toolCandidateSelectorService.js';

const parseEnvBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseEnvInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const GLOBAL_TOOL_CALLING_ENABLED = parseEnvBool(process.env.GLOBAL_TOOL_CALLING_ENABLED, true);
const GLOBAL_TOOL_CALLING_MODEL =
  String(
    process.env.GLOBAL_TOOL_CALLING_MODEL || process.env.OPENAI_MODEL || 'gpt-5-nano',
  ).trim() || 'gpt-5-nano';
const GLOBAL_TOOL_CALLING_TIMEOUT_MS = parseEnvInt(
  process.env.GLOBAL_TOOL_CALLING_TIMEOUT_MS,
  20_000,
  2_000,
  60_000,
);
const GLOBAL_TOOL_CALLING_MAX_TOOL_CALLS = parseEnvInt(
  process.env.GLOBAL_TOOL_CALLING_MAX_TOOL_CALLS,
  1,
  1,
  1,
);
const GLOBAL_TOOL_CALLING_DEFAULT_CANDIDATE_LIMIT = parseEnvInt(
  process.env.TOOL_SELECTION_MAX_CANDIDATES,
  8,
  1,
  32,
);

let cachedClient = null;

const getOpenAIClient = () => {
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: GLOBAL_TOOL_CALLING_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return cachedClient;
};

const normalizeText = (value) => String(value || '').trim();

const parseJsonSafe = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
};

const extractAssistantMessageText = (message = {}) => {
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) return '';

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

const buildSystemInstruction = ({ commandPrefix = '/' } = {}) =>
  [
    'Voce decide se deve executar um comando do bot a partir da mensagem do usuario.',
    'Se a mensagem for pedido de execucao e houver parametros suficientes, use EXATAMENTE UMA tool.',
    'Se for pergunta de ajuda, nao execute tool.',
    'Nao invente comandos ou argumentos.',
    'Se faltar argumento obrigatorio, nao execute tool.',
    `Prefixo principal de comandos: ${commandPrefix}.`,
  ].join(' ');

const isToolCallingReady = (context = {}) => {
  if (!GLOBAL_TOOL_CALLING_ENABLED) return false;
  if (!process.env.OPENAI_API_KEY) return false;
  if (typeof context.toolCommandExecutor !== 'function') return false;
  return true;
};

warmupToolCandidateSelector();

export const maybeResolveAndExecuteToolCall = async ({ question, context = {} } = {}) => {
  const rawQuestion = normalizeText(question);
  if (!rawQuestion) return null;
  if (!isToolCallingReady(context)) return null;

  const candidateLimit =
    Number(context?.toolSelectionLimit) > 0
      ? Number(context.toolSelectionLimit)
      : GLOBAL_TOOL_CALLING_DEFAULT_CANDIDATE_LIMIT;
  const candidateSelection = selectCandidateTools(rawQuestion, candidateLimit);
  const tools = Array.isArray(candidateSelection?.tools) ? candidateSelection.tools : [];
  if (tools.length === 0) {
    return null;
  }

  const toolStats = getToolRegistryStats();
  const client = getOpenAIClient();

  let completion = null;
  try {
    completion = await client.chat.completions.create({
      model: GLOBAL_TOOL_CALLING_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: buildSystemInstruction({ commandPrefix: context.commandPrefix || '/' }),
        },
        {
          role: 'user',
          content: rawQuestion,
        },
      ],
      tools,
      tool_choice: 'auto',
    });
  } catch (error) {
    logger.warn('Falha ao resolver tool call global via OpenAI.', {
      action: 'global_tool_calling_failed',
      model: GLOBAL_TOOL_CALLING_MODEL,
      error: error?.message,
    });
    return null;
  }

  const message = completion?.choices?.[0]?.message || {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  if (!toolCalls.length) {
    return {
      handled: false,
      reason: 'no_tool_call',
      assistantText: extractAssistantMessageText(message),
    };
  }

  const selectedToolCall = toolCalls[0];
  if (toolCalls.length > GLOBAL_TOOL_CALLING_MAX_TOOL_CALLS) {
    logger.warn('LLM retornou mais de uma tool call; apenas a primeira sera executada.', {
      action: 'global_tool_calling_multi_tool_limited',
      returned: toolCalls.length,
      maxAllowed: GLOBAL_TOOL_CALLING_MAX_TOOL_CALLS,
    });
  }

  const toolName = normalizeText(selectedToolCall?.function?.name).toLowerCase();
  const parsedArgs = parseJsonSafe(selectedToolCall?.function?.arguments);

  const execution = await executeTool(toolName, parsedArgs, {
    ...context,
    executeCommand: context.toolCommandExecutor,
  });

  if (!execution?.handled) {
    return null;
  }

  return {
    ...execution,
    source: execution.ok ? 'tool_call_execution' : 'tool_call_blocked',
    intentType: execution.ok ? 'tool_call_executed' : 'tool_call_failed',
    metadata: {
      model: GLOBAL_TOOL_CALLING_MODEL,
      registry_tool_count: toolStats.toolCount,
      registry_module_count: toolStats.moduleCount,
      selected_tool_count: tools.length,
      tool_selection_time_ms: candidateSelection?.selectionTimeMs ?? null,
      tool_selection_fallback_used: Boolean(candidateSelection?.fallbackUsed),
      tool_selection_cache_hit: Boolean(candidateSelection?.cacheHit),
      tool_selection_candidates: Array.isArray(candidateSelection?.candidateTools)
        ? candidateSelection.candidateTools
        : [],
      tool_call_id: selectedToolCall?.id || null,
      tool_name: toolName,
    },
  };
};

export const getGlobalToolCallingConfig = () => ({
  enabled: GLOBAL_TOOL_CALLING_ENABLED,
  model: GLOBAL_TOOL_CALLING_MODEL,
  timeoutMs: GLOBAL_TOOL_CALLING_TIMEOUT_MS,
  maxToolCallsPerMessage: GLOBAL_TOOL_CALLING_MAX_TOOL_CALLS,
  defaultCandidateLimit: GLOBAL_TOOL_CALLING_DEFAULT_CANDIDATE_LIMIT,
  candidateSelector: getToolCandidateSelectorConfig(),
  hasApiKey: Boolean(process.env.OPENAI_API_KEY),
});
