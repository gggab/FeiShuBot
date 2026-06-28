/**
 * 消息编排控制器。
 * Message orchestration controller.
 *
 * M1：原样回声，验证长连接与应用配置。
 * M3 起替换为：特殊命令 → 会话上下文 → 意图识别 → Handler 路由（见 docs/architecture.md §3）。
 */

import { IncomingMessage } from '../feishu/message';
import { sendText } from '../feishu/reply';
import { logger } from '../util/logger';

export class MessageController {
  async handle(msg: IncomingMessage): Promise<void> {
    if (!msg.chatId) {
      logger.warn('收到缺少 chatId 的消息，忽略');
      return;
    }

    if (!msg.supported) {
      await sendText(msg.chatId, '暂仅支持文本消息 / Please send a text message.');
      return;
    }

    if (!msg.text) {
      // 空文本（如解析失败）忽略，不回声。
      return;
    }

    logger.info(`echo <- ${msg.userId}: ${msg.text}`);
    await sendText(msg.chatId, `收到：${msg.text}`);
  }
}
