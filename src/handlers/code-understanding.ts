/**
 * 代码理解 Handler：在目标项目目录内调本地 CLI 只读阅读源码并解释。
 * 设计对齐 docs/handlers.md §2。
 */

import { Handler, HandlerContext } from './types';
import { CliRunner } from '../cli/runner';
import { resolveProject } from './resolve-project';
import { projects } from '../config/projects';
import { config } from '../config';
import { logger } from '../util/logger';

function buildPrompt(task: string): string {
  return [
    '请阅读当前所在仓库的源码，回答下面的问题。要求：',
    '- 仅做只读分析，禁止修改任何文件。',
    '- 用简洁中文说明实现逻辑，并给出关键代码位置（文件路径:行号）。',
    '',
    `问题：${task}`,
  ].join('\n');
}

export class CodeUnderstandingHandler implements Handler {
  readonly intent = 'code_understanding' as const;

  constructor(private readonly runner: CliRunner) {}

  async handle(ctx: HandlerContext): Promise<void> {
    const resolved = resolveProject(ctx.intent.project, projects);
    if (!resolved.ok) {
      await ctx.reply.done(resolved.message);
      return;
    }

    const { alias, config: proj } = resolved;
    logger.info(`[代码理解] 项目=${alias} cwd=${proj.path} task="${ctx.intent.task}"`);

    // 先给出进度提示（阅读代码可能耗时）。
    ctx.reply.push(`🔍 正在阅读「${alias}」的代码…\n\n`);

    let acc = '';
    try {
      for await (const chunk of this.runner.run({
        cwd: proj.path,
        prompt: buildPrompt(ctx.intent.task),
        mode: 'read',
        timeoutMs: config.cli.timeoutMs,
      })) {
        acc += chunk;
        ctx.reply.push(chunk);
      }
      logger.info(`[代码理解] 完成，输出 ${acc.length} 字`);
      await ctx.reply.done(acc.trim() || '（CLI 无输出）');
    } catch (e) {
      logger.error('[代码理解] 失败:', e);
      await ctx.reply.fail(`代码理解执行失败（项目 ${alias}）：${(e as Error).message}`);
    }
  }
}
