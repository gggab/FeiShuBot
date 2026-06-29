/**
 * Dify 知识库客户端：调本地 Dify 的 chat-messages API（chatflow/advanced-chat 应用）。
 * 设计对齐 docs/handlers.md §4。
 */

export interface DifyAnswer {
  answer: string;
  conversationId: string;
  messageId: string;
  /** 检索到的参考文档名（去重）。 */
  citations: string[];
}

export function buildChatMessagesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat-messages`;
}

/** 去掉部分推理模型泄漏到答案里的 <think>…</think> 块。 */
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** 从 Dify blocking 响应解析出答案与引用（纯函数，便于测试）。 */
export function parseDifyAnswer(data: unknown): DifyAnswer {
  const d = (data ?? {}) as {
    answer?: unknown;
    conversation_id?: unknown;
    message_id?: unknown;
    metadata?: { retriever_resources?: Array<{ document_name?: unknown }> };
  };
  const resources = Array.isArray(d.metadata?.retriever_resources) ? d.metadata!.retriever_resources! : [];
  const names = resources
    .map((r) => r?.document_name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  return {
    answer: typeof d.answer === 'string' ? stripThink(d.answer) : '',
    conversationId: typeof d.conversation_id === 'string' ? d.conversation_id : '',
    messageId: typeof d.message_id === 'string' ? d.message_id : '',
    citations: [...new Set(names)],
  };
}

export class DifyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async chat(query: string, user: string, conversationId?: string): Promise<DifyAnswer> {
    const res = await fetch(buildChatMessagesUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {},
        query,
        response_mode: 'blocking',
        user,
        conversation_id: conversationId || undefined,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dify 请求失败 HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    return parseDifyAnswer(await res.json());
  }
}
