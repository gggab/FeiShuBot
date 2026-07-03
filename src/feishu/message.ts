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

/** 一条 @ 提及：key 即正文里的占位符（如 `@_user_1`）。 */
export interface Mention {
  key?: string;
  name?: string;
  id?: { open_id?: string };
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
    mentions?: Mention[];
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
    text: supported ? stripMentions(extractText(message.content), message.mentions) : '',
    supported,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 去掉正文里的 @ 提及占位符（`@_user_1` / `@_all` 等）。
 * 群里 @机器人 触发时，飞书会把 `@_user_1` 拼在文本最前，若不剥离会导致
 * `/git`、`/clear` 等命令前缀失配、并干扰意图识别。用 mentions[].key 精确匹配，
 * 避免误伤形如 `@_user_1` 的普通文本；末尾折叠多余空白。
 */
export function stripMentions(text: string, mentions?: Mention[]): string {
  if (!text || !mentions || mentions.length === 0) return text;
  let out = text;
  for (const m of mentions) {
    if (!m.key) continue;
    // 前瞻 (?![0-9]) 防止 `@_user_1` 命中 `@_user_10`。
    out = out.replace(new RegExp(escapeRegExp(m.key) + '(?![0-9])', 'g'), '');
  }
  return out.replace(/\s+/g, ' ').trim();
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
