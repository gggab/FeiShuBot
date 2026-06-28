import { describe, it, expect } from 'vitest';
import { Deduplicator } from '../../src/feishu/dedup';

describe('Deduplicator', () => {
  it('首次见到返回 false，再次见到返回 true', () => {
    let now = 1000;
    const d = new Deduplicator(100, () => now);
    expect(d.isDuplicate('m1')).toBe(false);
    expect(d.isDuplicate('m1')).toBe(true);
  });

  it('TTL 内仍判重，超过 TTL 后重新放行', () => {
    let now = 1000;
    const d = new Deduplicator(100, () => now);
    expect(d.isDuplicate('m1')).toBe(false);
    now += 50;
    expect(d.isDuplicate('m1')).toBe(true); // 窗口内
    now += 100;
    expect(d.isDuplicate('m1')).toBe(false); // 已过期
  });

  it('空 id 不去重（保守，不丢消息）', () => {
    const d = new Deduplicator();
    expect(d.isDuplicate('')).toBe(false);
    expect(d.isDuplicate('')).toBe(false);
  });

  it('不同 id 互不影响', () => {
    const d = new Deduplicator();
    expect(d.isDuplicate('a')).toBe(false);
    expect(d.isDuplicate('b')).toBe(false);
    expect(d.isDuplicate('a')).toBe(true);
  });
});
