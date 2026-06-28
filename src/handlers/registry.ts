/**
 * Handler 注册表：按 intent 分发到对应 Handler。
 * Handler registry routing by intent. 设计对齐 docs/handlers.md §1。
 */

import { Handler } from './types';
import { IntentKind } from '../intent/types';

export class HandlerRegistry {
  private readonly handlers = new Map<IntentKind, Handler>();

  constructor(handlers: Handler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.intent, handler);
    }
  }

  get(intent: IntentKind): Handler {
    const handler = this.handlers.get(intent);
    if (!handler) {
      // 枚举封闭，理论上不会发生；显式抛错而非静默兜底。
      throw new Error(`未注册的 intent handler: ${intent}`);
    }
    return handler;
  }
}
