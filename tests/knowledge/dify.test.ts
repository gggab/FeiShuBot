import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildChatMessagesUrl, parseDifyAnswer, DifyClient } from '../../src/knowledge/dify';

describe('buildChatMessagesUrl', () => {
  it('拼出 chat-messages 端点并去尾斜杠', () => {
    expect(buildChatMessagesUrl('http://172.20.14.199/v1')).toBe('http://172.20.14.199/v1/chat-messages');
    expect(buildChatMessagesUrl('http://x/v1/')).toBe('http://x/v1/chat-messages');
  });
});

describe('parseDifyAnswer', () => {
  it('解析答案、会话 id 与去重引用', () => {
    const r = parseDifyAnswer({
      answer: '部署见文档',
      conversation_id: 'c1',
      message_id: 'm1',
      metadata: {
        retriever_resources: [
          { document_name: '部署手册.md' },
          { document_name: '部署手册.md' },
          { document_name: '配置说明.md' },
        ],
      },
    });
    expect(r.answer).toBe('部署见文档');
    expect(r.conversationId).toBe('c1');
    expect(r.citations).toEqual(['部署手册.md', '配置说明.md']);
  });

  it('缺字段时回退为空', () => {
    const r = parseDifyAnswer({});
    expect(r).toEqual({ answer: '', conversationId: '', messageId: '', citations: [] });
  });

  it('剥离 <think> 推理块，仅保留真实答案', () => {
    const r = parseDifyAnswer({ answer: '<think>\n内部推理\n</think>真正的答案' });
    expect(r.answer).toBe('真正的答案');
  });
});

describe('DifyClient.chat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('成功 → 解析答案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ answer: 'hi', conversation_id: 'c', message_id: 'm', metadata: {} }),
      }))
    );
    const client = new DifyClient('http://x/v1', 'app-key');
    const ans = await client.chat('问题', 'ou_1');
    expect(ans.answer).toBe('hi');
    expect(ans.conversationId).toBe('c');
  });

  it('HTTP 非 2xx → 抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }))
    );
    const client = new DifyClient('http://x/v1', 'app-key');
    await expect(client.chat('q', 'ou_1')).rejects.toThrow('HTTP 401');
  });
});
