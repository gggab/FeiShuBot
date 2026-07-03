import { describe, it, expect } from 'vitest';
import { ConversationQueue } from '../../src/util/conversation-queue';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 造一个可外部释放的任务，便于精确控制「正在运行」这一状态。 */
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

describe('ConversationQueue', () => {
  it('同一 key 严格串行、按到达顺序逐条处理（不交叠）', async () => {
    const q = new ConversationQueue();
    const events: string[] = [];
    const task = (name: string) => ({
      key: 'k',
      messageId: name,
      run: async () => {
        events.push(`${name}-start`);
        await sleep(20);
        events.push(`${name}-end`);
      },
    });
    q.enqueue(task('A'));
    q.enqueue(task('B'));
    q.enqueue(task('C'));
    await sleep(120);
    expect(events).toEqual(['A-start', 'A-end', 'B-start', 'B-end', 'C-start', 'C-end']);
  });

  it('不同 key 并行处理（可交叠）', async () => {
    const q = new ConversationQueue();
    const events: string[] = [];
    const task = (key: string, name: string) => ({
      key,
      messageId: name,
      run: async () => {
        events.push(`${name}-start`);
        await sleep(20);
        events.push(`${name}-end`);
      },
    });
    q.enqueue(task('k1', 'A'));
    q.enqueue(task('k2', 'B'));
    await sleep(60);
    // 两者先后 start（交叠）而非严格串行
    expect(events.slice(0, 2).sort()).toEqual(['A-start', 'B-start']);
  });

  it('空闲入队 ahead=0；忙时排队返回前方数量（含运行中）', () => {
    const q = new ConversationQueue();
    const d = deferred();
    // 第一个进来立即运行（被 blocker 挂住），ahead=0
    expect(q.enqueue({ key: 'k', messageId: 'm1', run: () => d.promise }).ahead).toBe(0);
    // 第二、三个排队：前方分别有 1（运行中）、2 个
    expect(q.enqueue({ key: 'k', messageId: 'm2', run: async () => {} }).ahead).toBe(1);
    expect(q.enqueue({ key: 'k', messageId: 'm3', run: async () => {} }).ahead).toBe(2);
    d.release();
  });

  it('队列已满则拒绝（不入队），不影响正在运行/已排队的任务', () => {
    const q = new ConversationQueue(2); // 最多排队 2 个
    const d = deferred();
    q.enqueue({ key: 'k', messageId: 'run', run: () => d.promise }); // 运行中
    expect(q.enqueue({ key: 'k', messageId: 'p1', run: async () => {} }).rejected).toBe(false);
    expect(q.enqueue({ key: 'k', messageId: 'p2', run: async () => {} }).rejected).toBe(false);
    const r = q.enqueue({ key: 'k', messageId: 'p3', run: async () => {} });
    expect(r).toEqual({ rejected: true, ahead: -1 });
    expect(q.depth('k')).toBe(3); // 运行 1 + 排队 2；被拒的没进来
    d.release();
  });

  it('cancel 按 messageId 移除待处理项，被撤回的任务永不执行', async () => {
    const q = new ConversationQueue();
    const ran: string[] = [];
    const d = deferred();
    q.enqueue({ key: 'k', messageId: 'run', run: () => d.promise }); // 运行中挂住
    q.enqueue({ key: 'k', messageId: 'keep', run: async () => void ran.push('keep') });
    q.enqueue({ key: 'k', messageId: 'drop', run: async () => void ran.push('drop') });

    expect(q.cancel('drop')).toBe(true);
    expect(q.cancel('nope')).toBe(false);

    d.release(); // 放行运行中的任务，队列继续抽干
    await sleep(30);
    expect(ran).toEqual(['keep']); // drop 已被撤回，未执行
  });

  it('cancel 不影响正在运行的任务（运行中的消息已出队）', async () => {
    const q = new ConversationQueue();
    let done = false;
    const d = deferred();
    q.enqueue({
      key: 'k',
      messageId: 'running',
      run: async () => {
        await d.promise;
        done = true;
      },
    });
    // 正在运行的消息不在待处理队列里，撤回它返回 false
    expect(q.cancel('running')).toBe(false);
    d.release();
    await sleep(20);
    expect(done).toBe(true);
  });

  it('cancel 触发被移除任务的 onCancelled（反馈用）；未命中不触发', () => {
    const q = new ConversationQueue();
    const d = deferred();
    const cancelled: string[] = [];
    q.enqueue({ key: 'k', messageId: 'run', run: () => d.promise }); // 运行中占位
    q.enqueue({ key: 'k', messageId: 'drop', run: async () => {}, onCancelled: () => cancelled.push('drop') });

    expect(q.cancel('drop')).toBe(true);
    expect(cancelled).toEqual(['drop']);
    // 未命中的撤回不触发任何回调
    expect(q.cancel('nope')).toBe(false);
    expect(cancelled).toEqual(['drop']);
    d.release();
  });

  it('cancel 对正在运行的任务不触发 onCancelled（已出队）', async () => {
    const q = new ConversationQueue();
    const d = deferred();
    const cancelled: string[] = [];
    q.enqueue({
      key: 'k',
      messageId: 'running',
      run: () => d.promise,
      onCancelled: () => cancelled.push('running'),
    });
    expect(q.cancel('running')).toBe(false);
    expect(cancelled).toEqual([]);
    d.release();
    await sleep(10);
  });

  it('单个任务抛错不卡死后续任务', async () => {
    const q = new ConversationQueue();
    const ran: string[] = [];
    q.enqueue({ key: 'k', messageId: 'boom', run: async () => { throw new Error('boom'); } });
    q.enqueue({ key: 'k', messageId: 'next', run: async () => void ran.push('next') });
    await sleep(30);
    expect(ran).toEqual(['next']);
  });

  it('队列抽干后清理内部状态（depth 归零）', async () => {
    const q = new ConversationQueue();
    q.enqueue({ key: 'k', messageId: 'm', run: async () => {} });
    await sleep(20);
    expect(q.depth('k')).toBe(0);
  });
});
