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
  // extraArgs: more Claude Code flags (MCP servers, allowed tools…).
  constructor({ claudePath, cwd, model, systemPrompt, extraArgs = [] }) {
    super();
    this.options = { claudePath: findClaude(claudePath), cwd, model, systemPrompt, extraArgs };
    this.proc = null;
    this.pending = null;
  }

  get busy() {
    return this.pending !== null;
  }

  start() {
    if (this.proc) return;
    const { claudePath, cwd, model, systemPrompt, extraArgs } = this.options;
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...(model ? ['--model', model] : []),
      ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : []),
      ...extraArgs,
    ];

    const proc = spawn(claudePath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', createLineParser((event) => this.#onEvent(event)));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (text) => this.emit('log', text));
    proc.on('error', (error) => this.#fail(error));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.#fail(new Error(`Claude Code stopped (exit code ${code})`));
    });
  }

  // content: Anthropic message content blocks (text and image).
  ask(content) {
    if (this.pending) return Promise.reject(new Error('Judith is already answering'));
    this.start();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, text: '', startedAt: Date.now() };
      this.proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
    });
  }

  // A new process is also a new conversation.
  restart() {
    this.stop();
    this.start();
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
  }

  #onEvent(event) {
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
