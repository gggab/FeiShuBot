/**
 * 本地 CLI（claude / codex）统一封装契约。设计对齐 docs/handlers.md §6。
 * CliRunner contract for local Claude Code / Codex CLIs.
 */

export interface CliTask {
  /** 工作目录，必须来自 Project Registry（安全边界） / cwd, must be a registered project path. */
  cwd: string;
  /** 提示词（作为参数传递，禁止拼进 shell） / Prompt, passed as argv (no shell injection). */
  prompt: string;
  /** read=只读阅读, write=允许编辑 / read = read-only, write = may edit files. */
  mode: 'read' | 'write';
  /** 超时（毫秒），缺省取 config.cli.timeoutMs / Timeout in ms. */
  timeoutMs?: number;
  /** 取消信号 / Cancellation signal. */
  signal?: AbortSignal;
}

export interface CliRunner {
  readonly name: 'claude' | 'codex';
  /** 执行并产出 stdout 增量 / Run and yield stdout chunks. */
  run(task: CliTask): AsyncIterable<string>;
}
