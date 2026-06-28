/**
 * 飞书消息发送/更新封装。
 * Feishu message send/update helpers.
 *
 * - sendText：文本消息（M1）。
 * - sendCard / updateCard：交互卡片的发送与更新（M2）。
 * - CardReplyStream：流式回复句柄，把增量节流写回同一张卡片（实现 ReplyStream）。
 * 设计对齐 docs/feishu-integration.md §3 与 docs/handlers.md §1。
 */

import { larkClient } from './client';
import { buildMarkdownCard } from './card';
import { ReplyStream } from '../handlers/types';
import { throttle } from '../util/throttle';
import { logger } from '../util/logger';

/** 卡片流式更新的节流间隔（毫秒）。 */
const CARD_UPDATE_INTERVAL_MS = 200;

export async function sendText(chatId: string, text: string): Promise<{ messageId: string }> {
  const res = await larkClient.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
  if (res.code !== 0) {
    throw new Error(`发送消息失败: code=${res.code} msg=${res.msg}`);
  }
  logger.debug(`[飞书] sendText chat=${chatId} chars=${text.length} message_id=${res.data?.message_id ?? ''}`);
  return { messageId: res.data?.message_id ?? '' };
}

export async function sendCard(chatId: string, card: object): Promise<{ messageId: string }> {
  const res = await larkClient.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    },
  });
  if (res.code !== 0) {
    throw new Error(`发送卡片失败: code=${res.code} msg=${res.msg}`);
  }
  logger.debug(`[飞书] sendCard chat=${chatId} message_id=${res.data?.message_id ?? ''}`);
  return { messageId: res.data?.message_id ?? '' };
}

export async function updateCard(messageId: string, card: object): Promise<void> {
  const res = await larkClient.im.v1.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  });
  if (res.code !== 0) {
    throw new Error(`更新卡片失败: code=${res.code} msg=${res.msg}`);
  }
  logger.debug(`[飞书] updateCard message_id=${messageId}`);
}

/**
 * 基于可更新卡片的流式回复。先发占位卡片拿到 messageId，
 * 随后 push 的增量经节流写回同一张卡片；done/fail 做最终更新并关闭流式。
 */
export class CardReplyStream implements ReplyStream {
  private buffer = '';
  private messageId = '';
  private closed = false;
  private readonly scheduleUpdate = throttle(() => {
    if (!this.closed) void this.flush(false);
  }, CARD_UPDATE_INTERVAL_MS);

  constructor(private readonly chatId: string) {}

  /** 发送占位卡片并记录 messageId。必须在 push 之前调用。 */
  async init(placeholder = '思考中… / Thinking…'): Promise<void> {
    const { messageId } = await sendCard(this.chatId, buildMarkdownCard(placeholder));
    this.messageId = messageId;
  }

  push(textChunk: string): void {
    if (this.closed) return;
    this.buffer += textChunk;
    this.scheduleUpdate();
  }

  async done(finalText?: string): Promise<void> {
    this.closed = true;
    if (finalText !== undefined) this.buffer = finalText;
    await this.flush(true);
  }

  async fail(message: string): Promise<void> {
    this.closed = true;
    this.buffer = message;
    await this.flush(true);
  }

  private async flush(final: boolean): Promise<void> {
    try {
      await updateCard(this.messageId, buildMarkdownCard(this.buffer || '…', !final));
    } catch (e) {
      // 卡片更新失败不应让整个处理流程崩溃；显式记录。
      logger.error('更新卡片失败:', e);
    }
  }
}
