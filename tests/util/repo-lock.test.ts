import { describe, it, expect } from 'vitest';
import { KeyedMutex } from '../../src/util/repo-lock';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('KeyedMutex', () => {
  it('同一 key 串行执行（不交叠）', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];

    const task = (name: string) =>
      mutex.run('repo', async () => {
        events.push(`${name}-start`);
        await sleep(20);
        events.push(`${name}-end`);
      });

    await Promise.all([task('A'), task('B')]);
    // B 必须在 A 完全结束后才开始
    expect(events).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  it('不同 key 并行执行（可交叠）', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];

    const task = (key: string, name: string) =>
      mutex.run(key, async () => {
        events.push(`${name}-start`);
        await sleep(20);
        events.push(`${name}-end`);
      });

    await Promise.all([task('r1', 'A'), task('r2', 'B')]);
    // 两者都先 start 再 end（交叠），而非严格串行
    expect(events.slice(0, 2).sort()).toEqual(['A-start', 'B-start']);
  });

  it('前序任务抛错不卡死后续任务', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run('repo', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const ok = await mutex.run('repo', async () => 42);
    expect(ok).toBe(42);
  });

  it('返回 fn 的结果', async () => {
    const mutex = new KeyedMutex();
    expect(await mutex.run('k', async () => 'v')).toBe('v');
  });
});
