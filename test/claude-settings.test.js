import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAUDE_EFFORTS, checkClaudeSettings } from '../src/core/claude-settings.js';

test('aliases and full model ids are accepted, empty falls back to the default', () => {
  assert.deepEqual(checkClaudeSettings({ model: 'sonnet' }, 'haiku'), { model: 'sonnet' });
  assert.deepEqual(checkClaudeSettings({ model: 'claude-opus-5-5' }, 'haiku'), { model: 'claude-opus-5-5' });
  assert.deepEqual(checkClaudeSettings({ model: 'opus[1m]' }, 'haiku'), { model: 'opus[1m]' });
  assert.deepEqual(checkClaudeSettings({ model: '' }, 'haiku'), { model: 'haiku' });
});

test('a model name cannot carry a command line option or a space', () => {
  for (const bad of ['--dangerously-skip-permissions x', 'opus; rm', 'a b', '$(x)']) {
    assert.throws(() => checkClaudeSettings({ model: bad }, 'haiku'), /Invalid Claude model/);
  }
});

test('only the five efforts of Claude Code are accepted', () => {
  for (const effort of CLAUDE_EFFORTS) assert.deepEqual(checkClaudeSettings({ effort }, 'haiku'), { effort });
  assert.throws(() => checkClaudeSettings({ effort: 'ultra' }, 'haiku'), /Unknown effort/);
});

test('what is not given is not returned', () => {
  assert.deepEqual(checkClaudeSettings({}, 'haiku'), {});
});
