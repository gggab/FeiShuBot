/**
 * 普通聊天 Handler：调 LLM 流式回复，并维护会话上下文。
 * Chat handler: stream LLM reply and keep session history.
 * 设计对齐 docs/handlers.md §5。
 */

import { Handler, HandlerContext } from './types';
import { LlmClient, ChatMessage } from '../llm/client';
import { Identity, buildChatSystemPrompt } from '../config/identity';
import { logger } from '../util/logger';

export class ChatHandler implements Handler {
  readonly intent = 'chat' as const;

  /** 由 IDENTITY.md 装载的身份构造，助手名字/描述改文件即可，代码无需改。 */
  private readonly systemPrompt: string;

  constructor(private readonly llm: LlmClient, identity: Identity) {
    this.systemPrompt = buildChatSystemPrompt(identity);
  }

  async handle(ctx: HandlerContext): Promise<void> {
    const userText = ctx.intent.task;
    ctx.session.addUser(userText, ctx.userId);

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...ctx.session.getHistory(),
    ];

    logger.info(`[chat] 调用 LLM 流式回复…（上下文 ${ctx.session.getHistory().length} 条）`);
    let acc = '';
    try {
      for await (const delta of this.llm.chatStream(messages, { signal: ctx.signal })) {
        acc += delta;
        ctx.reply.push(delta);
      }
      ctx.session.addAssistant(acc);
      await ctx.reply.done(acc);
      logger.info(`[chat] 完成，输出 ${acc.length} 字`);
    } catch (e) {
      logger.error('[chat] 生成失败:', e);
      await ctx.reply.fail('生成回复失败，请重试 / Failed to generate a reply: ' + (e as Error).message);
    }
  }
}
