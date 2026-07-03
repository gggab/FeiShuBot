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
import { buildMarkdownCard, CardStatus } from './card';
import { ReplyStream } from '../handlers/types';
import { throttle } from '../util/throttle';
import { logger } from '../util/logger';

/** 卡片流式更新的节流间隔（毫秒）。 */
const CARD_UPDATE_INTERVAL_MS = 200;

/**
 * 处理中的心跳刷新间隔（毫秒）。远宽于流式节流，仅用于在长时间静默时
 * 刷新头部「已用时长」，让卡片不至于看起来「冻住」。
 */
const CARD_HEARTBEAT_INTERVAL_MS = 2000;

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

/** CardReplyStream 可选参数：绑定停止按钮的 taskId 与取消信号。 */
export interface CardReplyOptions {
  /** 处理中渲染「停止回复」按钮，携带该 taskId。 */
  taskId?: string;
  /** 用户点「停止」时触发；一旦 abort，终态渲染为「已停止」而非「失败」。 */
  signal?: AbortSignal;
}

/**
 * 基于可更新卡片的流式回复。先发占位卡片拿到 messageId，
 * 随后 push 的增量经节流写回同一张卡片；done/fail 做最终更新并关闭流式。
 * 处理中渲染「停止回复」按钮；用户停止后终态为「已停止」并保留已生成内容。
 */
export class CardReplyStream implements ReplyStream {
  private buffer = '';
  private messageId = '';
  private closed = false;
  private finalized = false;
  private startedAt = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly taskId?: string;
  private aborted = false;
  /** 卡片更新串行链：保证 patch 按提交顺序落地，终态不被在途的 processing 更新覆盖。 */
  private updateChain: Promise<void> = Promise.resolve();
  private readonly scheduleUpdate = throttle(() => {
    if (!this.closed) void this.flush('processing');
  }, CARD_UPDATE_INTERVAL_MS);

  constructor(
    private readonly chatId: string,
    opts: CardReplyOptions = {}
  ) {
    this.taskId = opts.taskId;
    const signal = opts.signal;
    if (signal) {
      if (signal.aborted) this.aborted = true;
      // 用户点「停止」→ 立即把卡片切到「已停止」，不等 Handler 循环抛错（有的 Handler
      // 的耗时调用并不响应 signal，若不主动刷新，卡片会一直停在「处理中」）。
      else signal.addEventListener('abort', () => this.onAbort(), { once: true });
    }
  }

  /** 发送占位卡片并记录 messageId，启动处理中心跳。必须在 push 之前调用。 */
  async init(placeholder = '思考中… / Thinking…'): Promise<void> {
    this.startedAt = Date.now();
    const { messageId } = await sendCard(this.chatId, buildMarkdownCard(placeholder, 'processing', 0, this.taskId));
    this.messageId = messageId;
    // init 期间就被停止：立即渲染「已停止」终态。
    if (this.aborted && !this.finalized) {
      await this.finalize('stopped');
      return;
    }
    // 心跳：处理未完成时定期刷新头部「已用时长」，即使没有新增量也让用户看到仍在处理。
    this.heartbeat = setInterval(() => {
      if (!this.closed) void this.flush('processing');
    }, CARD_HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref?.();
  }

  push(textChunk: string): void {
    if (this.closed) return;
    this.buffer += textChunk;
    this.scheduleUpdate();
  }

  async done(finalText?: string): Promise<void> {
    if (this.finalized) return;
    if (finalText !== undefined) this.buffer = finalText;
    await this.finalize('done');
  }

  /**
   * 失败终态。若失败源自用户主动停止（signal 已 abort），渲染为「已停止」并保留
   * 已生成的部分内容，不展示底层报错文案；否则渲染红色「处理失败」并展示 message。
   */
  async fail(message: string): Promise<void> {
    if (this.finalized) return;
    if (this.aborted) {
      await this.finalize('stopped');
    } else {
      this.buffer = message;
      await this.finalize('error');
    }
  }

  /** 收到取消信号：抢先把卡片切到「已停止」终态（幂等，后续 done/fail 将被忽略）。 */
  private onAbort(): void {
    this.aborted = true;
    if (this.finalized || !this.messageId) return; // init 前的 abort 由 init 收尾
    void this.finalize('stopped');
  }

  /** 收敛为终态：关闭流、停心跳、（停止态）补充说明，刷新一次卡片。只生效一次。 */
  private async finalize(status: CardStatus): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.closed = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (status === 'stopped') {
      this.buffer = `${this.buffer.trim()}\n\n⏹ 已由用户停止`.trim();
    }
    await this.flush(status);
  }

  /**
   * 串行化卡片更新：按提交顺序逐个 patch。终态(done/error/stopped)总在最后提交，
   * 因而最后生效——不会被并发在途的 processing 更新覆盖，避免「完成一闪又回到处理中、
   * 内容还回退成半截」。链上任务自吞错误，不中断后续 patch。
   */
  private flush(status: CardStatus): Promise<void> {
    this.updateChain = this.updateChain.then(() => this.doFlush(status));
    return this.updateChain;
  }

  private async doFlush(status: CardStatus): Promise<void> {
    // 终态已定后，丢弃仍排在链上的 processing 更新（它们只会把已完成的卡片打回处理中）。
    if (status === 'processing' && this.finalized) return;
    try {
      const elapsedMs = status === 'processing' ? Date.now() - this.startedAt : undefined;
      await updateCard(this.messageId, buildMarkdownCard(this.buffer || '…', status, elapsedMs, this.taskId));
    } catch (e) {
      // 卡片更新失败不应让整个处理流程崩溃；显式记录。
      logger.error('更新卡片失败:', e);
    }
  }
}
