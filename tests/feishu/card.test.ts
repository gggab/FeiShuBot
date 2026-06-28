import { describe, it, expect } from 'vitest';
import { buildMarkdownCard } from '../../src/feishu/card';

describe('buildMarkdownCard', () => {
  it('生成 schema 2.0 流式 markdown 卡片', () => {
    const card = buildMarkdownCard('hello');
    expect(card.schema).toBe('2.0');
    expect(card.config.update_multi).toBe(true);
    expect(card.config.streaming_mode).toBe(true);
    expect(card.body.elements[0]).toMatchObject({ tag: 'markdown', content: 'hello' });
  });

  it('streaming=false 时关闭流式模式', () => {
    const card = buildMarkdownCard('done', false);
    expect(card.config.streaming_mode).toBe(false);
  });
});
