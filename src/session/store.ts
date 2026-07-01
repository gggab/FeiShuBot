/**
 * SQLite 会话存储：写穿透持久化 + 回灌。设计对齐 docs/session-persistence.md。
 * SQLite-backed SessionStore. Synchronous (better-sqlite3) so the session API
 * stays sync end-to-end (no async refactor of controller/handlers).
 */

import Database from 'better-sqlite3';
import type { ChatTurn, SessionStore, StoredTurn } from './context';
import { logger } from '../util/logger';

export interface SqliteStoreOptions {
  /** 每会话归档消息硬上限（超出裁掉最旧）；<=0 表示不限。 */
  maxMessages: number;
  /** 超期清理天数；<=0 表示不按时间清理。 */
  retentionDays: number;
}

interface Row {
  role: 'user' | 'assistant';
  content: string;
}

const DAY_MS = 86_400_000;

export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;
  private readonly stmtInsert: Database.Statement;
  private readonly stmtLoad: Database.Statement;
  private readonly stmtClear: Database.Statement;
  private readonly stmtPrune: Database.Statement;
  private readonly stmtSweep: Database.Statement;

  constructor(
    dbFile: string,
    private readonly options: SqliteStoreOptions
  ) {
    // 打开失败（路径不可写等）直接抛错，不静默回退内存（No hidden errors）。
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id    TEXT    NOT NULL,
        sender_id  TEXT,
        role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
        content    TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_chat ON session_messages(chat_id, id);
    `);

    this.stmtInsert = this.db.prepare(
      `INSERT INTO session_messages (chat_id, sender_id, role, content, created_at)
       VALUES (@chatId, @senderId, @role, @content, @createdAt)`
    );
    this.stmtLoad = this.db.prepare(
      `SELECT role, content FROM session_messages
       WHERE chat_id = ? ORDER BY id DESC LIMIT ?`
    );
    this.stmtClear = this.db.prepare(`DELETE FROM session_messages WHERE chat_id = ?`);
    this.stmtPrune = this.db.prepare(
      `DELETE FROM session_messages
       WHERE chat_id = @chatId
         AND id NOT IN (
           SELECT id FROM session_messages WHERE chat_id = @chatId ORDER BY id DESC LIMIT @keep
         )`
    );
    this.stmtSweep = this.db.prepare(`DELETE FROM session_messages WHERE created_at < ?`);

    // 启动时清一次过期数据。
    this.sweepExpired();
  }

  load(chatId: string, limit: number): ChatTurn[] {
    const rows = this.stmtLoad.all(chatId, limit) as Row[];
    // DESC 取回后反转为时间正序。
    return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  append(chatId: string, turn: StoredTurn): void {
    this.stmtInsert.run({
      chatId,
      senderId: turn.senderId ?? null,
      role: turn.role,
      content: turn.content,
      createdAt: Date.now(),
    });
    if (this.options.maxMessages > 0) {
      this.stmtPrune.run({ chatId, keep: this.options.maxMessages });
    }
  }

  clear(chatId: string): void {
    this.stmtClear.run(chatId);
  }

  /** 删除超过保留天数的消息；retentionDays<=0 时不操作。返回删除条数。 */
  sweepExpired(): number {
    if (this.options.retentionDays <= 0) return 0;
    const cutoff = Date.now() - this.options.retentionDays * DAY_MS;
    const info = this.stmtSweep.run(cutoff);
    if (info.changes > 0) {
      logger.info(`[session] 清理过期消息 ${info.changes} 条（保留 ${this.options.retentionDays} 天）`);
    }
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}
