/**
 * 大模型客户端：OpenAI 兼容接口（DeepSeek / Qwen / GLM）。
 * LLM client over the OpenAI-compatible Chat Completions API.
 * 设计对齐 docs/architecture.md (llm/)。
 *
 * 接口与实现分离，便于在 handler 测试中注入 mock（不触网）。
 */

import type OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** 覆盖默认模型（如意图识别用更快的模型） / Override model. */
  model?: string;
  temperature?: number;
}

export interface LlmClient {
  /** 一次性返回完整回复 / Non-streaming completion. */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  /** 流式返回内容增量 / Streaming content deltas. */
  chatStream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
}

export class OpenAiClient implements LlmClient {
  constructor(
    private readonly client: OpenAI,
    private readonly defaultModel: string
  ) {}

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: opts?.model ?? this.defaultModel,
      messages,
      temperature: opts?.temperature,
      stream: false,
    });
    return res.choices[0]?.message?.content ?? '';
  }

  async *chatStream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: opts?.model ?? this.defaultModel,
      messages,
      temperature: opts?.temperature,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
