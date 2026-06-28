import { describe, it, expect } from 'vitest';
import { IntentRecognizer, IntentServiceError } from '../../src/intent/recognizer';
import { LlmClient } from '../../src/llm/client';

/** 每次 chat 调用按队列返回预设字符串。 */
function scriptedLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    async chat() {
      return responses[Math.min(i++, responses.length - 1)];
    },
    async *chatStream() {
      /* not used */
    },
  };
}

function throwingLlm(): LlmClient {
  return {
    async chat() {
      throw new Error('network down');
    },
    async *chatStream() {
      /* not used */
    },
  };
}

const input = { text: '你好', projectAliases: [] as string[] };

describe('IntentRecognizer', () => {
  it('高置信度按原意图返回，不降级', async () => {
    const llm = scriptedLlm(['{"intent":"code_understanding","confidence":0.9,"task":"看登录流程"}']);
    const r = new IntentRecognizer(llm, { minConfidence: 0.5 });
    const out = await r.recognize({ ...input, text: '登录怎么实现' });
    expect(out.degraded).toBe(false);
    expect(out.intent.intent).toBe('code_understanding');
  });

  it('低置信度非 chat → 降级为 chat', async () => {
    const llm = scriptedLlm(['{"intent":"bug_fix","confidence":0.2,"task":"也许有bug"}']);
    const r = new IntentRecognizer(llm, { minConfidence: 0.5 });
    const out = await r.recognize(input);
    expect(out.degraded).toBe(true);
    expect(out.degradeReason).toBe('low_confidence');
    expect(out.intent.intent).toBe('chat');
  });

  it('连续两次非法 JSON → 降级为 chat (parse_failed)', async () => {
    const llm = scriptedLlm(['garbage', 'still garbage']);
    const r = new IntentRecognizer(llm, { minConfidence: 0.5 });
    const out = await r.recognize(input);
    expect(out.degraded).toBe(true);
    expect(out.degradeReason).toBe('parse_failed');
    expect(out.intent.intent).toBe('chat');
  });

  it('第一次非法、第二次合法 → 重试成功', async () => {
    const llm = scriptedLlm(['garbage', '{"intent":"chat","confidence":0.9,"task":"闲聊"}']);
    const r = new IntentRecognizer(llm, { minConfidence: 0.5 });
    const out = await r.recognize(input);
    expect(out.degraded).toBe(false);
    expect(out.intent.intent).toBe('chat');
  });

  it('LLM 调用异常 → 抛 IntentServiceError', async () => {
    const r = new IntentRecognizer(throwingLlm(), { minConfidence: 0.5 });
    await expect(r.recognize(input)).rejects.toBeInstanceOf(IntentServiceError);
  });
});
