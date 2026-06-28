/**
 * 代码理解 Handler。M3：占位回复（使路由可观测）；M4 接入只读 CLI 阅读源码。
 * 设计对齐 docs/handlers.md §2。
 */

import { Handler, HandlerContext } from './types';

export class CodeUnderstandingHandler implements Handler {
  readonly intent = 'code_understanding' as const;

  async handle(ctx: HandlerContext): Promise<void> {
    const project = ctx.intent.project ? `（项目：${ctx.intent.project}）` : '';
    await ctx.reply.done(
      `🔍 已识别为「代码理解」${project}\n任务：${ctx.intent.task}\n\n` +
        '该功能将通过本地 Claude Code CLI 只读阅读源码作答，正在 M4 开发中。'
    );
  }
}
