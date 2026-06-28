/**
 * 子进程封装：spawn + 流式读取 stdout + 超时 + 取消。
 * Spawn a child process and stream its stdout, with timeout and cancellation.
 * 设计对齐 docs/handlers.md §6。
 *
 * 提示词通过参数数组传递（不拼 shell），杜绝命令注入。
 */

import { spawn } from 'child_process';

export interface SpawnStreamOptions {
  cmd: string;
  args: string[];
  /** 工作目录，必须由调用方校验为受信任路径（项目注册表内）。 */
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function* spawnStream(opts: SpawnStreamOptions): AsyncIterable<string> {
  const child = spawn(opts.cmd, opts.args, { cwd: opts.cwd, windowsHide: true });

  const timedOut = { value: false };

  const done = new Promise<{ code: number | null; error: Error | null }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('close', (code) => resolve({ code, error: null }));
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const timer = setTimeout(() => {
    timedOut.value = true;
    child.kill('SIGTERM');
  }, opts.timeoutMs);

  const onAbort = () => child.kill('SIGTERM');
  if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });

  try {
    if (child.stdout) {
      for await (const chunk of child.stdout) {
        yield (chunk as Buffer).toString('utf-8');
      }
    }
    const result = await done;

    if (result.error) {
      throw new Error(`无法启动 CLI「${opts.cmd}」: ${result.error.message}`);
    }
    if (timedOut.value) {
      throw new Error(`CLI 执行超时（${opts.timeoutMs}ms）已终止`);
    }
    if (result.code !== null && result.code !== 0) {
      throw new Error(`CLI 退出码 ${result.code}${stderr ? ': ' + stderr.trim().slice(0, 500) : ''}`);
    }
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}
