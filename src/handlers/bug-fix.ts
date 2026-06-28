/**
 * Bug 修复 Handler。M3：占位回复（使路由可观测）；M4 接入 CLI 修复 + GitLab MR。
 * 设计对齐 docs/handlers.md §3。
 */

import { Handler, HandlerContext } from './types';

export class BugFixHandler implements Handler {
  readonly intent = 'bug_fix' as const;

  async handle(ctx: HandlerContext): Promise<void> {
    const project = ctx.intent.project ? `（项目：${ctx.intent.project}）` : '';
    await ctx.reply.done(
      `🐞 已识别为「Bug 修复」${project}\n任务：${ctx.intent.task}\n\n` +
        '该功能将通过本地 CLI 修复并自动提交 GitLab Merge Request，正在 M4 开发中。'
    );
  }
}
