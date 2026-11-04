// Another coding agent the user already has, run without its interface:
// OpenAI Codex (`codex exec`) or Cursor (`agent -p`). Each keeps its own
// knowledge of the user's projects (AGENTS.md, Cursor rules…), like Claude
// Code does.
// Same contract as ClaudeCodeEngine. One process per question (these CLIs
// have no warm stdin mode), so answers are slower than with Claude Code.
// They cannot call Judith's look_at_screen: the screenshot is saved to a
// temporary file, given to the agent, and deleted right after (canLook = false).
//
// Their JSON event formats differ between versions, so the parsers below
// accept every shape we know of and ignore the rest.
//
// Safety: on Windows these CLIs are often .cmd scripts, which only run
// through the command shell, where characters like & or | in an argument
// start another command. So no text from the user, the screen or a model ever
// goes on the command line: the prompt is written to a temporary file the
// agent reads, and the command line only holds flags, a validated model name
// and file paths.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLineParser } from '../core/stream.js';

// What one JSON line says: { delta } (more text), { final } (the whole
// answer), or {} (something else).
export function parseCodexLine(event) {
  const kind = event.type ?? event.method ?? '';
  const item = event.item ?? event.params?.item ?? event.msg ?? null;
  if (/agent[_]?message[./]delta|agentMessage\/delta/i.test(kind)) return { delta: event.delta ?? event.params?.delta ?? '' };
  if (/item[./]completed/i.test(kind) && item && /agent_?message/i.test(item.type ?? '')) return { final: item.text ?? '' };
  // Older versions: { msg: { type: 'agent_message', message } }.
  if (event.msg?.type === 'agent_message') return { final: event.msg.message ?? '' };
  if (/error/i.test(kind) || event.type === 'turn.failed') throw new Error(event.message ?? event.error?.message ?? 'Codex error');
  return {};
}

export function parseCursorLine(event) {
  if (event.type === 'assistant') {
    const text = (event.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return text ? { delta: text } : {};
  }
  if (event.type === 'result') {
    if (event.is_error || event.subtype === 'error') throw new Error(event.result || 'Cursor error');
    return { final: event.result ?? '' };
  }
  return {};
}

export const CLI_AGENTS = {
  codex: {
    label: 'OpenAI Codex',
    command: 'codex',
    // read-only sandbox: Codex may read the user's files, never change them.
    args: ({ instruction, image, model }) => [
      'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check',
      ...(model ? ['--model', model] : []),
      ...(image ? ['--image', image] : []),
      instruction,
    ],
    parse: parseCodexLine,
  },
  cursor: {
    label: 'Cursor',
    command: 'agent',
    // No --force: without it Cursor only proposes changes, it never writes.
    // No image flag: the screenshot's path is in the prompt file and the agent reads it.
    args: ({ instruction, model }) => [
      '-p', '--output-format', 'stream-json', '--stream-partial-output',
      ...(model ? ['--model', model] : []),
      instruction,
    ],
    parse: parseCursorLine,
  },
};

const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

// The whole prompt: Judith's rules, the last exchanges, the question, and
// where the screenshot is.
export function buildCliPrompt({ systemPrompt, history, question, image }) {
  const past = history.map((m) => `${m.role === 'user' ? 'User' : 'Judith'}: ${m.text}`).join('\n');
  const screen = image ? `\n\nThe user's screen is the image at: ${image}` : '';
  return `${systemPrompt}\n\n${past ? `Conversation so far:\n${past}\n\n` : ''}User: ${question}${screen}`;
}

// The only text on the command line: a fixed sentence and a file path.
export const instructionFor = (promptFile) =>
  `Read the file ${promptFile} and do exactly what it says. Answer only in the format it describes.`;

// Model names come from the settings: letters, digits and . - _ : / @ only.
export function safeModel(model) {
  if (!model) return null;
  if (!/^[\w.\-:/@]+$/.test(model)) throw new Error(`Invalid model name: ${model}`);
  return model;
}

// Quoting for the Windows command shell. Every argument here is a flag, a
// validated model name, a temp file path or the fixed instruction, none of
// which can contain a double quote; spaces (a user name with a space in the
// temp path) are the only thing to protect.
export function quoteForShell(arg) {
  return /^[\w\-.:\\/=@]+$/.test(arg) ? arg : `"${arg}"`;
}

export class CliAgentEngine extends EventEmitter {
  canLook = false;

  constructor({ agent, command, model, cwd, systemPrompt, maxTurns = 4 }) {
    super();
    const spec = CLI_AGENTS[agent];
    if (!spec) throw new Error(`Unknown agent: ${agent}`);
    this.spec = spec;
    this.options = { command: command || spec.command, model, cwd, systemPrompt, maxTurns };
    this.history = [];
    this.pending = null;
  }

  get busy() {
    return this.pending !== null;
  }

  start() {}

  stop() {
    this.cancel();
  }

  restart() {
    this.cancel();
    this.history = [];
  }

  ask(content) {
    if (this.pending) return Promise.reject(new Error('Judith is already answering'));
    const { command, model, cwd, systemPrompt, maxTurns } = this.options;
    const question = textOf(content);
    const imageBlock = content.find((b) => b.type === 'image');
    const stem = join(tmpdir(), `judith-${randomBytes(6).toString('hex')}`);
    let image = null;
    if (imageBlock) {
      image = `${stem}.${imageBlock.source.media_type === 'image/png' ? 'png' : 'jpg'}`;
      writeFileSync(image, Buffer.from(imageBlock.source.data, 'base64'));
    }
    const promptFile = `${stem}.md`;
    writeFileSync(promptFile, buildCliPrompt({ systemPrompt, history: this.history, question, image }));
    const startedAt = Date.now();
    let args;
    try {
      args = this.spec.args({ instruction: instructionFor(promptFile), image, model: safeModel(model) });
    } catch (error) {
      for (const file of [image, promptFile]) if (file) rmSync(file, { force: true });
      return Promise.reject(error);
    }
    const onWindows = process.platform === 'win32';

    return new Promise((resolve, reject) => {
      let text = '';
      let final = null;
      let failure = null;
      // On Windows the shell is needed to run .cmd scripts; see "Safety" above.
      const proc = onWindows
        ? spawn(quoteForShell(command), args.map(quoteForShell), { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
        : spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      const pending = { proc, reject };
      this.pending = pending;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on(
        'data',
        createLineParser((event) => {
          try {
            const out = this.spec.parse(event);
            if (out.delta) {
              text += out.delta;
              this.emit('delta', text);
            }
            if (typeof out.final === 'string') final = out.final;
          } catch (error) {
            failure = error;
          }
        }),
      );
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => this.emit('log', chunk));
      const done = (error) => {
        for (const file of [image, promptFile]) if (file) rmSync(file, { force: true });
        if (this.pending !== pending) return; // cancelled: already rejected
        this.pending = null;
        if (error) return reject(error);
        const answer = final ?? text;
        // Nothing streamed: the whole answer at once.
        if (!text && answer) this.emit('delta', answer);
        this.history.push({ role: 'user', text: question }, { role: 'assistant', text: answer });
        this.history = this.history.slice(-2 * maxTurns);
        resolve({ text: answer, streamed: text || answer, durationMs: Date.now() - startedAt });
      };
      proc.on('error', (error) => done(new Error(`${this.spec.label} could not start (${command}): ${error.message}`)));
      proc.on('close', (code) => done(failure ?? (code === 0 || final !== null ? null : new Error(`${this.spec.label} stopped (exit code ${code})`))));
    });
  }

  cancel() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.proc.kill();
    pending.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
  }
}
