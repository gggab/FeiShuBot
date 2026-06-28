/**
 * 按配置创建大模型客户端。
 * Create the LLM client from config (OpenAI-compatible: deepseek/qwen/glm).
 *
 * 缺少必填配置时**显式抛错**；以工厂函数提供，避免模块加载副作用（便于测试）。
 */

import OpenAI from 'openai';
import { assertRequired, config } from '../config';
import { LlmClient, OpenAiClient } from './client';

export function createLlmClient(): LlmClient {
  assertRequired([
    ['LLM_BASE_URL', config.llm.baseUrl],
    ['LLM_API_KEY', config.llm.apiKey],
    ['LLM_MODEL', config.llm.model],
  ]);
  const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
  return new OpenAiClient(client, config.llm.model);
}
