import { describe, it, expect } from 'vitest';
import { parseIntentResult, IntentParseError } from '../../src/intent/recognizer';

describe('parseIntentResult', () => {
  const aliases = ['feishubot', 'order'];

  it('解析标准 JSON', () => {
    const raw = '{"intent":"bug_fix","confidence":0.9,"project":"order","task":"修复下单报错","reason":"含报错"}';
    const r = parseIntentResult(raw, '下单报错', aliases);
    expect(r).toEqual({
      intent: 'bug_fix',
      confidence: 0.9,
      project: 'order',
      task: '修复下单报错',
      reason: '含报错',
    });
  });

  it('容忍 ```json 代码块包裹', () => {
    const raw = '```json\n{"intent":"chat","confidence":0.8,"task":"打招呼"}\n```';
    const r = parseIntentResult(raw, '你好', aliases);
    expect(r.intent).toBe('chat');
    expect(r.task).toBe('打招呼');
  });

  it('未知 project 别名被丢弃', () => {
    const raw = '{"intent":"code_understanding","confidence":0.7,"project":"unknown","task":"看下登录流程"}';
    const r = parseIntentResult(raw, '登录怎么实现', aliases);
    expect(r.project).toBeUndefined();
  });

  it('confidence 非法 → 0，越界 → 裁剪', () => {
    expect(parseIntentResult('{"intent":"chat","confidence":"x","task":"a"}', 'a', aliases).confidence).toBe(0);
    expect(parseIntentResult('{"intent":"chat","confidence":5,"task":"a"}', 'a', aliases).confidence).toBe(1);
  });

  it('task 缺失 → 回退为原始文本', () => {
    const r = parseIntentResult('{"intent":"chat","confidence":0.6}', '原始问题', aliases);
    expect(r.task).toBe('原始问题');
  });

  it('intent 非法 → 抛 IntentParseError', () => {
    expect(() => parseIntentResult('{"intent":"other","confidence":0.9,"task":"a"}', 'a', aliases)).toThrow(
      IntentParseError
    );
  });

  it('非 JSON → 抛 IntentParseError', () => {
    expect(() => parseIntentResult('完全不是 json', 'a', aliases)).toThrow(IntentParseError);
  });
});
