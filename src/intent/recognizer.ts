/**
 * 意图识别器：调 LLM 把消息分类为 IntentResult，并应用置信度阈值与失败兜底。
 * Intent recognizer. 设计对齐 docs/intent-recognition.md §3/§5/§6。
 *
 * 兜底策略（显式，不隐藏错误）：
 * - LLM 调用异常 → 抛 IntentServiceError（上层提示“服务暂不可用”，不静默当成 chat）。
 * - 返回非法 JSON / intent 非法 → 重试一次；仍失败 → 降级为 chat（degraded）。
 * - 置信度低于阈值且非 chat → 降级为 chat（degraded）。
 */

import { IntentResult, IntentKind } from './types';
import { ChatTurn } from '../session/context';
import { LlmClient } from '../llm/client';
import { buildIntentSystemPrompt, buildIntentUserPrompt } from './prompt';
import { logger } from '../util/logger';

const INTENT_KINDS: IntentKind[] = ['code_understanding', 'bug_fix', 'knowledge_qa', 'chat'];

export class IntentServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IntentServiceError';
  }
}

export class IntentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntentParseError';
  }
}

export interface RecognizeInput {
  text: string;
  projectAliases: string[];
  history?: ChatTurn[];
}

export interface RecognizeResult {
  intent: IntentResult;
  /** 是否因低置信度/解析失败被强制降级为 chat。 */
  degraded: boolean;
  degradeReason?: 'low_confidence' | 'parse_failed';
}

/**
 * 从 LLM 原始输出解析出 IntentResult（纯函数，便于测试）。失败抛 IntentParseError。
 */
export function parseIntentResult(raw: string, text: string, projectAliases: string[]): IntentResult {
  const json = extractJsonObject(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new IntentParseError(`JSON 解析失败: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new IntentParseError('输出不是 JSON 对象');
  }

  const obj = parsed as Record<string, unknown>;
  const intent = obj.intent;
  if (typeof intent !== 'string' || !INTENT_KINDS.includes(intent as IntentKind)) {
    throw new IntentParseError(`intent 非法: ${String(intent)}`);
  }

  let confidence = Number(obj.confidence);
  if (Number.isNaN(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const project =
    typeof obj.project === 'string' && projectAliases.includes(obj.project) ? obj.project : undefined;

  const task =
    typeof obj.task === 'string' && obj.task.trim() !== '' ? obj.task.trim() : text;

  const reason = typeof obj.reason === 'string' ? obj.reason : undefined;

  return { intent: intent as IntentKind, confidence, project, task, reason };
}

/** 从可能包含代码块/多余文字的输出中提取 JSON 对象字符串。 */
function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new IntentParseError('未找到 JSON 对象');
  }
  return body.slice(start, end + 1);
}

export class IntentRecognizer {
  private readonly model: string | undefined;
  private readonly minConfidence: number;

  constructor(
    private readonly llm: LlmClient,
    opts: { model?: string; minConfidence: number }
  ) {
    this.model = opts.model && opts.model.length > 0 ? opts.model : undefined;
    this.minConfidence = opts.minConfidence;
  }

  async recognize(input: RecognizeInput): Promise<RecognizeResult> {
    const messages = [
      { role: 'system' as const, content: buildIntentSystemPrompt(input.projectAliases) },
      { role: 'user' as const, content: buildIntentUserPrompt(input.text, input.history) },
    ];

    let lastParseError: IntentParseError | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: string;
      try {
        raw = await this.llm.chat(messages, { model: this.model, temperature: 0 });
      } catch (e) {
        throw new IntentServiceError('意图识别调用失败', { cause: e });
      }
      logger.debug(`[意图] LLM 原始输出(第${attempt + 1}次): ${raw}`);

      try {
        const result = parseIntentResult(raw, input.text, input.projectAliases);
        if (result.confidence < this.minConfidence && result.intent !== 'chat') {
          return {
            intent: { ...result, intent: 'chat' },
            degraded: true,
            degradeReason: 'low_confidence',
          };
        }
        return { intent: result, degraded: false };
      } catch (e) {
        if (e instanceof IntentParseError) {
          lastParseError = e;
          continue;
        }
        throw e;
      }
    }

    logger.warn(`意图识别解析失败，降级为 chat: ${lastParseError?.message ?? 'unknown'}`);
    return {
      intent: { intent: 'chat', confidence: 0, task: input.text, reason: '解析失败降级' },
      degraded: true,
      degradeReason: 'parse_failed',
    };
  }
}
