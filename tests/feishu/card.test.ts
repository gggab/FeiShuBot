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

  it('stopped：灰色头部、关闭流式', () => {
    const card = buildMarkdownCard('half', 'stopped');
    expect(card.config.streaming_mode).toBe(false);
    expect(card.header.template).toBe('grey');
    expect(card.header.title.content).toContain('已停止');
  });

  it('processing 且带 taskId 时追加停止按钮，value 携带 taskId', () => {
    const card = buildMarkdownCard('working', 'processing', 0, 'task-1');
    const btn = card.body.elements.find((e: any) => e.tag === 'button') as any;
    expect(btn).toBeDefined();
    expect(btn.type).toBe('danger');
    expect(btn.behaviors[0]).toMatchObject({
      type: 'callback',
      value: { action: 'stop', taskId: 'task-1' },
    });
  });

  it('processing 无 taskId 时不渲染按钮', () => {
    const card = buildMarkdownCard('working', 'processing', 0);
    expect(card.body.elements.some((e: any) => e.tag === 'button')).toBe(false);
  });

  it('终态（done/stopped）即使传 taskId 也不渲染按钮', () => {
    for (const status of ['done', 'stopped', 'error'] as const) {
      const card = buildMarkdownCard('x', status, undefined, 'task-1');
      expect(card.body.elements.some((e: any) => e.tag === 'button')).toBe(false);
    }
  });

  it('lang=en：状态标题、已用时与停止按钮用英文', () => {
    const card = buildMarkdownCard('working', 'processing', 12000, 'task-1', 'en');
    expect(card.header.title.content).toBe('⏳ Processing…');
    expect(card.header.subtitle?.content).toBe('elapsed 12s');
    const btn = card.body.elements.find((e: any) => e.tag === 'button') as any;
    expect(btn.text.content).toBe('⏹ Stop');

    expect(buildMarkdownCard('x', 'done', undefined, undefined, 'en').header.title.content).toBe('✅ Done');
    expect(buildMarkdownCard('x', 'error', undefined, undefined, 'en').header.title.content).toBe('❌ Failed');
    expect(buildMarkdownCard('x', 'stopped', undefined, undefined, 'en').header.title.content).toBe('⏹ Stopped');
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
