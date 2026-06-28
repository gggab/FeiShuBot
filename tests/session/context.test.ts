import { describe, it, expect } from 'vitest';
import { SessionContext } from '../../src/session/context';

describe('SessionContext', () => {
  it('记录 user/assistant 并仅保留近 maxTurns 轮', () => {
    const s = new SessionContext('u', 2); // 2 轮 = 4 条消息
    s.addUser('u1');
    s.addAssistant('a1');
    s.addUser('u2');
    s.addAssistant('a2');
    s.addUser('u3');
    s.addAssistant('a3');

    const h = s.getHistory();
    expect(h.length).toBe(4);
    expect(h[0]).toEqual({ role: 'user', content: 'u2' });
    expect(h[3]).toEqual({ role: 'assistant', content: 'a3' });
  });

  it('clear 清空历史', () => {
    const s = new SessionContext('u', 5);
    s.addUser('x');
    s.addAssistant('y');
    s.clear();
    expect(s.getHistory()).toEqual([]);
  });

  it('getHistory 返回副本，外部修改不影响内部', () => {
    const s = new SessionContext('u', 5);
    s.addUser('x');
    const h = s.getHistory();
    h.push({ role: 'assistant', content: 'tampered' });
    expect(s.getHistory().length).toBe(1);
  });
});
