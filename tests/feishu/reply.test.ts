import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** 捕获发送/更新的卡片内容，避免真正走网络。 */
const created: unknown[] = [];
const patched: unknown[] = [];

vi.mock('../../src/feishu/client', () => ({
  larkClient: {
    im: {
      v1: {
        message: {
          create: vi.fn(async ({ data }: { data: { content: string } }) => {
            created.push(JSON.parse(data.content));
            return { code: 0, data: { message_id: 'm1' } };
          }),
          patch: vi.fn(async ({ data }: { data: { content: string } }) => {
            patched.push(JSON.parse(data.content));
            return { code: 0, data: {} };
          }),
        },
      },
    },
  },
}));

import { CardReplyStream } from '../../src/feishu/reply';

describe('CardReplyStream 处理状态可视化', () => {
  beforeEach(() => {
    created.length = 0;
    patched.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('init 发送处理中占位卡片（蓝色头部 + 流式）', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    expect(created).toHaveLength(1);
    const card = created[0] as any;
    expect(card.header.template).toBe('blue');
    expect(card.config.streaming_mode).toBe(true);
  });

  it('done 后终态为绿色「已完成」且关闭流式', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    await s.done('结果');
    const last = patched[patched.length - 1] as any;
    expect(last.header.template).toBe('green');
    expect(last.config.streaming_mode).toBe(false);
    expect(last.body.elements[0].content).toBe('结果');
  });

  it('fail 后终态为红色「处理失败」', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    await s.fail('炸了');
    const last = patched[patched.length - 1] as any;
    expect(last.header.template).toBe('red');
    expect(last.config.streaming_mode).toBe(false);
    expect(last.body.elements[0].content).toBe('炸了');
  });

  it('长时间静默时心跳持续刷新已用时长', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    // 无任何 push，仅靠心跳推进
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(patched.length).toBeGreaterThanOrEqual(2);
    const beat = patched[0] as any;
    expect(beat.header.template).toBe('blue');
    expect(beat.header.subtitle.content).toMatch(/已用时/);
  });

  it('done 后心跳停止，不再产生额外刷新', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    await s.done('好了');
    const count = patched.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(patched.length).toBe(count);
  });

  it('带 taskId：处理中占位卡片渲染停止按钮', async () => {
    const s = new CardReplyStream('chat', { taskId: 't-1' });
    await s.init();
    const card = created[0] as any;
    const btn = card.body.elements.find((e: any) => e.tag === 'button');
    expect(btn?.behaviors[0].value).toMatchObject({ action: 'stop', taskId: 't-1' });
  });

  it('signal abort 后 fail 渲染「已停止」并保留已生成内容', async () => {
    const ac = new AbortController();
    const s = new CardReplyStream('chat', { taskId: 't-1', signal: ac.signal });
    await s.init();
    s.push('部分结果');
    ac.abort();
    // Handler 循环因 abort 抛错 → catch → fail(底层报错文案)
    await s.fail('CLI 退出码 143');
    const last = patched[patched.length - 1] as any;
    expect(last.header.template).toBe('grey');
    expect(last.config.streaming_mode).toBe(false);
    expect(last.body.elements[0].content).toContain('部分结果');
    expect(last.body.elements[0].content).toContain('已由用户停止');
    // 不泄露底层报错文案
    expect(last.body.elements[0].content).not.toContain('143');
    // 终态不再有停止按钮
    expect(last.body.elements.some((e: any) => e.tag === 'button')).toBe(false);
  });

  it('未 abort 时 fail 仍是红色「处理失败」并展示报错', async () => {
    const ac = new AbortController();
    const s = new CardReplyStream('chat', { taskId: 't-1', signal: ac.signal });
    await s.init();
    await s.fail('boom');
    const last = patched[patched.length - 1] as any;
    expect(last.header.template).toBe('red');
    expect(last.body.elements[0].content).toBe('boom');
  });

  it('收到 abort 即刻切「已停止」，无需 Handler 调用 fail/done', async () => {
    const ac = new AbortController();
    const s = new CardReplyStream('chat', { taskId: 't-1', signal: ac.signal });
    await s.init();
    s.push('部分');
    ac.abort(); // 模拟不响应 signal 的 Handler：仅 abort，不调用 fail/done
    const last = patched[patched.length - 1] as any;
    expect(last.header.template).toBe('grey');
    expect(last.body.elements.some((e: any) => e.tag === 'button')).toBe(false);
  });

  it('停止后 Handler 迟到的 done 不覆盖「已停止」终态', async () => {
    const ac = new AbortController();
    const s = new CardReplyStream('chat', { taskId: 't-1', signal: ac.signal });
    await s.init();
    ac.abort();
    const countAfterStop = patched.length;
    await s.done('迟到的完整答案'); // 应被 finalized 守卫忽略
    const last = patched[patched.length - 1] as any;
    expect(patched.length).toBe(countAfterStop);
    expect(last.header.template).toBe('grey');
    expect(last.body.elements[0].content).not.toContain('迟到');
  });

  it('停止后心跳不再刷新卡片', async () => {
    const ac = new AbortController();
    const s = new CardReplyStream('chat', { taskId: 't-1', signal: ac.signal });
    await s.init();
    ac.abort();
    const count = patched.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(patched.length).toBe(count);
  });
});
