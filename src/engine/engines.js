// Which brain answers Judith: one adapter per engine, all with the same
// contract (ask, cancel, restart, stop, 'delta' events, canLook).
// The rest of Judith never knows which one is behind.
import { ClaudeCodeEngine } from './claude-code.js';
import { ApiEngine, PROVIDERS } from './api.js';
import { CliAgentEngine, CLI_AGENTS } from './cli-agent.js';

// memory: the engine keeps its own knowledge of the user's projects.
export const ENGINES = {
  'claude-code': { label: 'Claude Code', command: 'claude', memory: true },
  codex: { label: CLI_AGENTS.codex.label, command: CLI_AGENTS.codex.command, memory: true },
  cursor: { label: CLI_AGENTS.cursor.label, command: CLI_AGENTS.cursor.command, memory: true },
  api: { label: 'Clé API', memory: false },
};
export { PROVIDERS };

// Order of preference when nothing (or something unavailable) is configured.
const PREFERENCE = ['claude-code', 'codex', 'cursor'];

// configured: config.engine ('auto' or an engine id); available: the engines
// installed on this PC; hasKey: an API key is saved for the chosen provider.
export function chooseEngine({ configured, available = [], hasKey = false }) {
  if (configured === 'api' && hasKey) return 'api';
  if (configured && configured !== 'auto' && configured !== 'api' && available.includes(configured)) return configured;
  const installed = PREFERENCE.find((id) => available.includes(id));
  if (installed) return installed;
  if (hasKey) return 'api';
  // Nothing usable: Claude Code, whose error message explains what to install.
  return 'claude-code';
}

// common: { systemPrompt, cwd, claude: { claudePath, model, extraArgs, env },
//           api: { provider, model, key, baseUrl }, agentModel }
export function createEngine(kind, common) {
  if (kind === 'api') return new ApiEngine({ ...common.api, systemPrompt: common.systemPrompt });
  if (kind === 'codex' || kind === 'cursor') {
    return new CliAgentEngine({ agent: kind, model: common.agentModel, cwd: common.cwd, systemPrompt: common.systemPrompt });
  }
  return new ClaudeCodeEngine({ ...common.claude, cwd: common.cwd, systemPrompt: common.systemPrompt });
}
