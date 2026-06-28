/**
 * Handler 契约。设计对齐 docs/handlers.md §1。
 * Handler contracts.
 */

import { IntentResult } from '../intent/types';
import { SessionContext } from '../session/context';

/**
 * 流式回复句柄：内部封装节流 updateMessage，把增量写回同一张飞书卡片。
 * Streaming reply handle bound to a single Feishu card.
 */
export interface ReplyStream {
  /** 追加增量文本（内部节流写回卡片） / Append a chunk. */
  push(textChunk: string): void;
  /** 完成并最终刷新 / Finish and flush. */
  done(finalText?: string): Promise<void>;
  /** 失败提示（显式，不吞错） / Surface a failure. */
  fail(message: string): Promise<void>;
}

export interface HandlerContext {
  userId: string;
  chatId: string;
  intent: IntentResult;
  session: SessionContext;
  reply: ReplyStream;
}

export interface Handler {
  readonly intent: IntentResult['intent'];
  handle(ctx: HandlerContext): Promise<void>;
}
