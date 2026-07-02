/**
 * Codex（ChatGPT）CLI 适配。设计对齐 docs/handlers.md §6。
 *
 * 用 `codex exec --json` 获取 JSONL 事件流：
 * - `item.completed` 且 item.type === 'agent_message' 的 text 进飞书卡片；
 * - reasoning / command_execution / file_change 打印到控制台（处理过程可见）；
 * - `turn.failed` / 流级 `error` 事件显式抛错——进程可能仍以 0 退出，
 *   只靠退出码会把失败吞成空回复（No hidden errors）。
 *
 * 沙箱即读写边界：read 模式 --sandbox read-only；write 模式 --sandbox workspace-write。
 * 无头鉴权：CODEX_API_KEY 环境变量（子进程继承，见 docs/deployment.md §4）。
 */

import { CliRunner, CliTask } from './runner';
import { spawnStream } from './process';
import { config } from '../config';
import { logger } from '../util/logger';

export function buildCodexArgs(task: CliTask): string[] {
  return [
    'exec',
    '--json',
    // 注册表只保证目录存在，不保证是 git 仓库；不带此参数时 codex 会拒绝在非仓库目录运行。
    '--skip-git-repo-check',
    '--sandbox',
    task.mode === 'read' ? 'read-only' : 'workspace-write',
    task.prompt,
  ];
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  exit_code?: number | null;
  status?: string;
  changes?: Array<{ path?: string; kind?: string }>;
  message?: string;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  error?: { message?: string };
  message?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** 解析单条 JSONL 事件：打印处理过程，返回进卡片的文本；失败事件抛错。 */
function handleCodexEvent(line: string): string {
  let ev: CodexEvent;
  try {
    ev = JSON.parse(line);
  } catch {
    return '';
  }

  switch (ev.type) {
    case 'thread.started':
      logger.info(`[codex] 会话开始 thread=${ev.thread_id ?? '?'}`);
      return '';

    case 'turn.completed':
      logger.info(
        `[codex] 完成 输入tokens=${ev.usage?.input_tokens ?? '?'} 输出tokens=${ev.usage?.output_tokens ?? '?'}`
      );
      return '';

    case 'turn.failed':
      throw new Error(`codex 执行失败: ${ev.error?.message ?? '未知错误'}`);

    case 'error':
      throw new Error(`codex 流错误: ${ev.message ?? '未知错误'}`);

    case 'item.started':
      if (ev.item?.type === 'command_execution' && ev.item.command) {
        logger.info(`[codex] 🔧 ${truncate(ev.item.command, 80)}`);
      }
      return '';

    case 'item.completed': {
      const item = ev.item ?? {};
      switch (item.type) {
        case 'agent_message':
          if (item.text) {
            logger.info(`[codex] 💬 ${truncate(item.text, 300)}`);
            return item.text;
          }
          return '';
        case 'reasoning':
          if (item.text) logger.info(`[codex] 🤔 ${truncate(item.text, 160)}`);
          return '';
        case 'command_execution':
          logger.info(`[codex] ↳ 命令退出码 ${item.exit_code ?? '?'}`);
          return '';
        case 'file_change':
          logger.info(`[codex] ✏️ 改动 ${item.changes?.map((c) => `${c.kind ?? '?'} ${c.path ?? '?'}`).join(', ') ?? ''}`);
          return '';
        case 'error':
          logger.warn(`[codex] ⚠️ ${item.message ?? ''}`);
          return '';
        default:
          return '';
      }
    }

    default:
      return '';
  }
}

/** 把 JSONL 原始 stdout 解析为卡片文本流，并打印处理过程。 */
export async function* parseCodexStream(raw: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = '';

  function* consume(line: string): Generator<string> {
    const text = handleCodexEvent(line);
    if (text) yield text;
  }

  for await (const chunk of raw) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield* consume(line);
    }
  }
  const last = buffer.trim();
  if (last) yield* consume(last);
}

function formatArgsForLog(args: string[]): string {
  return args
    .map((a) => (a.length > 120 ? a.slice(0, 120) + '…' : a))
    .map((a) => (a.includes(' ') ? `"${a}"` : a))
    .join(' ');
}

export class CodexCliRunner implements CliRunner {
  readonly name = 'codex' as const;

  async *run(task: CliTask): AsyncIterable<string> {
    const cmd = config.cli.bin || 'codex';
    const args = buildCodexArgs(task);
    logger.info(`[CLI] 调用 ${this.name} mode=${task.mode} cwd=${task.cwd}`);
    logger.info(`[CLI] 命令: ${cmd} ${formatArgsForLog(args)}`);

    const raw = spawnStream({
      cmd,
      args,
      cwd: task.cwd,
      timeoutMs: task.timeoutMs ?? config.cli.timeoutMs,
      signal: task.signal,
    });
    yield* parseCodexStream(raw);
  }
}
