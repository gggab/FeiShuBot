/**
 * 知识问答 Handler：调本地 Dify 回答文档型问题，并保持每用户的多轮会话。
 * 设计对齐 docs/handlers.md §4。
 */

import { Handler, HandlerContext } from './types';
import { DifyClient } from '../knowledge/dify';
import { detectLang, pick } from '../util/lang';
import { logger } from '../util/logger';

export class KnowledgeQaHandler implements Handler {
  readonly intent = 'knowledge_qa' as const;

  /** 每用户的 Dify 会话 ID，用于多轮上下文。 */
  private readonly conversations = new Map<string, string>();

  constructor(private readonly dify: DifyClient | null) {}

  async handle(ctx: HandlerContext): Promise<void> {
    const lang = detectLang(ctx.text);
    if (!this.dify) {
      await ctx.reply.done(
        pick(
          lang,
          '📚 知识库（Dify）未配置（缺 DIFY_BASE_URL / DIFY_API_KEY），暂无法回答文档型问题。',
          '📚 The knowledge base (Dify) is not configured (missing DIFY_BASE_URL / DIFY_API_KEY); documentation questions are unavailable.'
        )
      );
      return;
    }

    logger.info(`[知识问答] user=${ctx.userId} q="${ctx.text}"`);
    ctx.reply.push(pick(lang, '📚 查询知识库中…', '📚 Searching the knowledge base…'));

    try {
      const prev = this.conversations.get(ctx.userId);
      const ans = await this.dify.chat(ctx.text, ctx.userId, prev, ctx.signal);
      if (ans.conversationId) this.conversations.set(ctx.userId, ans.conversationId);

      let text = ans.answer.trim() || pick(lang, '（知识库未返回内容）', '(the knowledge base returned nothing)');
      if (ans.citations.length > 0) {
        text += pick(lang, `\n\n📎 参考：${ans.citations.join('、')}`, `\n\n📎 References: ${ans.citations.join(', ')}`);
      }
      await ctx.reply.done(text);
      logger.info(`[知识问答] 完成，${ans.answer.length} 字，引用 ${ans.citations.length} 篇`);
    } catch (e) {
      logger.error('[知识问答] 失败:', e);
      await ctx.reply.fail(
        pick(lang, '知识库查询失败：' + (e as Error).message, 'Knowledge base query failed: ' + (e as Error).message)
      );
    }
  }
}
