/**
 * 用户会话上下文。完整实现见 M2（docs/development-plan.md）。
 * Per-user conversation context. Full implementation in M2.
 *
 * 本文件在 M0 仅锁定对外类型，便于 handlers 等模块按契约编译。
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export class SessionContext {
  constructor(public readonly userId: string) {}

  // TODO(M2): 维护近 SESSION_MAX_TURNS 轮对话历史；提供 addTurn / getHistory / clear。
}
