import path from 'node:path';
import logger from '#logger';
import { createModuleAiHelpService } from './moduleAiHelpCoreService.js';
import { createModuleCommandConfigRuntime } from './moduleCommandConfigRuntimeService.js';

const normalizeText = (value) => String(value || '').trim();

export const createModuleAiHelpWrapper = ({ moduleKey, moduleLabel, envPrefix, moduleDirPath, moduleNameFallback = null, guidance = undefined, customLogger = logger }) => {
  const safeModuleKey = normalizeText(moduleKey);
  const safeModuleLabel = normalizeText(moduleLabel);
  const safeEnvPrefix = normalizeText(envPrefix);
  const safeModuleDirPath = normalizeText(moduleDirPath);

  if (!safeModuleKey) {
    throw new Error('createModuleAiHelpWrapper: moduleKey e obrigatorio');
  }
  if (!safeModuleLabel) {
    throw new Error('createModuleAiHelpWrapper: moduleLabel e obrigatorio');
  }
  if (!safeEnvPrefix) {
    throw new Error('createModuleAiHelpWrapper: envPrefix e obrigatorio');
  }
  if (!safeModuleDirPath) {
    throw new Error('createModuleAiHelpWrapper: moduleDirPath e obrigatorio');
  }

  const runtime = createModuleCommandConfigRuntime({
    configPath: path.join(safeModuleDirPath, 'commandConfig.json'),
    fallbackConfig: {
      module: moduleNameFallback || `${safeModuleKey}Module`,
      commands: [],
    },
  });

  const core = createModuleAiHelpService({
    moduleKey: safeModuleKey,
    moduleLabel: safeModuleLabel,
    envPrefix: safeEnvPrefix,
    getModuleConfig: runtime.getModuleConfig,
    resolveCommandName: runtime.resolveCommandName,
    getCommandEntry: runtime.getCommandEntry,
    listEnabledCommands: runtime.listEnabledCommands,
    agentMdPath: path.join(safeModuleDirPath, 'AGENT.md'),
    logger: customLogger,
    guidance,
  });

  return {
    moduleKey: safeModuleKey,
    moduleLabel: safeModuleLabel,
    envPrefix: safeEnvPrefix,
    moduleDirPath: safeModuleDirPath,
    getModuleConfig: runtime.getModuleConfig,
    resolveCommandName: runtime.resolveCommandName,
    getCommandEntry: runtime.getCommandEntry,
    listEnabledCommands: runtime.listEnabledCommands,
    isCommandName: runtime.isCommandName,
    gerarFaqAutomatica: core.gerarFaqAutomatica,
    explicarComando: core.explicarComando,
    responderPergunta: core.responderPergunta,
    buildUnknownCommandSuggestion: core.buildUnknownCommandSuggestion,
    startScheduler: core.startScheduler,
    stopSchedulerForTests: core.stopSchedulerForTests,
  };
};
