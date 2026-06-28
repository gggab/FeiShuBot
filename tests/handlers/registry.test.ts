import { describe, it, expect } from 'vitest';
import { HandlerRegistry } from '../../src/handlers/registry';
import { Handler, HandlerContext } from '../../src/handlers/types';
import { IntentKind } from '../../src/intent/types';

function stub(intent: IntentKind): Handler {
  return {
    intent,
    async handle(_ctx: HandlerContext) {
      /* noop */
    },
  };
}

describe('HandlerRegistry', () => {
  it('按 intent 取到对应 handler', () => {
    const chat = stub('chat');
    const bug = stub('bug_fix');
    const registry = new HandlerRegistry([chat, bug]);
    expect(registry.get('chat')).toBe(chat);
    expect(registry.get('bug_fix')).toBe(bug);
  });

  it('未注册的 intent → 抛错', () => {
    const registry = new HandlerRegistry([stub('chat')]);
    expect(() => registry.get('knowledge_qa')).toThrow();
  });
});
