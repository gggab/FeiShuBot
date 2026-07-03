import { describe, it, expect } from 'vitest';
import { ChatHandler } from '../../src/handlers/chat';
import { SessionContext } from '../../src/session/context';
import { HandlerContext, ReplyStream } from '../../src/handlers/types';
import { LlmClient, ChatMessage } from '../../src/llm/client';
import { Identity } from '../../src/config/identity';

const IDENTITY: Identity = { name: 'Sahib', description: '是一个飞书智能助手。' };

class FakeReply implements ReplyStream {
  pushed: string[] = [];
  finalText: string | undefined;
  failed: string | undefined;
  push(textChunk: string): void {
    this.pushed.push(textChunk);
  }
  async done(finalText?: string): Promise<void> {
    this.finalText = finalText;
  }
  async fail(message: string): Promise<void> {
    this.failed = message;
  }
}

function streamingLlm(chunks: string[], captured?: ChatMessage[][]): LlmClient {
  return {
    async chat() {
      return chunks.join('');
    },
    async *chatStream(messages: ChatMessage[]) {
      captured?.push(messages);
      for (const c of chunks) yield c;
    },
  };
}

function makeCtx(reply: ReplyStream, session: SessionContext, text: string): HandlerContext {
  return {
    userId: 'u',
    chatId: 'c',
    intent: { intent: 'chat', confidence: 1, task: text },
    session,
    reply,
  };
}

describe('ChatHandler', () => {
  it('流式 push 增量，并把完整回复写入会话', async () => {
    const reply = new FakeReply();
    const session = new SessionContext('u', 5);
    const handler = new ChatHandler(streamingLlm(['你', '好', '！']), IDENTITY);

    await handler.handle(makeCtx(reply, session, '在吗'));

    expect(reply.pushed).toEqual(['你', '好', '！']);
    expect(reply.finalText).toBe('你好！');
    const h = session.getHistory();
    expect(h[0]).toEqual({ role: 'user', content: '在吗' });
    expect(h[1]).toEqual({ role: 'assistant', content: '你好！' });
  });

  it('系统提示词来自 IDENTITY 身份（含名字与描述）', async () => {
    const reply = new FakeReply();
    const session = new SessionContext('u', 5);
    const captured: ChatMessage[][] = [];
    const handler = new ChatHandler(streamingLlm(['hi'], captured), IDENTITY);

    await handler.handle(makeCtx(reply, session, '你叫什么'));

    const system = captured[0][0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('Sahib');
    expect(system.content).toContain('是一个飞书智能助手。');
  });

  it('LLM 出错时调用 reply.fail，且不写入 assistant 历史', async () => {
    const reply = new FakeReply();
    const session = new SessionContext('u', 5);
    const failing: LlmClient = {
      async chat() {
        throw new Error('boom');
      },
      // eslint-disable-next-line require-yield
      async *chatStream(): AsyncIterable<string> {
        throw new Error('boom');
      },
    };
    const handler = new ChatHandler(failing, IDENTITY);

    await handler.handle(makeCtx(reply, session, 'hi'));

    expect(reply.failed).toContain('boom');
    expect(reply.finalText).toBeUndefined();
    expect(session.getHistory()).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
