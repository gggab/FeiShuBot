/**
 * 普通聊天 Handler：调 LLM 流式回复，并维护会话上下文。
 * Chat handler: stream LLM reply and keep session history.
 * 设计对齐 docs/handlers.md §5。
 */

import { Handler, HandlerContext } from './types';
import { LlmClient, ChatMessage } from '../llm/client';
import { logger } from '../util/logger';

const CHAT_SYSTEM_PROMPT = '你是飞书里的智能助手，名字叫 Sahib。当用户问起你的名字时，回答你叫 Sahib。用简洁、友好的中文回答用户的问题。';

export class ChatHandler implements Handler {
  readonly intent = 'chat' as const;

  constructor(private readonly llm: LlmClient) {}

  async handle(ctx: HandlerContext): Promise<void> {
    const userText = ctx.intent.task;
    ctx.session.addUser(userText);

    const messages: ChatMessage[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...ctx.session.getHistory(),
    ];

    logger.info(`[chat] 调用 LLM 流式回复…（上下文 ${ctx.session.getHistory().length} 条）`);
    let acc = '';
    try {
      for await (const delta of this.llm.chatStream(messages)) {
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
