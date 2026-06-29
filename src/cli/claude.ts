/**
 * Claude Code CLI 适配（默认 CLI）。
 * Adapter for the local Claude Code CLI. 设计对齐 docs/handlers.md §6。
 *
 * 用 --output-format stream-json --verbose 获取结构化事件，从而：
 * - 在控制台打印后端对 Claude 的调用命令，以及 Claude 的处理过程
 *   （思考 / 工具调用 / 工具结果 / 完成统计）；
 * - 解析出文本回复用于飞书卡片。
 *
 * 只读模式：仅允许 Read/Grep/Glob（杜绝改文件、print 模式下不会因权限询问挂起）。
 * 写模式（M4b Bug 修复用）：--permission-mode acceptEdits。
 */

import { CliRunner, CliTask } from './runner';
import { spawnStream } from './process';
import { config } from '../config';
import { logger } from '../util/logger';

export function buildClaudeArgs(task: CliTask): string[] {
  const args = ['-p', task.prompt, '--output-format', 'stream-json', '--verbose'];
  if (task.mode === 'read') {
    args.push('--allowedTools', 'Read', 'Grep', 'Glob');
  } else {
    // 写模式：自动批准编辑，并限定为读+编辑工具，避免尝试 Bash/构建（被拒会空耗时间，甚至触发超时）。
    args.push('--permission-mode', 'acceptEdits', '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit');
  }
  return args;
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  if (typeof i.file_path === 'string') return i.file_path;
  if (typeof i.pattern === 'string') return i.pattern;
  if (typeof i.path === 'string') return i.path;
  if (typeof i.command === 'string') return truncate(i.command, 80);
  return truncate(JSON.stringify(i), 80);
}

interface EventOut {
  card?: string;
  resultText?: string;
}

/** 解析单条 stream-json 事件：打印处理过程到控制台，返回用于卡片的文本。 */
export function handleClaudeEvent(line: string): EventOut {
  let ev: { type?: string; subtype?: string; [k: string]: unknown };
  try {
    ev = JSON.parse(line);
  } catch {
    return {};
  }

  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        const tools = Array.isArray(ev.tools) ? ev.tools.length : 0;
        logger.info(`[claude] 初始化 model=${ev.model ?? '?'} 工具数=${tools} permission=${ev.permissionMode ?? '?'}`);
      }
      return {};

    case 'assistant': {
      let card = '';
      const content = (ev.message as { content?: unknown[] })?.content ?? [];
      for (const raw of content) {
        const b = raw as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown };
        if (b.type === 'thinking' && b.thinking) {
          logger.info(`[claude] 🤔 ${truncate(b.thinking, 160)}`);
        } else if (b.type === 'tool_use') {
          logger.info(`[claude] 🔧 ${b.name}(${summarizeToolInput(b.input)})`);
        } else if (b.type === 'text' && b.text) {
          logger.info(`[claude] 💬 ${truncate(b.text, 300)}`);
          card += b.text;
        }
      }
      return { card };
    }

    case 'user': {
      const content = (ev.message as { content?: unknown[] })?.content ?? [];
      for (const raw of content) {
        const b = raw as { type?: string; content?: unknown };
        if (b.type === 'tool_result') {
          const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
          logger.info(`[claude] ↳ 工具结果 ${c.length} 字`);
        }
      }
      return {};
    }

    case 'result':
      logger.info(
        `[claude] 完成 ${ev.subtype ?? ''} 用时=${ev.duration_ms ?? '?'}ms 轮数=${ev.num_turns ?? '?'}` +
          `${ev.total_cost_usd != null ? ` 花费=$${ev.total_cost_usd}` : ''}`
      );
      return { resultText: typeof ev.result === 'string' ? ev.result : '' };

    default:
      return {};
  }
}

/** 把 stream-json 的原始 stdout（按行 JSON）解析为卡片文本流，并打印处理过程。 */
export async function* parseClaudeStream(raw: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = '';
  let emitted = false;

  function* consume(line: string): Generator<string> {
    const out = handleClaudeEvent(line);
    if (out.card) {
      emitted = true;
      yield out.card;
    } else if (out.resultText && !emitted) {
      // 兜底：助手未单独输出文本时，用 result 文本作为卡片内容。
      emitted = true;
      yield out.resultText;
    }
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

export class ClaudeCliRunner implements CliRunner {
  readonly name = 'claude' as const;

  async *run(task: CliTask): AsyncIterable<string> {
    const cmd = config.cli.bin || 'claude';
    const args = buildClaudeArgs(task);
    logger.info(`[CLI] 调用 ${this.name} mode=${task.mode} cwd=${task.cwd}`);
    logger.info(`[CLI] 命令: ${cmd} ${formatArgsForLog(args)}`);

    const raw = spawnStream({
      cmd,
      args,
      cwd: task.cwd,
      timeoutMs: task.timeoutMs ?? config.cli.timeoutMs,
      signal: task.signal,
    });
    yield* parseClaudeStream(raw);
  }
}
