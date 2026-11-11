// Keeps one Claude Code process warm and talks to it over stream-json.
// A fresh `claude -p` per question costs ~10 s; a warm process answers a
// screenshot question in ~5 s and a follow-up in ~3 s.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLineParser } from '../core/stream.js';

export function findClaude(configured) {
  if (configured) return configured;
  const native = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(native) ? native : 'claude';
}

export class ClaudeCodeEngine extends EventEmitter {
  // Claude Code calls Judith's look_at_screen tool when it needs the screen.
  canLook = true;

  // extraArgs: more Claude Code flags (MCP servers, allowed tools…).
  // env: extra environment variables for Claude Code.
  constructor({ claudePath, cwd, model, systemPrompt, extraArgs = [], env = {} }) {
    super();
    this.options = { claudePath: findClaude(claudePath), cwd, model, systemPrompt, extraArgs, env };
    this.proc = null;
    this.pending = null;
    this.sessionId = null; // to resume the same conversation after a restart
    this.draining = null; // a cancelled turn whose end we are waiting for
  }

  get busy() {
    return this.pending !== null;
  }

  start({ resume = false } = {}) {
    if (this.proc) return;
    const { claudePath, cwd, model, systemPrompt, extraArgs, env } = this.options;
    const args = [
      ...(resume && this.sessionId ? ['--resume', this.sessionId] : []),
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...(model ? ['--model', model] : []),
      ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : []),
      ...extraArgs,
    ];

    const proc = spawn(claudePath, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', createLineParser((event) => this.#onEvent(event)));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (text) => this.emit('log', text));
    // Claude Code is not installed (ENOENT): no 'exit' follows, so the dead
    // process is forgotten here, or the next question would wait for ever.
    proc.stdin.on('error', () => {});
    proc.on('error', (error) => {
      if (this.proc === proc) this.proc = null;
      this.#fail(error);
    });
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.#fail(new Error(`Claude Code stopped (exit code ${code})`));
    });
  }

  // content: Anthropic message content blocks (text and image).
  async ask(content) {
    if (this.draining) await this.draining.done;
    if (this.pending) throw new Error('Judith is already answering');
    this.start();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, text: '', startedAt: Date.now() };
      this.proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
    });
  }

  // Stops the current turn (X, or the user talks over Judith). Claude Code
  // is asked to interrupt; if it does not finish the turn quickly, the
  // process is restarted on the same session, so the conversation is kept.
  cancel() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.reject(Object.assign(new Error('cancelled'), { cancelled: true }));

    let finished;
    const done = new Promise((resolve) => (finished = resolve));
    const timer = setTimeout(() => {
      this.emit('log', 'interrupt took too long, restarting on the same session');
      this.stop();
      this.start({ resume: true });
      this.#endDrain();
    }, 4000);
    this.draining = { done, finished, timer };
    this.#write({ type: 'control_request', request_id: `interrupt-${Date.now()}`, request: { subtype: 'interrupt' } });
  }

  #endDrain() {
    const draining = this.draining;
    if (!draining) return;
    this.draining = null;
    clearTimeout(draining.timer);
    draining.finished();
  }

  #write(message) {
    this.proc?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  // A new process is also a new conversation.
  restart() {
    this.sessionId = null;
    this.stop();
    this.start();
  }

  stop() {
    // A cancelled turn still being waited for must not restart the process later.
    this.#endDrain();
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
  }

  #onEvent(event) {
    if (process.env.JUDITH_DEBUG_EVENTS) console.log('[event]', event.type, event.subtype ?? '', event.event?.type ?? '', this.draining ? 'draining' : '', this.pending ? 'pending' : '');
    if (event.session_id) this.sessionId = event.session_id;
    // The end of a cancelled turn: ignored, then Claude Code is free again.
    if (this.draining) {
      if (event.type === 'result') this.#endDrain();
      return;
    }
    const pending = this.pending;
    if (!pending) return;

    // A new text block (e.g. after a tool call) starts on a new line.
    if (event.type === 'stream_event' && event.event?.type === 'content_block_start' && event.event.content_block?.type === 'text') {
      if (pending.text && !pending.text.endsWith('\n')) pending.text += '\n';
    } else if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
      pending.text += event.event.delta.text;
      this.emit('delta', pending.text);
    } else if (event.type === 'assistant') {
      const blocks = event.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === 'tool_use') this.emit('tool', { id: block.id, name: block.name, input: block.input ?? {} });
      }
      if (!pending.text) {
        // Fallback when partial messages are not streamed.
        pending.text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (pending.text) this.emit('delta', pending.text);
      }
    } else if (event.type === 'user') {
      // What a tool returned (command output, file written…).
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_result') continue;
        const output = Array.isArray(block.content)
          ? block.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
          : String(block.content ?? '');
        this.emit('tool-result', { id: block.tool_use_id, output, isError: block.is_error === true });
      }
    } else if (event.type === 'result') {
      this.pending = null;
      if (event.is_error) {
        pending.reject(new Error(event.result || event.subtype || 'Claude Code error'));
        return;
      }
      pending.resolve({
        text: event.result ?? pending.text,
        // Everything written during the turn, including text before tool calls.
        streamed: pending.text,
        sessionId: event.session_id,
        costUsd: event.total_cost_usd,
        durationMs: Date.now() - pending.startedAt,
      });
    }
  }

  #fail(error) {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }
}
