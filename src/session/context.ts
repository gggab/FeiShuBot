/**
 * 用户会话上下文：维护近 maxTurns 轮对话（user+assistant 为一轮）。
 * Per-user conversation context, bounded to the most recent maxTurns turns.
 * 设计对齐 docs/architecture.md (session/)。
 */

import { config } from '../config';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export class SessionContext {
  private messages: ChatTurn[] = [];

  constructor(
    public readonly userId: string,
    private readonly maxTurns: number = config.service.sessionMaxTurns
  ) {}

  addUser(content: string): void {
    this.append({ role: 'user', content });
  }

  addAssistant(content: string): void {
    this.append({ role: 'assistant', content });
  }

  private append(turn: ChatTurn): void {
    this.messages.push(turn);
    const maxMessages = this.maxTurns * 2;
    if (this.messages.length > maxMessages) {
      this.messages = this.messages.slice(this.messages.length - maxMessages);
    }
  }

  /** 返回历史副本（不可被外部修改） / Copy of history. */
  getHistory(): ChatTurn[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}

const sessions = new Map<string, SessionContext>();

/** 取（或创建）某用户的会话上下文（单例） / Get-or-create a user's session. */
export function getSession(userId: string): SessionContext {
  let session = sessions.get(userId);
  if (!session) {
    session = new SessionContext(userId);
    sessions.set(userId, session);
  }
  return session;
}
