/**
 * 按键串行化的互斥锁：同一 key 的任务排队执行，不同 key 并行。
 * Keyed async mutex. 用于把「同一仓库」的代码阅读与 Git 运维串行化，
 * 避免读到一半被切分支/拉取覆盖（见 handlers/code-understanding.ts、handlers/git-command.ts）。
 */

export class KeyedMutex {
  /** 每个 key 的队尾 Promise；resolve 即代表前序任务全部结束（无论成败）。 */
  private readonly tails = new Map<string, Promise<unknown>>();

  /** 在 key 的串行队列上执行 fn；返回 fn 的结果（异常照常抛给调用方）。 */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // 无论前序成功或失败，都接着跑本任务（不让一个失败卡死整条队列）。
    const result = prev.then(fn, fn);
    // 队尾只跟踪“是否结束”，吞掉结果与异常，避免 UnhandledRejection。
    this.tails.set(
      key,
      result.then(
        () => undefined,
        () => undefined
      )
    );
    return result;
  }
}
