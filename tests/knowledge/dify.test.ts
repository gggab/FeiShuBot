import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildChatMessagesUrl, parseDifyAnswer, DifyClient, describeFetchError } from '../../src/knowledge/dify';

/** 构造一个像 undici fetch 失败那样、真实原因在 cause 的错误。 */
function fetchFailed(code: string): Error {
  const e = new TypeError('fetch failed');
  (e as unknown as { cause: unknown }).cause = { code };
  return e;
}

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

  it('HTTP 非 2xx → 抛错（含端点 URL）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }))
    );
    const client = new DifyClient('http://x/v1', 'app-key');
    await expect(client.chat('q', 'ou_1')).rejects.toThrow('HTTP 401（http://x/v1/chat-messages）');
  });

  it('连接失败 → 包装成含 URL 与可读原因的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw fetchFailed('UND_ERR_CONNECT_TIMEOUT');
      })
    );
    const client = new DifyClient('http://172.20.14.199', 'app-key');
    await expect(client.chat('q', 'ou_1')).rejects.toThrow(
      '连接 Dify 失败（http://172.20.14.199/chat-messages）：连接超时（UND_ERR_CONNECT_TIMEOUT）'
    );
  });

  it('用户主动停止（signal aborted）→ 原样抛出，不包装为连接错误', async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      })
    );
    const client = new DifyClient('http://x/v1', 'app-key');
    await expect(client.chat('q', 'ou_1', undefined, ac.signal)).rejects.toThrow('aborted');
  });
});

describe('describeFetchError', () => {
  it('已知 code → 可读中文原因 + code', () => {
    expect(describeFetchError(fetchFailed('ECONNREFUSED'))).toContain('连接被拒绝');
    expect(describeFetchError(fetchFailed('ECONNREFUSED'))).toContain('ECONNREFUSED');
    expect(describeFetchError(fetchFailed('ENOTFOUND'))).toContain('域名解析失败');
  });

  it('未知 code → 网络错误 + code', () => {
    expect(describeFetchError(fetchFailed('EWTF'))).toContain('网络错误（EWTF）');
  });

  it('无 cause.code → 退回 message', () => {
    expect(describeFetchError(new Error('boom'))).toBe('boom');
  });
});
