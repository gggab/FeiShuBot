/**
 * 知识问答 Handler。M3：占位回复（使路由可观测）；M5 接入本地 Dify。
 * 设计对齐 docs/handlers.md §4。
 */

import { Handler, HandlerContext } from './types';

export class KnowledgeQaHandler implements Handler {
  readonly intent = 'knowledge_qa' as const;

  async handle(ctx: HandlerContext): Promise<void> {
    await ctx.reply.done(
      `📚 已识别为「知识问答」\n任务：${ctx.intent.task}\n\n` +
        '知识库（Dify）尚未接入，暂无法回答文档型问题；如需了解实现细节，' +
        '可改问“xxx 是怎么实现的”走代码理解。（M5 接入）'
    );
  }
}
