/**
 * 会话上下文：按 chatId 维护近 maxTurns 轮对话（user+assistant 为一轮）。
 * Per-chat conversation context, bounded to the most recent maxTurns turns.
 * 可选注入 SessionStore 做写穿透持久化 + 回灌。设计对齐 docs/session-persistence.md。
 */

import { config } from '../config';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 入库时携带发言人元数据；senderId 不进内存、不参与 getHistory()。 */
export interface StoredTurn extends ChatTurn {
  senderId?: string;
}

/**
 * 会话持久化存储抽象（同步，便于保持会话 API 全链路同步）。
 * Persistence backend for session history (synchronous by design).
 */
export interface SessionStore {
  /** 回灌某会话最近 limit 条（时间正序，仅 role/content）。 */
  load(chatId: string, limit: number): ChatTurn[];
  /** 追加一条（写穿透）。 */
  append(chatId: string, turn: StoredTurn): void;
  /** 清空某会话。 */
  clear(chatId: string): void;
}

export class SessionContext {
  private messages: ChatTurn[] = [];

  constructor(
    public readonly chatId: string,
    private readonly maxTurns: number = config.service.sessionMaxTurns,
    private readonly store?: SessionStore
  ) {
    // 注入持久化时，构造即从库回灌最近 maxTurns 轮（已是 role/content）。
    if (this.store) {
      this.messages = this.store.load(this.chatId, this.maxTurns * 2);
    }
  }

  addUser(content: string, senderId?: string): void {
    this.append({ role: 'user', content }, senderId);
  }

  addAssistant(content: string): void {
    this.append({ role: 'assistant', content });
  }

  private append(turn: ChatTurn, senderId?: string): void {
    this.messages.push(turn);
    const maxMessages = this.maxTurns * 2;
    if (this.messages.length > maxMessages) {
      this.messages = this.messages.slice(this.messages.length - maxMessages);
    }
    this.store?.append(this.chatId, { ...turn, senderId });
  }

  /** 返回历史副本（不可被外部修改） / Copy of history. */
  getHistory(): ChatTurn[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.store?.clear(this.chatId);
  }
}

const sessions = new Map<string, SessionContext>();

let sharedStore: SessionStore | undefined;

/**
 * 注入持久化存储；传 undefined 关闭（纯内存）。
 * app.ts 启动时按 SESSION_PERSIST 调用。已缓存的会话不受影响（仅影响后续新建）。
 */
export function setSessionStore(store: SessionStore | undefined): void {
  sharedStore = store;
}

/** 取（或创建）某会话(chatId)的上下文（单例） / Get-or-create a chat's session. */
export function getSession(chatId: string): SessionContext {
  let session = sessions.get(chatId);
  if (!session) {
    session = new SessionContext(chatId, config.service.sessionMaxTurns, sharedStore);
    sessions.set(chatId, session);
  }
  return session;
}
