import { describe, it, expect } from 'vitest';
import { buildMarkdownCard, formatElapsed } from '../../src/feishu/card';

describe('buildMarkdownCard', () => {
  it('默认 done：绿色头部、关闭流式', () => {
    const card = buildMarkdownCard('hello');
    expect(card.schema).toBe('2.0');
    expect(card.config.update_multi).toBe(true);
    expect(card.config.streaming_mode).toBe(false);
    expect(card.header).toMatchObject({ template: 'green' });
    expect(card.header.title.content).toContain('已完成');
    expect(card.body.elements[0]).toMatchObject({ tag: 'markdown', content: 'hello' });
  });

  it('processing：蓝色头部、开启流式，并显示已用时长副标题', () => {
    const card = buildMarkdownCard('working', 'processing', 12000);
    expect(card.config.streaming_mode).toBe(true);
    expect(card.header.template).toBe('blue');
    expect(card.header.title.content).toContain('处理中');
    expect(card.header.subtitle?.content).toBe('已用时 12s');
  });

  it('processing 未传 elapsedMs 时不带副标题', () => {
    const card = buildMarkdownCard('working', 'processing');
    expect(card.header.subtitle).toBeUndefined();
  });

  it('error：红色头部、关闭流式', () => {
    const card = buildMarkdownCard('boom', 'error');
    expect(card.config.streaming_mode).toBe(false);
    expect(card.header.template).toBe('red');
    expect(card.header.title.content).toContain('失败');
  });
});

describe('formatElapsed', () => {
  it('不足一分钟显示秒', () => {
    expect(formatElapsed(0)).toBe('已用时 0s');
    expect(formatElapsed(1500)).toBe('已用时 1s');
    expect(formatElapsed(59000)).toBe('已用时 59s');
  });

  it('超过一分钟显示分秒', () => {
    expect(formatElapsed(65000)).toBe('已用时 1m5s');
    expect(formatElapsed(125000)).toBe('已用时 2m5s');
  });

  it('负数收敛为 0s', () => {
    expect(formatElapsed(-100)).toBe('已用时 0s');
  });
});
