/**
 * 每会话串行队列：同一 key 的消息按到达顺序**逐条**处理，不同 key 并行。
 * 取代旧的「忙则拒绝」守卫——忙时**排队而非丢弃**；排队中的消息可按 messageId
 * 撤销（用户撤回消息时）。正在运行的任务不在待处理队列里，撤回不影响它。
 * Per-conversation FIFO queue: serialize by key, run different keys in parallel,
 * enqueue instead of dropping when busy, cancel a pending item by messageId.
 *
 * key 由 Controller 组装为 `${userId}:${chatId}`，因此同一人在不同会话互不阻塞，
 * 同一会话内则严格串行（见 controller/message-controller.ts）。
 */

import { logger } from './logger';

/** 一个排队任务：触发消息 id + 实际处理逻辑。 */
export interface QueuedTask {
  /** 会话隔离键，通常是 `${userId}:${chatId}`。 */
  key: string;
  /** 触发消息 id；撤回时用它精确移除排队项。 */
  messageId: string;
  /** 处理逻辑；错误应自行 surface，队列只兜底记录、不打断后续任务。 */
  run: () => Promise<void>;
  /**
   * 该任务在**开始处理前**被撤回移除（cancel）时触发，用于给用户可见反馈。
   * 已开始处理的任务已出队，不会触发；不设则静默移除。
   */
  onCancelled?: () => void;
}

/** 入队结果。 */
export interface EnqueueResult {
  /** 是否因队列已满被拒绝（未入队）。 */
  rejected: boolean;
  /** 本任务前方待处理数量（含正在运行的那个）：0 表示立即开始；rejected 时为 -1。 */
  ahead: number;
}

/** 单个 key 的队列状态。 */
interface QueueState {
  /** 是否已有 drain 循环在处理该 key（即有一个任务正在运行）。 */
  running: boolean;
  /** 待处理任务（不含正在运行的那个——它已被 shift 出队）。 */
  pending: QueuedTask[];
}

/** 每个 key 最多允许**排队**的任务数（不含正在运行的那个）；超出即拒绝，防止无界堆积。 */
export const DEFAULT_MAX_PENDING = 10;

export class ConversationQueue {
  private readonly queues = new Map<string, QueueState>();

  constructor(private readonly maxPending: number = DEFAULT_MAX_PENDING) {}

  /**
   * 入队并按需启动处理：空闲 → 立即开始（ahead=0）；忙 → 追加到队尾并返回前方数量；
   * 队列已满 → 拒绝（rejected=true，不入队）。
   */
  enqueue(task: QueuedTask): EnqueueResult {
    let q = this.queues.get(task.key);
    if (!q) {
      q = { running: false, pending: [] };
      this.queues.set(task.key, q);
    }
    if (q.pending.length >= this.maxPending) {
      return { rejected: true, ahead: -1 };
    }
    const ahead = (q.running ? 1 : 0) + q.pending.length;
    q.pending.push(task);
    void this.drain(task.key);
    return { rejected: false, ahead };
  }

  /**
   * 按 messageId 从**待处理**队列移除一项（撤回用）；正在运行的任务已出队，不受影响。
   * 返回是否移除成功。
   */
  cancel(messageId: string): boolean {
    for (const q of this.queues.values()) {
      const idx = q.pending.findIndex((t) => t.messageId === messageId);
      if (idx >= 0) {
        const [removed] = q.pending.splice(idx, 1);
        removed.onCancelled?.();
        return true;
      }
    }
    return false;
  }

  /** 某 key 当前深度（正在运行的 + 待处理的）。测试/诊断用。 */
  depth(key: string): number {
    const q = this.queues.get(key);
    if (!q) return 0;
    return (q.running ? 1 : 0) + q.pending.length;
  }

  /** 串行抽干某 key 的队列；已有 drain 在跑则直接返回（幂等）。 */
  private async drain(key: string): Promise<void> {
    const q = this.queues.get(key);
    if (!q || q.running) return;
    q.running = true;
    try {
      while (q.pending.length > 0) {
        const task = q.pending.shift()!;
        try {
          await task.run();
        } catch (e) {
          // run 内部应已 surface；这里兜底避免一个失败卡死整条队列。
          logger.error(`[队列] 任务异常 key=${key} message_id=${task.messageId}:`, e);
        }
      }
    } finally {
      q.running = false;
      // 队列已空则清理，避免 Map 随会话数无界增长。
      if (q.pending.length === 0) this.queues.delete(key);
    }
  }
}
