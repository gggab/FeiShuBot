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

/** 把 fetch 抛出的底层网络错误翻译成可读原因（undici 的真实原因在 err.cause）。 */
export function describeFetchError(e: unknown): string {
  const err = e as { cause?: { code?: string; message?: string }; message?: string };
  const code = err?.cause?.code;
  const reasons: Record<string, string> = {
    UND_ERR_CONNECT_TIMEOUT: '连接超时',
    ETIMEDOUT: '连接超时',
    ECONNREFUSED: '连接被拒绝（服务未在该端口监听？）',
    ECONNRESET: '连接被重置',
    ENOTFOUND: '域名解析失败',
    EAI_AGAIN: 'DNS 暂时不可用',
    EHOSTUNREACH: '主机不可达',
    ENETUNREACH: '网络不可达',
  };
  if (code) return `${reasons[code] ?? '网络错误'}（${code}），请检查 DIFY_BASE_URL 与网络可达性`;
  return err?.cause?.message || err?.message || String(e);
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

  async chat(query: string, user: string, conversationId?: string, signal?: AbortSignal): Promise<DifyAnswer> {
    const url = buildChatMessagesUrl(this.baseUrl);
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
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
        signal,
      });
    } catch (e) {
      // 用户主动停止：原样抛出，交由上层按「已停止」处理，不当作连接错误。
      if (signal?.aborted) throw e;
      throw new Error(`连接 Dify 失败（${url}）：${describeFetchError(e)}`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dify 请求失败 HTTP ${res.status}（${url}）: ${text.slice(0, 500)}`);
    }

    return parseDifyAnswer(await res.json());
  }
}
