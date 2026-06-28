/**
 * 飞书消息事件归一化（纯函数，便于测试）。
 * Normalize a Feishu `im.message.receive_v1` event into IncomingMessage.
 * 设计对齐 docs/feishu-integration.md §2。
 */

import { logger } from '../util/logger';

export interface IncomingMessage {
  /** 发送者 open_id / Sender open_id. */
  userId: string;
  /** 会话 ID / Chat ID. */
  chatId: string;
  /** 会话类型：p2p / group。 */
  chatType: string;
  /** 消息类型：text / image / post / ... 。 */
  messageType: string;
  /** 消息 ID（回复用） / Message ID. */
  messageId: string;
  /** 解析出的文本（仅 supported 时有值，已 trim）。 */
  text: string;
  /** 是否为当前支持的消息类型 / Whether the type is supported. */
  supported: boolean;
}

/** 事件的结构化最小子集，便于在不依赖 SDK 类型的情况下测试。 */
interface MessageReceiveLike {
  sender?: { sender_id?: { open_id?: string } };
  message: {
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    message_id?: string;
  };
}

/** M1 仅支持文本；post 等后续里程碑扩展。 */
const SUPPORTED_TYPES = new Set(['text']);

export function parseIncoming(event: MessageReceiveLike): IncomingMessage {
  const { message } = event;
  const messageType = message.message_type ?? '';
  const supported = SUPPORTED_TYPES.has(messageType);

  return {
    userId: event.sender?.sender_id?.open_id ?? '',
    chatId: message.chat_id ?? '',
    chatType: message.chat_type ?? '',
    messageType,
    messageId: message.message_id ?? '',
    text: supported ? extractText(message.content) : '',
    supported,
  };
}

function extractText(content: string | undefined): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return (parsed.text ?? '').trim();
  } catch (e) {
    // 文本消息的 content 正常是 {"text":"..."}；解析失败属异常输入，记录后按空文本处理（已显式 surface，非静默吞错）。
    logger.warn(`解析消息 content 失败: ${(e as Error).message}`);
    return '';
  }
}
