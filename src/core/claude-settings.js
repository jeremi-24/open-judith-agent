// What the user may choose for Claude Code: the model and how much it thinks.
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// A model is an alias (haiku, sonnet, opus) or a full id such as claude-opus-5-5 or opus[1m].
const MODEL_ID = /^[\w.[\]-]+$/;

// Returns the cleaned values, or throws. An empty model means Judith's default.
export function checkClaudeSettings({ model, effort }, defaultModel) {
  const out = {};
  if (model !== undefined) {
    if (model && !MODEL_ID.test(model)) throw new Error(`Invalid Claude model: ${model}`);
    out.model = model || defaultModel;
  }
  if (effort !== undefined) {
    if (!CLAUDE_EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${effort}`);
    out.effort = effort;
  }
  return out;
}
