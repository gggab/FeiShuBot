/**
 * Claude Code CLI 适配（默认 CLI）。
 * Adapter for the local Claude Code CLI. 设计对齐 docs/handlers.md §6。
 *
 * 只读模式：仅允许 Read/Grep/Glob，其余工具在 print 模式下被自动拒绝，
 * 既杜绝改文件，又不会因权限询问而挂起。
 * 写模式（M4 Bug 修复用）：--permission-mode acceptEdits。
 */

import { CliRunner, CliTask } from './runner';
import { spawnStream } from './process';
import { config } from '../config';

export function buildClaudeArgs(task: CliTask): string[] {
  const args = ['-p', task.prompt, '--output-format', 'text'];
  if (task.mode === 'read') {
    args.push('--allowedTools', 'Read', 'Grep', 'Glob');
  } else {
    args.push('--permission-mode', 'acceptEdits');
  }
  return args;
}

export class ClaudeCliRunner implements CliRunner {
  readonly name = 'claude' as const;

  async *run(task: CliTask): AsyncIterable<string> {
    const cmd = config.cli.bin || 'claude';
    yield* spawnStream({
      cmd,
      args: buildClaudeArgs(task),
      cwd: task.cwd,
      timeoutMs: task.timeoutMs ?? config.cli.timeoutMs,
      signal: task.signal,
    });
  }
}
