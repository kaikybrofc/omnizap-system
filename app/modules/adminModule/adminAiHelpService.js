import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '@kaikybrofc/logger-module';
import { createModuleAiHelpService } from '../../services/moduleAiHelpCoreService.js';
import { getAdminCommandEntry, getAdminModuleConfig, resolveAdminCommandName } from './adminConfigRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_MD_PATH = path.join(__dirname, 'AGENT.md');

const listEnabledAdminCommands = () => {
  const config = getAdminModuleConfig();
  const entries = Array.isArray(config?.commands) ? config.commands : [];
  return entries.filter((entry) => entry && entry.enabled !== false);
};

const adminAiHelpCore = createModuleAiHelpService({
  moduleKey: 'admin',
  moduleLabel: 'comandos administrativos',
  envPrefix: 'ADMIN_AI_HELP',
  getModuleConfig: getAdminModuleConfig,
  resolveCommandName: resolveAdminCommandName,
  getCommandEntry: getAdminCommandEntry,
  listEnabledCommands: listEnabledAdminCommands,
  agentMdPath: AGENT_MD_PATH,
  logger,
  guidance: {
    faqSummary: ({ commandCount, faqCount, commandPrefix }) => ['🤖 FAQ administrativa atualizada.', `Comandos analisados: ${commandCount}.`, `Perguntas geradas: ${faqCount}.`, '', `Use ${commandPrefix}menuadm ajuda <comando> para explicacao detalhada.`, `Use ${commandPrefix}menuadm perguntar <pergunta> para consulta livre.`].join('\n'),
    askUsage: ({ commandPrefix }) => `Use ${commandPrefix}menuadm perguntar <pergunta>.`,
    unknownCommand: ({ rawCommand, suggestions, commandPrefix }) => [`❓ O comando *${rawCommand}* nao foi encontrado entre os comandos administrativos.`, suggestions ? `Talvez voce quis usar: ${suggestions}.` : '', `Use ${commandPrefix}menuadm faq para ver perguntas frequentes ou ${commandPrefix}menuadm ajuda <comando>.`].filter(Boolean).join('\n'),
    missingCommandText: ({ commandPrefix }) => `Nao encontrei esse comando administrativo. Use ${commandPrefix}menuadm ou ${commandPrefix}menuadm faq para listar opcoes.`,
    questionFallback: ({ commandPrefix, detectedCommand, suggestions }) => {
      if (detectedCommand) {
        return `Posso te ajudar com ${commandPrefix}${detectedCommand}. Tente: ${commandPrefix}menuadm ajuda ${detectedCommand}`;
      }
      return ['Nao encontrei resposta pronta para essa pergunta no FAQ.', `Tente ${commandPrefix}menuadm perguntar "como usar <comando>" ou ${commandPrefix}menuadm ajuda <comando>.`, suggestions ? `Sugestoes rapidas: ${suggestions}.` : ''].filter(Boolean).join('\n');
    },
  },
});

export const adminAiHelpWrapper = {
  moduleKey: 'admin',
  resolveCommandName: resolveAdminCommandName,
  getCommandEntry: getAdminCommandEntry,
  listEnabledCommands: listEnabledAdminCommands,
  explicarComando: adminAiHelpCore.explicarComando,
  responderPergunta: adminAiHelpCore.responderPergunta,
  buildUnknownCommandSuggestion: adminAiHelpCore.buildUnknownCommandSuggestion,
};

export const gerarFaqAutomatica = adminAiHelpCore.gerarFaqAutomatica;
export const explicarComando = adminAiHelpCore.explicarComando;
export const responderPergunta = adminAiHelpCore.responderPergunta;
export const buildAdminUnknownCommandSuggestion = adminAiHelpCore.buildUnknownCommandSuggestion;
export const startAdminAiHelpScheduler = adminAiHelpCore.startScheduler;
export const stopAdminAiHelpSchedulerForTests = adminAiHelpCore.stopSchedulerForTests;
