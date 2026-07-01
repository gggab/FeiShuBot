import { describe, it, expect } from 'vitest';
import { SessionContext, type SessionStore, type StoredTurn, type ChatTurn } from '../../src/session/context';

/** 记录调用的内存假实现，用于隔离测试 SessionContext 与 store 的协作。 */
class FakeStore implements SessionStore {
  appended: Array<{ chatId: string; turn: StoredTurn }> = [];
  cleared: string[] = [];
  preset: ChatTurn[] = [];
  load(_chatId: string, _limit: number): ChatTurn[] {
    return [...this.preset];
  }
  append(chatId: string, turn: StoredTurn): void {
    this.appended.push({ chatId, turn });
  }
  clear(chatId: string): void {
    this.cleared.push(chatId);
  }
}

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

  describe('注入 SessionStore（持久化协作）', () => {
    it('构造时从 store 回灌历史', () => {
      const store = new FakeStore();
      store.preset = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yo' },
      ];
      const s = new SessionContext('c1', 5, store);
      expect(s.getHistory()).toEqual(store.preset);
    });

    it('addUser/addAssistant 写穿透到 store，并透传 senderId', () => {
      const store = new FakeStore();
      const s = new SessionContext('c1', 5, store);
      s.addUser('问题', 'ou_alice');
      s.addAssistant('回答');

      expect(store.appended).toEqual([
        { chatId: 'c1', turn: { role: 'user', content: '问题', senderId: 'ou_alice' } },
        { chatId: 'c1', turn: { role: 'assistant', content: '回答', senderId: undefined } },
      ]);
    });

    it('getHistory 不含 senderId（仅 role/content 喂给 LLM）', () => {
      const store = new FakeStore();
      const s = new SessionContext('c1', 5, store);
      s.addUser('q', 'ou_bob');
      expect(s.getHistory()).toEqual([{ role: 'user', content: 'q' }]);
    });

    it('clear 同时清空内存与 store', () => {
      const store = new FakeStore();
      const s = new SessionContext('c1', 5, store);
      s.addUser('q', 'ou_bob');
      s.clear();
      expect(s.getHistory()).toEqual([]);
      expect(store.cleared).toEqual(['c1']);
    });

    it('内存截断不影响写穿透（每条都入库）', () => {
      const store = new FakeStore();
      const s = new SessionContext('c1', 1, store); // 1 轮 = 内存仅留 2 条
      s.addUser('u1', 'ou_a');
      s.addAssistant('a1');
      s.addUser('u2', 'ou_a');
      s.addAssistant('a2');
      expect(s.getHistory().length).toBe(2); // 内存截断
      expect(store.appended.length).toBe(4); // 全部写穿透
    });
  });
});
