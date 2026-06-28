/**
 * 事件去重：飞书事件为 at-least-once 投递，同一消息可能被多次推送（含超时重推）。
 * 按 message_id 在一个时间窗内去重，保证同一条消息只处理一次。
 * Deduplicate Feishu events (at-least-once delivery) by message_id within a TTL window.
 */

export class Deduplicator {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = 10 * 60 * 1000,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * 返回该 id 是否为重复事件（true=已见过，应忽略）。
   * 空 id 视为不可去重，按非重复处理（保守，不丢消息）。
   */
  isDuplicate(id: string): boolean {
    if (!id) return false;

    const t = this.now();
    // 顺手清理过期项，避免无界增长。
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= t) this.seen.delete(key);
    }

    if (this.seen.has(id)) return true;
    this.seen.set(id, t + this.ttlMs);
    return false;
  }
}
