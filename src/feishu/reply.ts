/**
 * 飞书消息发送/更新封装。
 * Feishu message send/update helpers.
 *
 * M1：仅提供文本发送（sendText）。
 * M2 将在此补充：流式 markdown 卡片的发送/节流更新（见 docs/feishu-integration.md §3）。
 */

import { larkClient } from './client';

/**
 * 向会话发送一条文本消息。
 * Send a plain text message to a chat.
 */
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
  return { messageId: res.data?.message_id ?? '' };
}
