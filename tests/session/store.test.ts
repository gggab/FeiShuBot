import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteSessionStore } from '../../src/session/store';
import { SessionContext } from '../../src/session/context';

const tmpDirs: string[] = [];

/** 每个测试用独立临时文件库，结束后清理。 */
function newDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feishubot-session-'));
  tmpDirs.push(dir);
  return join(dir, 'session.db');
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SqliteSessionStore', () => {
  it('append + load 往返，按时间正序返回 role/content', () => {
    const store = new SqliteSessionStore(newDbFile(), { maxMessages: 100, retentionDays: 365 });
    store.append('c1', { role: 'user', content: 'u1', senderId: 'ou_a' });
    store.append('c1', { role: 'assistant', content: 'a1' });
    store.append('c1', { role: 'user', content: 'u2', senderId: 'ou_b' });

    expect(store.load('c1', 100)).toEqual([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ]);
    store.close();
  });

  it('load 的 limit 只取最近 N 条', () => {
    const store = new SqliteSessionStore(newDbFile(), { maxMessages: 100, retentionDays: 365 });
    for (let i = 1; i <= 5; i++) store.append('c1', { role: 'user', content: `m${i}` });
    expect(store.load('c1', 2)).toEqual([
      { role: 'user', content: 'm4' },
      { role: 'user', content: 'm5' },
    ]);
    store.close();
  });

  it('按 chatId 隔离', () => {
    const store = new SqliteSessionStore(newDbFile(), { maxMessages: 100, retentionDays: 365 });
    store.append('c1', { role: 'user', content: 'in c1' });
    store.append('c2', { role: 'user', content: 'in c2' });
    expect(store.load('c1', 100)).toEqual([{ role: 'user', content: 'in c1' }]);
    expect(store.load('c2', 100)).toEqual([{ role: 'user', content: 'in c2' }]);
    store.close();
  });

  it('存储 sender_id（含 assistant 行为 NULL）', () => {
    const dbFile = newDbFile();
    const store = new SqliteSessionStore(dbFile, { maxMessages: 100, retentionDays: 365 });
    store.append('c1', { role: 'user', content: 'q', senderId: 'ou_alice' });
    store.append('c1', { role: 'assistant', content: 'a' });
    store.close();

    const db = new Database(dbFile, { readonly: true });
    const rows = db.prepare('SELECT sender_id, role FROM session_messages ORDER BY id').all() as Array<{
      sender_id: string | null;
      role: string;
    }>;
    db.close();
    expect(rows).toEqual([
      { sender_id: 'ou_alice', role: 'user' },
      { sender_id: null, role: 'assistant' },
    ]);
  });

  it('clear 删除该会话全部消息', () => {
    const store = new SqliteSessionStore(newDbFile(), { maxMessages: 100, retentionDays: 365 });
    store.append('c1', { role: 'user', content: 'x' });
    store.append('c2', { role: 'user', content: 'y' });
    store.clear('c1');
    expect(store.load('c1', 100)).toEqual([]);
    expect(store.load('c2', 100)).toEqual([{ role: 'user', content: 'y' }]);
    store.close();
  });

  it('每会话硬上限：超出 maxMessages 裁掉最旧', () => {
    const dbFile = newDbFile();
    const store = new SqliteSessionStore(dbFile, { maxMessages: 3, retentionDays: 365 });
    for (let i = 1; i <= 5; i++) store.append('c1', { role: 'user', content: `m${i}` });

    // 仅保留最近 3 条。
    expect(store.load('c1', 100)).toEqual([
      { role: 'user', content: 'm3' },
      { role: 'user', content: 'm4' },
      { role: 'user', content: 'm5' },
    ]);
    const db = new Database(dbFile, { readonly: true });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM session_messages').get() as { n: number }).n;
    db.close();
    expect(count).toBe(3);
    store.close();
  });

  it('sweepExpired 删除超过保留天数的消息，保留未过期的', () => {
    const dbFile = newDbFile();
    const store = new SqliteSessionStore(dbFile, { maxMessages: 100, retentionDays: 30 });

    // 直接写入一条 40 天前的旧消息（绕过 append 的 now 时间戳）。
    const old = Date.now() - 40 * 86_400_000;
    const seed = new Database(dbFile);
    seed
      .prepare('INSERT INTO session_messages (chat_id, sender_id, role, content, created_at) VALUES (?,?,?,?,?)')
      .run('c1', null, 'user', 'stale', old);
    seed.close();

    store.append('c1', { role: 'user', content: 'fresh' });
    const removed = store.sweepExpired();

    expect(removed).toBe(1);
    expect(store.load('c1', 100)).toEqual([{ role: 'user', content: 'fresh' }]);
    store.close();
  });

  it('retentionDays<=0 时 sweepExpired 不删除', () => {
    const dbFile = newDbFile();
    const store = new SqliteSessionStore(dbFile, { maxMessages: 100, retentionDays: 0 });
    const old = Date.now() - 1000 * 86_400_000;
    const seed = new Database(dbFile);
    seed
      .prepare('INSERT INTO session_messages (chat_id, sender_id, role, content, created_at) VALUES (?,?,?,?,?)')
      .run('c1', null, 'user', 'ancient', old);
    seed.close();

    expect(store.sweepExpired()).toBe(0);
    expect(store.load('c1', 100)).toEqual([{ role: 'user', content: 'ancient' }]);
    store.close();
  });

  it('跨实例（模拟重启）从同一文件恢复历史', () => {
    const dbFile = newDbFile();
    const first = new SqliteSessionStore(dbFile, { maxMessages: 100, retentionDays: 365 });
    first.append('c1', { role: 'user', content: 'before restart', senderId: 'ou_a' });
    first.close();

    // 新实例（新连接）打开同一文件。
    const second = new SqliteSessionStore(dbFile, { maxMessages: 100, retentionDays: 365 });
    expect(second.load('c1', 100)).toEqual([{ role: 'user', content: 'before restart' }]);
    second.close();
  });

  it('与 SessionContext 集成：重启后回灌最近 N 轮', () => {
    const dbFile = newDbFile();
    const store1 = new SqliteSessionStore(dbFile, { maxMessages: 100, retentionDays: 365 });
    const s1 = new SessionContext('c1', 10, store1);
    s1.addUser('你好', 'ou_a');
    s1.addAssistant('你好，我是 Sahib');
    store1.close();

    const store2 = new SqliteSessionStore(dbFile, { maxMessages: 100, retentionDays: 365 });
    const s2 = new SessionContext('c1', 10, store2);
    expect(s2.getHistory()).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，我是 Sahib' },
    ]);
    store2.close();
  });
});
