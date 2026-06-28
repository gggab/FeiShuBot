/**
 * 节流：限制函数在 intervalMs 内最多触发一次，并保证最后一次调用最终执行（trailing）。
 * 用于飞书卡片的流式更新（避免过于频繁的 patch 调用）。
 * Throttle with trailing-edge guarantee, used for streaming card updates.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void | Promise<void>,
  intervalMs: number
): (...args: A) => void {
  let last = 0;
  let timer: NodeJS.Timeout | null = null;
  let pending: A | null = null;

  const invoke = (args: A): void => {
    last = Date.now();
    void fn(...args);
  };

  return (...args: A): void => {
    const remaining = intervalMs - (Date.now() - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      invoke(args);
    } else {
      pending = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (pending) {
            const p = pending;
            pending = null;
            invoke(p);
          }
        }, remaining);
      }
    }
  };
}
