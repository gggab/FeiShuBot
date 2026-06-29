/**
 * 知识问答 Handler：调本地 Dify 回答文档型问题，并保持每用户的多轮会话。
 * 设计对齐 docs/handlers.md §4。
 */

import { Handler, HandlerContext } from './types';
import { DifyClient } from '../knowledge/dify';
import { logger } from '../util/logger';

export class KnowledgeQaHandler implements Handler {
  readonly intent = 'knowledge_qa' as const;

  /** 每用户的 Dify 会话 ID，用于多轮上下文。 */
  private readonly conversations = new Map<string, string>();

  constructor(private readonly dify: DifyClient | null) {}

  async handle(ctx: HandlerContext): Promise<void> {
    if (!this.dify) {
      await ctx.reply.done(
        '📚 知识库（Dify）未配置（缺 DIFY_BASE_URL / DIFY_API_KEY），暂无法回答文档型问题。'
      );
      return;
    }

    logger.info(`[知识问答] user=${ctx.userId} q="${ctx.intent.task}"`);
    ctx.reply.push('📚 查询知识库中…');

    try {
      const prev = this.conversations.get(ctx.userId);
      const ans = await this.dify.chat(ctx.intent.task, ctx.userId, prev);
      if (ans.conversationId) this.conversations.set(ctx.userId, ans.conversationId);

      let text = ans.answer.trim() || '（知识库未返回内容）';
      if (ans.citations.length > 0) {
        text += `\n\n📎 参考：${ans.citations.join('、')}`;
      }
      await ctx.reply.done(text);
      logger.info(`[知识问答] 完成，${ans.answer.length} 字，引用 ${ans.citations.length} 篇`);
    } catch (e) {
      logger.error('[知识问答] 失败:', e);
      await ctx.reply.fail('知识库查询失败：' + (e as Error).message);
    }
  }
}
