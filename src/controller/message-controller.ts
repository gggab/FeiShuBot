/**
 * 消息编排控制器。
 * Message orchestration controller.
 *
 * M2：特殊命令(/clear) → 会话上下文 → 流式聊天回复（所有文本都走聊天）。
 * M3 起在聊天之前加入意图识别 + Handler 路由（见 docs/architecture.md §3）。
 */

import { IncomingMessage } from '../feishu/message';
import { sendText, CardReplyStream } from '../feishu/reply';
import { getSession } from '../session/context';
import { ChatHandler } from '../handlers/chat';
import { HandlerContext } from '../handlers/types';
import { logger } from '../util/logger';

export class MessageController {
  /** 每用户单任务，防止对同一张卡片并发写入。 */
  private readonly inFlight = new Set<string>();

  constructor(private readonly chatHandler: ChatHandler) {}

  async handle(msg: IncomingMessage): Promise<void> {
    if (!msg.chatId) {
      logger.warn('收到缺少 chatId 的消息，忽略');
      return;
    }
    if (!msg.supported) {
      await sendText(msg.chatId, '暂仅支持文本消息 / Please send a text message.');
      return;
    }
    const text = msg.text;
    if (!text) return;

    const session = getSession(msg.userId);

    if (text.startsWith('/clear')) {
      session.clear();
      await sendText(msg.chatId, '已清空上下文 / Context cleared.');
      return;
    }

    if (this.inFlight.has(msg.userId)) {
      await sendText(msg.chatId, '正在处理上一条消息，请稍候 / Previous message still in progress.');
      return;
    }

    this.inFlight.add(msg.userId);
    try {
      const reply = new CardReplyStream(msg.chatId);
      await reply.init();

      const ctx: HandlerContext = {
        userId: msg.userId,
        chatId: msg.chatId,
        // M2：合成一个 chat 意图；M3 起改为意图识别结果。
        intent: { intent: 'chat', confidence: 1, task: text },
        session,
        reply,
      };
      await this.chatHandler.handle(ctx);
    } finally {
      this.inFlight.delete(msg.userId);
    }
  }
}
